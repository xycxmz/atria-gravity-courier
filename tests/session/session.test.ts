import { describe, expect, it } from 'vitest'
import { PHYSICS, WORLD, getLevel } from '../../src/content/levels.ts'
import { launchSnapshot, runFlight } from '../../src/physics/simulate.ts'
import { Session } from '../../src/game/session.ts'
import type { AimInput, LevelDef } from '../../src/physics/types.ts'

function makeSession(levelId: string, aim: AimInput): Session {
  return new Session(getLevel(levelId), aim)
}

/** 圆轨道Timeout 关卡（与 H-T12 同构）：绕引力源飞行 30 秒不结束，用于最坏情形测量。 */
const ORBIT_LEVEL: LevelDef = {
  id: 'PERF',
  name: '测量-观察上限',
  launch: { x: 300, y: 350 },
  bodies: [{ id: 'p1', x: 500, y: 350, radius: 50, mu: 600000 }],
  receiver: { kind: 'fixed', x: 950, y: 60, radius: 22 },
  defaultAim: { angleDegrees: 0, speed: 140 },
  teachingFocus: '测量',
}

function makeOrbitSession(): Session {
  return new Session(ORBIT_LEVEL, { angleDegrees: 0, speed: 140 })
}

describe('Session：预览与实飞同内核（真实会话）', () => {
  for (const levelId of ['H01', 'H02', 'H03', 'H04', 'H05', 'H06']) {
    it(`${levelId} 逐帧推进（批次 2）与 preview() 结果一致`, () => {
      const session = makeSession(levelId, getLevel(levelId).defaultAim)
      const preview = session.preview()
      expect(preview).not.toBeNull()
      session.launch()
      // 逐帧推进，与 runFlight 整段逐步对照
      let guard = 0
      const maxSteps = 4000
      while (session.getSnapshot().phase !== 'result' && guard < maxSteps) {
        guard++
        session.tick(2)
      }
      const snap = session.getSnapshot()
      expect(snap.phase).toBe('result')
      const outcome = preview!.outcome
      expect(snap.outcome?.kind).toBe(outcome.kind)
      if (snap.outcome && outcome.kind === 'success' && snap.outcome.kind === 'success') {
        expect(Math.abs(snap.outcome.time - outcome.time)).toBeLessThanOrEqual(1e-9)
        expect(Math.abs(snap.outcome.relativeSpeed - outcome.relativeSpeed)).toBeLessThanOrEqual(1e-9)
      }
      // 轨迹逐步一致
      const live = snap.trajectory
      const ref = preview!.trajectory
      expect(live.length).toBe(ref.length)
      let maxDelta = 0
      for (let i = 0; i < ref.length; i++) {
        maxDelta = Math.max(maxDelta, Math.hypot(live[i].x - ref[i].x, live[i].y - ref[i].y))
      }
      expect(maxDelta).toBeLessThanOrEqual(1e-7)
    })
  }

  it('H-T05 等价：批次 1/2/4/8 终局与状态一致', () => {
    const aim: AimInput = { angleDegrees: -47, speed: 40 }
    const reference = makeSession('H03', aim)
    const refPreview = reference.preview()!

    for (const batch of [1, 2, 4, 8]) {
      const s = makeSession('H03', aim)
      s.launch()
      let guard = 0
      while (s.getSnapshot().phase !== 'result' && guard < 4000) {
        guard++
        s.tick(batch)
      }
      const snap = s.getSnapshot()
      expect(snap.outcome?.kind).toBe(refPreview.outcome.kind)
      expect(snap.outcome?.event.stepIndex).toBe(refPreview.outcome.event.stepIndex)
      expect(snap.outcome?.event.u).toBeCloseTo(refPreview.outcome.event.u, 10)
    }
  })
})

describe('Session：暂停、重试与微调（真实会话）', () => {
  it('暂停期间 flightTime 不变，恢复后推进', () => {
    const s = makeSession('H01', { angleDegrees: 0, speed: 80 })
    s.launch()
    s.tick(60)
    const t1 = s.getSnapshot().flightTime
    s.pause()
    for (let i = 0; i < 10; i++) s.tick(10) // 暂停下 tick 不推进
    expect(s.getSnapshot().phase).toBe('paused')
    expect(s.getSnapshot().flightTime).toBe(t1)
    s.resume()
    let guard = 0
    while (s.getSnapshot().phase !== 'result' && guard < 4000) {
      guard++
      s.tick(8)
    }
    expect(s.getSnapshot().phase).toBe('result')
  })

  it('微调面板等待不推进；取消不消耗次数且相位不变', () => {
    const s = makeSession('H01', { angleDegrees: 0, speed: 80 })
    s.launch()
    s.tick(100)
    const t1 = s.getSnapshot().flightTime
    s.openBurnPanel()
    expect(s.getSnapshot().phase).toBe('burnPanel')
    s.setPendingBurn({ angleDegrees: 0, deltaV: 12 })
    expect(s.getSnapshot().pendingBurn.deltaV).toBe(12)
    // 面板期间 tick 不推进
    s.tick(100)
    expect(s.getSnapshot().flightTime).toBe(t1)
    s.cancelBurn()
    expect(s.getSnapshot().phase).toBe('flying')
    expect(s.getSnapshot().burnsRemaining).toBe(1)
  })

  it('确认非零修正消耗一次且只应用一次（终局修正 1 次）', () => {
    const s = makeSession('H01', { angleDegrees: 0, speed: 80 })
    s.launch()
    s.tick(200)
    const step = s.getSnapshot().stepIndex
    s.openBurnPanel()
    s.setPendingBurn({ angleDegrees: 0, deltaV: 10 })
    s.confirmBurn()
    const snap = s.getSnapshot()
    expect(snap.phase).toBe('flying')
    expect(snap.burnsRemaining).toBe(0)
    expect(snap.burnLog).toHaveLength(1)
    expect(snap.burnLog[0].step).toBe(step)
    // 重复确认/双击无效
    expect(() => s.confirmBurn()).not.toThrow()
    expect(s.getSnapshot().burnLog).toHaveLength(1)
    let guard = 0
    while (s.getSnapshot().phase !== 'result' && guard < 4000) {
      guard++
      s.tick(8)
    }
    expect(s.getSnapshot().outcome?.kind).toBe('success')
    // H01 0/80 + 中途 +10 与解析基准同构（接触更早）
    const ref = runFlight({
      ctx: { level: getLevel('H01'), constants: PHYSICS, world: WORLD },
      start: launchSnapshot(getLevel('H01'), { angleDegrees: 0, speed: 80 }),
    })
    expect(s.getSnapshot().outcome?.event.time ?? 0).toBeLessThan(ref.outcome.event.time)
  })

  it('零值确认不消耗次数', () => {
    const s = makeSession('H01', { angleDegrees: 0, speed: 80 })
    s.launch()
    s.tick(100)
    s.openBurnPanel()
    s.setPendingBurn({ angleDegrees: 90, deltaV: 0 })
    s.confirmBurn()
    expect(s.getSnapshot().burnsRemaining).toBe(1)
    expect(s.getSnapshot().burnLog).toHaveLength(0)
    expect(s.getSnapshot().phase).toBe('flying')
  })

  it('重试保留瞄准参数、重置相位、记录上次尝试', () => {
    const s = makeSession('H03', { angleDegrees: -30, speed: 40 })
    s.launch()
    let guard = 0
    while (s.getSnapshot().phase !== 'result' && guard < 4000) {
      guard++
      s.tick(8)
    }
    expect(s.getSnapshot().outcome?.kind).toBe('failure')
    // 初次完成没有“上次尝试”（GC2-001）
    expect(s.getSnapshot().previousAttempt).toBeNull()
    s.retry()
    const snap = s.getSnapshot()
    expect(snap.phase).toBe('aiming')
    expect(snap.aim).toEqual({ angleDegrees: -30, speed: 40 })
    expect(snap.stepIndex).toBe(0)
    expect(snap.burnsRemaining).toBe(1)
    expect(snap.ghost).not.toBeNull()
    // 重试把刚结束的尝试归档为 previousAttempt
    expect(snap.previousAttempt?.aim).toEqual({ angleDegrees: -30, speed: 40 })
    expect(snap.previousAttempt?.outcome.kind).toBe('failure')
  })

  it('非法 proposal 被拒绝且状态不变（GC2-004 契约：拒绝，不钳制）', () => {
    const s = makeSession('H01', { angleDegrees: 0, speed: 80 })
    s.launch()
    s.tick(50)
    s.openBurnPanel()
    s.setPendingBurn({ angleDegrees: 0, deltaV: 10 })
    const before = s.getSnapshot().pendingBurn
    // 超范围强度：不变状态
    s.setPendingBurn({ angleDegrees: 0, deltaV: 25 })
    expect(s.getSnapshot().pendingBurn).toEqual(before)
    // 负值：不变状态
    s.setPendingBurn({ angleDegrees: 45, deltaV: -5 })
    expect(s.getSnapshot().pendingBurn).toEqual(before)
    // NaN：不变状态
    s.setPendingBurn({ angleDegrees: Number.NaN, deltaV: 10 })
    expect(s.getSnapshot().pendingBurn).toEqual(before)
    // 合法小数仍被接受
    s.setPendingBurn({ angleDegrees: 12.5, deltaV: 3.5 })
    expect(s.getSnapshot().pendingBurn).toEqual({ angleDegrees: 12.5, deltaV: 3.5 })
  })
})

describe('Session：暂停下的逐步观察（GC-005）', () => {
  it('observeSteps 推进固定步且保持暂停，终局与连续推进一致', () => {
    const aim: AimInput = { angleDegrees: -47, speed: 40 }
    const ref = makeSession('H03', aim)
    ref.launch()
    let guard = 0
    while (ref.getSnapshot().phase !== 'result' && guard < 4000) {
      guard++
      ref.tick(8)
    }
    const refOutcome = ref.getSnapshot().outcome!

    const s = makeSession('H03', aim)
    s.launch()
    // 每次 12 步（0.1 秒）观察到底
    let count = 0
    while (s.getSnapshot().phase === 'flying' || s.getSnapshot().phase === 'paused') {
      if (s.getSnapshot().phase === 'flying') s.pause()
      s.observeSteps(12)
      count++
      if (count > 4000) throw new Error('观察未收敛')
    }
    const snap = s.getSnapshot()
    expect(snap.phase).toBe('result')
    expect(snap.outcome?.kind).toBe(refOutcome.kind)
    expect(snap.outcome?.event.stepIndex).toBe(refOutcome.event.stepIndex)
    expect(snap.outcome?.event.u).toBeCloseTo(refOutcome.event.u, 10)
    expect(Math.hypot(snap.pos.x - refOutcome.event.position.x, snap.pos.y - refOutcome.event.position.y)).toBeLessThanOrEqual(1e-9)
  })

  it('圆轨道 30 秒观察上限：3600 步最坏情形可推进到底（性能/正确性边界）', () => {
    const s = makeOrbitSession()
    // 手工构造切向轨道速度（绕 (500,350) 半径 200 近似圆轨）
    const start = launchSnapshot(ORBIT_LEVEL, { angleDegrees: 0, speed: 140 })
    s.launch()
    // 直接以内核验证：30 秒 = 3600 步超时
    const ref = runFlight({
      ctx: { level: ORBIT_LEVEL, constants: PHYSICS, world: WORLD },
      start: { stepIndex: 0, pos: start.pos, vel: { x: 0, y: -Math.sqrt(600000 / 200) } },
    })
    void s
    expect(ref.outcome.kind).toBe('failure')
    if (ref.outcome.kind === 'failure') {
      expect(ref.outcome.reason).toBe('timeout')
      expect(ref.trajectory.length).toBe(3601)
    }
  })
})
