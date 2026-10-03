import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AimControls } from '../components/AimControls.tsx'
import { AimStick } from '../components/AimStick.tsx'
import { AttemptResult } from '../components/AttemptResult.tsx'
import { BurnControls } from '../components/BurnControls.tsx'
import { TimelineInspector } from '../components/TimelineInspector.tsx'
import { DEFAULT_LEVEL_ID, LEVELS, PHYSICS, PHYSICS_VERSION, getLevel } from '../content/levels.ts'
import { Session, type BurnProposal, type SessionSnapshot } from '../game/session.ts'
import { Sound, setMuted } from '../game/sound.ts'
import { createWorldTransform, drawWorld } from '../render/worldRenderer.ts'
import { clampAim, isValidAim, loadProgress, saveProgress, type Progress } from '../storage/progress.ts'
import type { AimInput, InputLog, Outcome } from '../physics/types.ts'
import type { FlightResult } from '../physics/simulate.ts'
import '../styles/tokens.css'

const STEPS_PER_FRAME_CAP = 8

function initialAimFor(progress: Progress, levelId: string): AimInput {
  const stored = progress.lastAim[levelId]
  if (stored && isValidAim(stored)) return stored
  return getLevel(levelId).defaultAim
}

function validLevelId(id: string): string {
  return LEVELS.some((l) => l.id === id) ? id : DEFAULT_LEVEL_ID
}

function describePreview(preview: FlightResult | null): string {
  if (!preview) return '预览计算中…'
  const outcome = preview.outcome
  if (outcome.kind === 'success') {
    return `预测：投递成功，约 ${outcome.time.toFixed(2)} 秒抵达`
  }
  switch (outcome.reason) {
    case 'collide':
      return '预测：将撞上天体（可调整方向或速度）'
    case 'outOfBounds':
      return '预测：将越出世界范围（可降低速度或改方向）'
    case 'tooFast':
      return `预测：接近过快，相对速度 ${(outcome.relativeSpeed ?? 0).toFixed(1)} > ${PHYSICS.maxDockRelativeSpeed}`
    case 'timeout':
      return '预测：30 秒内未能与接收站相遇'
  }
}

export default function App() {
  const [progress, setProgress] = useState<Progress>(() => loadProgress())
  const [levelId, setLevelId] = useState<string>(() => validLevelId(progress.selectedLevel))
  const [session, setSession] = useState<Session>(
    () => new Session(getLevel(validLevelId(progress.selectedLevel)), initialAimFor(progress, validLevelId(progress.selectedLevel))),
  )
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const phase = snapshot.phase

  const [preview, setPreviewState] = useState<FlightResult | null>(null)
  const [canvasSize, setCanvasSize] = useState({ cssW: 800, cssH: 600, dpr: 1 })
  const [outcomeAt, setOutcomeAt] = useState<number | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpOrigin, setHelpOrigin] = useState<SessionSnapshot['phase'] | null>(null)
  const [muted, setMutedState] = useState(progress.settings.muted)
  const [restoreHint, setRestoreHint] = useState<boolean>(
    () => progress.lastAim[validLevelId(progress.selectedLevel)] !== undefined,
  )
  const [teachingHint, setTeachingHint] = useState(false)
  const [dismissedTasks, setDismissedTasks] = useState<ReadonlySet<string>>(new Set())
  // 检查游标：键含阶段与预览来源，源变化自然失效（渲染期派生，不读 ref）
  const [inspectCell, setInspectCell] = useState<{ key: string; t: number } | null>(null)
  const inspectSourceKey = `${phase}|${preview?.outcome.event.time ?? ''}`
  const inspectT = inspectCell?.key === inspectSourceKey ? inspectCell.t : null
  const setInspectT = useCallback((t: number | null) => {
    if (t === null) setInspectCell(null)
    else setInspectCell({ key: inspectSourceKey, t })
  }, [inspectSourceKey])

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inspectRef = useRef<number | null>(null)
  const previewRef = useRef<FlightResult | null>(null)
  const previewKeyRef = useRef('')
  const prevOutcomeRef = useRef<Outcome | null>(null)

  // 供 rAF 与事件处理器读取的最新值；仅在 effect 中赋值，不在渲染期写 ref。
  const liveRef = useRef({ session, levelId, canvasSize, outcomeAt, muted, progress })
  useEffect(() => {
    liveRef.current = { session, levelId, canvasSize, outcomeAt, muted, progress }
  })

  const systemReducedMotion = usePrefersReducedMotion()

  // 本地只保存邮路选择、完成记录、最近瞄准与设置（防抖写入）。
  useEffect(() => {
    const timer = window.setTimeout(() => saveProgress(progress), 400)
    return () => window.clearTimeout(timer)
  }, [progress])

  useEffect(() => {
    setMuted(muted)
  }, [muted])

  // 切换邮路：读取当前内存中的进度（避免滞后磁盘值覆盖），相位回到起点。
  const switchLevel = useCallback(
    (id: string) => {
      const next = validLevelId(id)
      const level = getLevel(next)
      setLevelId(next)
      const currentProgress = liveRef.current.progress
      const aim = currentProgress.lastAim[next] && isValidAim(currentProgress.lastAim[next])
        ? currentProgress.lastAim[next]
        : level.defaultAim
      setSession(new Session(level, aim))
      setProgress((p) => ({ ...p, selectedLevel: next, lastAim: { ...p.lastAim, [next]: aim } }))
      setOutcomeAt(null)
      setTeachingHint(next === 'H04')
      setRestoreHint(false)
    },
    [],
  )

  const handleAim = useCallback(
    (aim: AimInput) => {
      liveRef.current.session.setAim(clampAim(aim))
      setProgress((p) => ({ ...p, lastAim: { ...p.lastAim, [liveRef.current.levelId]: clampAim(aim) } }))
    },
    [],
  )

  const handleDragAngle = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      const t = createWorldTransform(rect.width, rect.height)
      const world = t.screenToWorld({ x: clientX - rect.left, y: clientY - rect.top })
      const level = getLevel(liveRef.current.levelId)
      const dx = world.x - level.launch.x
      const dy = world.y - level.launch.y
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI
      const clamped = Math.min(PHYSICS.launchAngleMaxDegrees, Math.max(PHYSICS.launchAngleMinDegrees, deg))
      handleAim({ angleDegrees: Math.round(clamped * 2) / 2, speed: liveRef.current.session.getSnapshot().aim.speed })
    },
    [handleAim],
  )

  // 游戏循环：每帧推进若干固定步；预览在同一循环内按键重算，旧预览绝不与新角度同帧出现。
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let acc = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const real = Math.min(0.25, Math.max(0, (now - last) / 1000))
      last = now
      const s = liveRef.current.session
      const snap = s.getSnapshot()
      if (snap.phase === 'flying') {
        acc += real
        let steps = Math.floor(acc / PHYSICS.dt)
        if (steps > STEPS_PER_FRAME_CAP) {
          steps = STEPS_PER_FRAME_CAP
          acc = 0 // 运算不足时减慢呈现，不跳步追赶
        } else {
          acc -= steps * PHYSICS.dt
        }
        if (steps > 0) s.tick(steps)
      } else {
        acc = 0
      }

      const cur = s.getSnapshot()
      const key = `${liveRef.current.levelId}|${cur.phase}|${cur.stepIndex}|${cur.aim.angleDegrees}|${cur.aim.speed}|${cur.pos.x}|${cur.pos.y}|${cur.vel.x}|${cur.vel.y}|${cur.pendingBurn.angleDegrees}|${cur.pendingBurn.deltaV}|${cur.burnLog.length}`
      if (key !== previewKeyRef.current) {
        previewKeyRef.current = key
        previewRef.current = s.hasPreview() ? s.preview() : null
        setPreviewState(previewRef.current)
      }

      // 结果出现（对象引用变化即新终局）：记录时刻、完成与音效，冻结现场。
      if (cur.outcome && prevOutcomeRef.current !== cur.outcome) {
        prevOutcomeRef.current = cur.outcome
        setOutcomeAt(performance.now())
        if (cur.outcome.kind === 'success') {
          Sound.dock()
          const time = cur.outcome.time
          const completedLevel = liveRef.current.levelId
          setProgress((p) => {
            const prev = p.completed[completedLevel]
            if (prev && prev.bestTime <= time) return p
            return { ...p, completed: { ...p.completed, [completedLevel]: { bestTime: time, at: Date.now() } } }
          })
        }
      } else if (!cur.outcome) {
        prevOutcomeRef.current = null
      }

      draw(cur)
    }

    const draw = (snap: SessionSnapshot) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const { cssW, cssH, dpr } = liveRef.current.canvasSize
      const pixelW = Math.round(cssW * dpr)
      const pixelH = Math.round(cssH * dpr)
      if (canvas.width !== pixelW) canvas.width = pixelW
      if (canvas.height !== pixelH) canvas.height = pixelH
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawWorld({
        ctx,
        cssWidth: cssW,
        cssHeight: cssH,
        level: getLevel(liveRef.current.levelId),
        snapshot: snap,
        preview: previewRef.current,
        previewStartStep: snap.phase === 'aiming' ? 0 : snap.stepIndex,
        inspectT: inspectRef.current,
        outcomeAnim: liveRef.current.outcomeAt == null ? 0 : (performance.now() - liveRef.current.outcomeAt) / 1000,
        reducedMotion: systemReducedMotion,
      })
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [systemReducedMotion])

  // 画布尺寸随容器与设备像素比变化；世界比例不变，仅缩放留边。
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const measure = () => {
      const rect = wrap.getBoundingClientRect()
      setCanvasSize({ cssW: rect.width, cssH: rect.height, dpr: window.devicePixelRatio || 1 })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  // 页面隐藏自动暂停；恢复后等待用户继续。
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') liveRef.current.session.pause()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const launch = useCallback(() => {
    liveRef.current.session.launch()
    Sound.launch()
  }, [])

  const retry = useCallback(() => {
    liveRef.current.session.retry()
    setOutcomeAt(null)
  }, [])

  const pauseToggle = useCallback(() => {
    const s = liveRef.current.session
    const phase = s.getSnapshot().phase
    if (phase === 'flying') s.pause()
    else if (phase === 'paused') s.resume()
  }, [])

  // 打开帮助时自动暂停（原飞行态记录来源，关闭后恢复，不把暂停态自动续飞）。
  const toggleHelp = useCallback(() => {
    const s = liveRef.current.session
    if (!helpOpen) {
      const p = s.getSnapshot().phase
      if (p === 'flying') {
        s.pause()
        setHelpOrigin('flying')
      }
      setHelpOpen(true)
      return
    }
    if (helpOrigin === 'flying') s.resume()
    setHelpOrigin(null)
    setHelpOpen(false)
  }, [helpOpen, helpOrigin])

  const openBurn = useCallback(() => {
    liveRef.current.session.openBurnPanel()
  }, [])

  const confirmBurn = useCallback(() => {
    const s = liveRef.current.session
    const phase = s.getSnapshot().phase
    if (phase !== 'burnPanel') return
    const dv = s.getSnapshot().pendingBurn.deltaV
    s.confirmBurn()
    if (dv > 0) Sound.burn()
  }, [])

  const cancelBurn = useCallback(() => {
    liveRef.current.session.cancelBurn()
  }, [])

  /** 暂停下逐步观察（推进固定步，保持暂停，不改 dt）。 */
  const observe = useCallback((steps: number) => {
    liveRef.current.session.observeSteps(steps)
    setInspectT(null)
  }, [setInspectT])

  /** 导出确定性输入日志（邮路版本 + 瞄准 + 微调），便于复现本次尝试。 */
  const exportInputLog = useCallback(() => {
    const snap = liveRef.current.session.getSnapshot()
    const log: InputLog = {
      physicsVersion: PHYSICS_VERSION,
      levelId: liveRef.current.levelId,
      angleDegrees: snap.aim.angleDegrees,
      speed: snap.aim.speed,
      burns: [...snap.burnLog],
    }
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gravity-courier-${liveRef.current.levelId}-${Math.round(snap.flightTime * 1000)}ms.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const setProposal = useCallback((proposal: BurnProposal) => {
    liveRef.current.session.setPendingBurn(proposal)
  }, [])

  /** 微调面板期：在画布上从飞船拖出修正方向（世界坐标反变换后计算角度）。 */
  const handleBurnDrag = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      const t = createWorldTransform(rect.width, rect.height)
      const world = t.screenToWorld({ x: clientX - rect.left, y: clientY - rect.top })
      const snap = liveRef.current.session.getSnapshot()
      const dx = world.x - snap.pos.x
      const dy = world.y - snap.pos.y
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI
      setProposal({ angleDegrees: Math.round(deg), deltaV: snap.pendingBurn.deltaV })
    },
    [setProposal],
  )

  // 键盘：方向键与速度键、发射/暂停/重试/微调；输入数字时不触发；帮助层独占。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const snap = liveRef.current.session.getSnapshot()
      const phase = snap.phase
      const target = e.target
      const isTyping =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      // Escape 先于一切过滤：关帮助 / 取消微调（输入聚焦时也生效）
      if (e.code === 'Escape') {
        if (helpOpen) {
          e.preventDefault()
          toggleHelp()
        } else if (phase === 'burnPanel') {
          e.preventDefault()
          liveRef.current.session.cancelBurn()
        }
        return
      }

      // 数字输入编辑不触发全局快捷键
      if (isTyping) return
      // 帮助层独占：其余游戏键（方向/P/B/空格/回车/R）一律不再作用于背后的世界
      if (helpOpen) return

      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        if (phase !== 'aiming') return
        e.preventDefault()
        const delta = e.code === 'ArrowLeft' ? -0.5 : 0.5
        handleAim({ angleDegrees: snap.aim.angleDegrees + delta, speed: snap.aim.speed })
        return
      }
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        if (phase !== 'aiming') return
        e.preventDefault()
        const delta = e.code === 'ArrowUp' ? 1 : -1
        handleAim({ angleDegrees: snap.aim.angleDegrees, speed: snap.aim.speed + delta })
        return
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        if (target instanceof HTMLElement && target.tagName === 'BUTTON') return
        e.preventDefault()
        const primaryId =
          phase === 'aiming' ? 'launch-button' : phase === 'result' ? 'retry-button' : 'pause-button'
        document.getElementById(primaryId)?.click()
        return
      }
      if (e.code === 'KeyR') {
        if (phase === 'result' || phase === 'paused') {
          e.preventDefault()
          document.getElementById('retry-button')?.click()
        }
        return
      }
      if (e.code === 'KeyB') {
        if (phase === 'flying' || phase === 'paused') {
          e.preventDefault()
          document.getElementById('burn-button')?.click()
        }
        return
      }
      if (e.code === 'KeyP') {
        if (phase === 'flying' || phase === 'paused') {
          e.preventDefault()
          pauseToggle()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleAim, pauseToggle, toggleHelp, cancelBurn, helpOpen])

  // 检查游标同步给 rAF 绘制（渲染期派生值）
  useEffect(() => {
    inspectRef.current = inspectT
  })

  const level = getLevel(levelId)
  // 控制卡展开状态：桌面默认展开；断点切换时重置偏好，收起后切回桌面也有入口。
  const [controlsOverride, setControlsOverride] = useState<boolean | null>(null)
  const isMobileLayout = useMediaQuery('(max-width: 640px)', () => setControlsOverride(null))
  const controlsOpen = controlsOverride ?? !isMobileLayout

  const statusText = useMemo(() => {
    if (phase === 'aiming') return describePreview(preview)
    if (phase === 'flying') return `飞行中 ${snapshot.flightTime.toFixed(2)} 秒 · 微调剩余 ${snapshot.burnsRemaining} 次`
    if (phase === 'paused') return `已暂停（${snapshot.flightTime.toFixed(2)} 秒）· 接收站相位保持不动`
    if (phase === 'burnPanel') return describePreview(preview)
    return '结果见下方卡片'
  }, [phase, preview, snapshot.flightTime, snapshot.burnsRemaining])

  const burnDisabled = phase === 'aiming' || phase === 'result' || snapshot.burnsRemaining <= 0
  const burnDisabledReason =
    phase === 'aiming'
      ? '微调在飞行中可用'
      : phase === 'result'
        ? '本尝试已结束，请重试后再微调'
        : '本尝试的微调次数已用完'
  const burnLabel =
    phase === 'aiming'
      ? '微调（飞行中可用）'
      : phase === 'result'
        ? '微调（本尝试已结束）'
        : snapshot.burnsRemaining <= 0
          ? '微调（本尝试已用完）'
          : `微调（剩余 ${snapshot.burnsRemaining} 次）`

  // 时间检查：预览态查预览缓存，暂停态查实飞轨迹并可逐步观察。
  // 微调态的预览从当前绝对步开始，不能检查该步之前的时刻（缓存里没有）。
  const inspectMaxTime =
    phase === 'paused' ? snapshot.flightTime : preview ? preview.outcome.event.time : 0
  const inspectMinTime = phase === 'burnPanel' ? snapshot.stepIndex * PHYSICS.dt : 0
  const showInspector =
    inspectMaxTime > inspectMinTime &&
    (phase === 'paused' || ((phase === 'aiming' || phase === 'burnPanel') && preview !== null))

  return (
    <div className="app">
      <header className="topbar">
        <span className="level-name">{level.name}</span>
        <nav className="level-chips" aria-label="邮路选择">
          {LEVELS.map((l) => {
            const done = progress.completed[l.id]
            return (
              <button
                key={l.id}
                className="chip"
                aria-pressed={l.id === levelId}
                onClick={() => switchLevel(l.id)}
                data-short={l.name}
                title={`${l.id} ${l.name}：${l.teachingFocus}`}
              >
                {l.id}
                {done && <span className="done-dot" aria-label="已完成" />}
              </button>
            )
          })}
        </nav>
        <span className="spacer" />
        <button
          className="icon-button"
          aria-pressed={muted}
          onClick={() => {
            const next = !liveRef.current.muted
            setMutedState(next)
            setProgress((p) => ({ ...p, settings: { muted: next } }))
          }}
          title="静音切换"
        >
          {muted ? '静音' : '声音'}
        </button>
        <button
          className="icon-button"
          aria-pressed={helpOpen}
          onClick={toggleHelp}
          title="帮助与图例（打开时自动暂停）"
        >
          帮助
        </button>
      </header>

      <main className="world-wrap" ref={wrapRef}>
        <canvas className="world-canvas" ref={canvasRef} aria-label="投递世界画布" />
        {phase === 'aiming' && (
          <AimStick level={level} cssWidth={canvasSize.cssW} cssHeight={canvasSize.cssH} aim={snapshot.aim} onDragAngle={handleDragAngle} />
        )}
        {phase === 'burnPanel' && (
          <div
            className="burn-drag-layer"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              handleBurnDrag(e.clientX, e.clientY)
            }}
            onPointerMove={(e) => {
              if (e.buttons > 0) handleBurnDrag(e.clientX, e.clientY)
            }}
          />
        )}
        {phase === 'result' && snapshot.outcome && (
          <AttemptResult
            outcome={snapshot.outcome}
            burnsUsed={PHYSICS.maxBurnCount - snapshot.burnsRemaining}
            ghostNote={snapshot.ghost != null && snapshot.ghost.length > 1}
            ghostLabel={snapshot.previousAttempt ? (snapshot.previousAttempt.outcome.kind === 'success' ? '上次成功轨迹' : '上次失败轨迹') : null}
            previousAttempt={snapshot.previousAttempt}
            aim={snapshot.aim}
            levelName={level.name}
            onRetry={retry}
            onPickLevel={() => {
              const chips = document.querySelector('.level-chips')
              chips?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
              const first = document.querySelector<HTMLElement>('.chip:not([aria-pressed="true"])')
              first?.focus({ preventScroll: true })
            }}
            onExportLog={exportInputLog}
          />
        )}
        {restoreHint && (
          <div className="hint-bar" role="note">
            <span>已恢复上次瞄准参数。刷新或切换邮路时，进行中的飞行不会保存，需重新发射。</span>
            <button onClick={() => setRestoreHint(false)} aria-label="关闭提示">
              ×
            </button>
          </div>
        )}
        {phase === 'aiming' && !dismissedTasks.has(levelId) && (
          <div className="hint-bar" role="note">
            <span>观察任务：{level.teachingFocus}</span>
            <button onClick={() => setDismissedTasks((prev) => new Set(prev).add(levelId))} aria-label="关闭观察任务">
              ×
            </button>
          </div>
        )}
        {teachingHint && levelId === 'H04' && phase !== 'burnPanel' && (
          <div className="hint-bar" role="note">
            <span>
              本邮路的可选技巧：飞行中随时可用一次中途微调（暂停后选方向与强度，确认前可看修正后的预测）。
              不消耗也没关系——取消或零值确认都不计次数。
            </span>
            <button onClick={() => setTeachingHint(false)} aria-label="关闭说明">
              ×
            </button>
          </div>
        )}
        {helpOpen && (
          <div className="help-dialog" role="dialog" aria-label="帮助">
            <h2>引力邮差</h2>
            <p>
              调整发射方向与初速度，借助天体引力，在相同时刻与接收站相遇完成投递。经过接收站曾经的位置不算成功。
              预测线（虚线）与实际飞行（实线）使用同一物理规则。
            </p>
            <ul>
              <li>预测虚线上的圆点是每秒时间点；× 是首个事件（碰撞/出界/接触）。</li>
              <li>虚线圆环是接收站在接触时刻的位置（运动站）。</li>
              <li>点划线圆是接收站的运动轨道；引力源有同心环标记，无引力障碍标“静石”。</li>
              <li>失败仅结束本次尝试：重试保留瞄准参数并重置目标相位。</li>
            </ul>
            <p>
              键盘：<span className="kbd">←</span>/<span className="kbd">→</span> 角度（±0.5°），
              <span className="kbd">↑</span>/<span className="kbd">↓</span> 速度（±1），
              <span className="kbd">空格</span>/<span className="kbd">回车</span> 发射或暂停，
              <span className="kbd">R</span> 重试，<span className="kbd">B</span> 微调。输入数字时快捷键不触发。
            </p>
            <p>本邮路教学重点：{level.teachingFocus}</p>
            <div style={{ marginTop: 12 }}>
              <button className="primary-button" onClick={toggleHelp} autoFocus>
                {helpOrigin === 'flying' ? '关闭并继续' : '关闭'}
              </button>
            </div>
          </div>
        )}
      </main>

      <details
        className="controls"
        open={controlsOpen || phase === 'burnPanel'}
        onToggle={(e) => setControlsOverride(e.currentTarget.open)}
      >
        <summary>投递控制（点击展开或收起）</summary>
        <div className="controls-inner">
          {phase === 'burnPanel' ? (
            <BurnControls
              snapshot={snapshot}
              preview={preview}
              onProposal={setProposal}
              onConfirm={confirmBurn}
              onCancel={cancelBurn}
            />
          ) : null}
          {showInspector && phase === 'burnPanel' && (
            <TimelineInspector
              minTime={inspectMinTime}
              maxTime={inspectMaxTime}
              value={inspectT ?? inspectMaxTime}
              onChange={setInspectT}
              canStep={false}
              mode="preview"
            />
          )}
          {phase !== 'burnPanel' && (
            <>
              <AimControls snapshot={snapshot} onAimChange={handleAim} />
              <div className="control-group action-group">
                {phase === 'aiming' && (
                  <button className="primary-button" id="launch-button" onClick={launch}>
                    发射
                  </button>
                )}
                {(phase === 'flying' || phase === 'paused') && (
                  <>
                    <button
                      className="primary-button"
                      id="pause-button"
                      onClick={pauseToggle}
                    >
                      {phase === 'flying' ? '暂停' : '继续'}
                    </button>
                    <button className="secondary-button" onClick={retry} id="retry-button">
                      重试
                    </button>
                  </>
                )}
                <button
                  className="secondary-button"
                  id="burn-button"
                  onClick={openBurn}
                  disabled={burnDisabled}
                  title={burnDisabled ? burnDisabledReason : '打开微调面板（自动暂停）'}
                  aria-label={burnLabel}
                >
                  {burnLabel}
                </button>
              </div>
              <div className="control-group" style={{ flex: '1 1 100%', minWidth: 0 }}>
                <div className="status-line" role="status" aria-live="polite">
                  {statusText}
                </div>
              </div>
              {showInspector && (phase === 'aiming' || phase === 'paused') && (
                <TimelineInspector
                  minTime={inspectMinTime}
                  maxTime={inspectMaxTime}
                  value={inspectT ?? inspectMaxTime}
                  onChange={setInspectT}
                  onObserve={observe}
                  canStep={phase === 'paused'}
                  mode={phase === 'paused' ? 'live' : 'preview'}
                />
              )}
            </>
          )}
        </div>
      </details>
    </div>
  )
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window === 'undefined' || !window.matchMedia
      ? false
      : window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

function useMediaQuery(query: string, onChange?: () => void): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' || !window.matchMedia ? false : window.matchMedia(query).matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(query)
    const listener = () => {
      setMatches(mq.matches)
      onChange?.()
    }
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [query, onChange])
  return matches
}
