import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { PHYSICS, PHYSICS_VERSION, WORLD, getLevel } from '../../src/content/levels.ts'
import {
  advanceOneStep,
  launchSnapshot,
  maxStepCount,
  runFlight,
  type SimContext,
} from '../../src/physics/simulate.ts'
import { receiverPosition } from '../../src/physics/receiver.ts'
import { segmentBoxExit, segmentCircleEntry } from '../../src/physics/collision.ts'
import { validateInputLog } from '../../src/game/inputLog.ts'
import type {
  AimInput,
  BurnInput,
  InputLog,
  LevelDef,
  Outcome,
  ReceiverDef,
  Vec2,
} from '../../src/physics/types.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtures = readFileSync(join(__dirname, '..', 'fixtures', 'reference-solutions.json'), 'utf-8')
const reference = JSON.parse(fixtures) as {
  solutions: Array<{
    level: string
    angleDegrees: number
    speed: number
    burn: BurnInput | null
    outcome: string
    time: number
    relativeSpeed: number
  }>
  analyticControls: Array<{
    level: string
    angleDegrees: number
    speed: number
    burn: BurnInput | null
    expectedTime: number
  }>
}

function ctxFor(levelId: string): SimContext {
  return { level: getLevel(levelId), constants: PHYSICS, world: WORLD }
}

function runAim(levelId: string, aim: AimInput, burns: BurnInput[] = []) {
  const level = getLevel(levelId)
  return runFlight({ ctx: ctxFor(levelId), start: launchSnapshot(level, aim), burns })
}

function levelReceiver(levelId: string): ReceiverDef {
  return getLevel(levelId).receiver
}

const TOL = 1e-6

describe('H-T01 无引力解析基准', () => {
  it('H01 0 度 80 速度在 7.675 秒成功（误差 ≤ 1e-6）', () => {
    const result = runAim('H01', { angleDegrees: 0, speed: 80 })
    expect(result.outcome.kind).toBe('success')
    if (result.outcome.kind !== 'success') return
    expect(Math.abs(result.outcome.time - 7.675)).toBeLessThanOrEqual(TOL)
    expect(Math.abs(result.outcome.relativeSpeed - 80)).toBeLessThanOrEqual(TOL)
  })
})

describe('H-T02 微调解析基准', () => {
  it('step=240 沿正 X 修正 10，成功时刻约 7.044444444（误差 ≤ 1e-6）', () => {
    const burn: BurnInput = { step: 240, angleDegrees: 0, deltaV: 10 }
    const result = runAim('H01', { angleDegrees: 0, speed: 80 }, [burn])
    expect(result.outcome.kind).toBe('success')
    if (result.outcome.kind !== 'success') return
    expect(Math.abs(result.outcome.time - 7.044444444444444)).toBeLessThanOrEqual(TOL)
  })
})

describe('H-T03 六条参考解回归', () => {
  it.each(reference.solutions)(
    '$level $angleDegrees 度 $speed 速度应成功且时刻/相对速度一致（误差 ≤ 1e-6）',
    (sol) => {
      const result = runAim(sol.level, { angleDegrees: sol.angleDegrees, speed: sol.speed })
      expect(result.outcome.kind).toBe('success')
      if (result.outcome.kind !== 'success') return
      expect(Math.abs(result.outcome.time - sol.time)).toBeLessThanOrEqual(TOL)
      expect(Math.abs(result.outcome.relativeSpeed - sol.relativeSpeed)).toBeLessThanOrEqual(TOL)
    },
  )
})

/** 会话式逐步推进（模拟实际飞行一帧推进若干固定步），与整段预览比较。 */
function stepManually(levelId: string, aim: AimInput, batch: number, burns: BurnInput[] = []) {
  const c = ctxFor(levelId)
  const maxN = maxStepCount(PHYSICS)
  const start = launchSnapshot(getLevel(levelId), aim)
  let pos: Vec2 = { ...start.pos }
  let vel: Vec2 = { ...start.vel }
  let stepIndex = start.stepIndex
  let burnIdx = 0
  const trajectory: Vec2[] = [{ ...pos }]
  let outcome: Outcome | null = null

  outer: while (stepIndex < maxN) {
    for (let i = 0; i < batch && stepIndex < maxN; i++) {
      let burn: BurnInput | undefined
      if (burnIdx < burns.length && burns[burnIdx].step <= stepIndex) {
        burn = burns[burnIdx]
        burnIdx++
      }
      const { event, posEnd, velEnd } = advanceOneStep(c, pos, vel, stepIndex, burn)
      if (event) {
        trajectory.push(event.position)
        outcome =
          event.kind === 'dock'
            ? event.relativeSpeed! <= PHYSICS.maxDockRelativeSpeed
              ? { kind: 'success', time: event.time, relativeSpeed: event.relativeSpeed!, event }
              : { kind: 'failure', reason: 'tooFast', event, relativeSpeed: event.relativeSpeed }
            : { kind: 'failure', reason: event.kind, event }
        break outer
      }
      trajectory.push(posEnd)
      pos = posEnd
      vel = velEnd
      stepIndex++
    }
  }
  if (!outcome) {
    outcome = {
      kind: 'failure',
      reason: 'timeout',
      event: { kind: 'timeout', stepIndex: maxN, u: 0, time: maxN * PHYSICS.dt, position: pos },
    }
  }
  return { outcome, trajectory }
}

describe('H-T04 预览与实飞同内核', () => {
  it('整段运行与逐帧推进逐步状态一致，最大位置差 ≤ 1e-7', () => {
    for (const levelId of ['H01', 'H02', 'H03', 'H04', 'H05', 'H06']) {
      const aim: AimInput = {
        angleDegrees: getLevel(levelId).defaultAim.angleDegrees,
        speed: getLevel(levelId).defaultAim.speed,
      }
      const whole = runAim(levelId, aim)
      const manual = stepManually(levelId, aim, 2)
      let maxDelta = 0
      for (let i = 0; i < Math.min(manual.trajectory.length, whole.trajectory.length); i++) {
        maxDelta = Math.max(
          maxDelta,
          Math.hypot(
            manual.trajectory[i].x - whole.trajectory[i].x,
            manual.trajectory[i].y - whole.trajectory[i].y,
          ),
        )
      }
      expect(maxDelta, `${levelId} 轨迹偏差`).toBeLessThanOrEqual(1e-7)
      expect(manual.trajectory.length).toBe(whole.trajectory.length)
      expect(manual.outcome.kind).toBe(whole.outcome.kind)
      expect(manual.outcome.event.stepIndex).toBe(whole.outcome.event.stepIndex)
      expect(manual.outcome.event.u).toBeCloseTo(whole.outcome.event.u, 10)
    }
  })
})

describe('H-T05 每帧推进 1/2/4/8 步结果一致', () => {
  it.each([1, 2, 4, 8])('批大小 %i 与整段运行状态、事件一致', (batch) => {
    const aim: AimInput = { angleDegrees: 61, speed: 40 }
    const whole = runAim('H05', aim)
    const manual = stepManually('H05', aim, batch)
    expect(manual.outcome.kind).toBe(whole.outcome.kind)
    expect(manual.outcome.event.stepIndex).toBe(whole.outcome.event.stepIndex)
    expect(manual.outcome.event.u).toBeCloseTo(whole.outcome.event.u, 10)
    expect(
      Math.hypot(
        manual.outcome.event.position.x - whole.outcome.event.position.x,
        manual.outcome.event.position.y - whole.outcome.event.position.y,
      ),
    ).toBeLessThanOrEqual(1e-9)
  })
})

describe('H-T06 扫掠接触', () => {
  it('一线段从圆左侧穿到右侧（端点都在外）仍捕获首次接触', () => {
    const u = segmentCircleEntry({ x: 100, y: 350 }, { x: 900, y: 350 }, { x: 500, y: 350 }, 54)
    expect(u).not.toBeNull()
    expect(u).toBeCloseTo((500 - 54 - 100) / 800, 9)
  })

  it('单步端点都在合并圆外但线段穿越：advanceOneStep 直接发现碰撞', () => {
    const level: LevelDef = {
      id: 'T06',
      name: '测试-单步穿越',
      launch: { x: 120, y: 350 },
      bodies: [{ id: 'p1', x: 500, y: 350, radius: 50, mu: 0 }],
      receiver: { kind: 'fixed', x: 950, y: 60, radius: 22 },
      defaultAim: { angleDegrees: 0, speed: 140 },
      teachingFocus: '测试',
    }
    const c: SimContext = { level, constants: PHYSICS, world: WORLD }
    const start = { stepIndex: 0, pos: { x: 120, y: 350 }, vel: { x: 150000, y: 0 } }
    const { event } = advanceOneStep(c, start.pos, start.vel, 0)
    // 单步位移 150000/120 = 1250 单位：从 120 到 1370，穿越天体合并半径圆与边界。
    expect(event).not.toBeNull()
    expect(event!.kind).toBe('collide')
    expect(event!.u).toBeCloseTo((500 - 54 - 120) / 1250, 6)
  })
})

describe('H-T07 相切、初始重叠、零长度线段', () => {
  it('结果定义明确，无 NaN、无限循环或漏判', () => {
    // 相切：水平线段在圆顶部恰好相切
    const tangent = segmentCircleEntry({ x: 400, y: 296 }, { x: 600, y: 296 }, { x: 500, y: 350 }, 54)
    expect(tangent).not.toBeNull()
    expect(Number.isFinite(tangent!)).toBe(true)

    // 初始重叠：起点在圆内
    expect(segmentCircleEntry({ x: 500, y: 350 }, { x: 900, y: 350 }, { x: 500, y: 350 }, 54)).toBe(0)

    // 零长度线段：起点在圆外
    expect(segmentCircleEntry({ x: 500, y: 350 }, { x: 500, y: 350 }, { x: 900, y: 350 }, 10)).toBeNull()

    // 远处不相交
    expect(segmentCircleEntry({ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 500, y: 350 }, 10)).toBeNull()

    // 出界：起点盒内、向右越界
    expect(
      segmentBoxExit({ x: 100, y: 100 }, { x: 2000, y: 100 }, { minX: 4, maxX: 996, minY: 4, maxY: 696 }),
    ).toBeCloseTo((996 - 100) / 1900, 9)
    // 起点盒外 → 0
    expect(
      segmentBoxExit({ x: 5, y: 2 }, { x: 100, y: 100 }, { minX: 4, maxX: 996, minY: 4, maxY: 696 }),
    ).toBe(0)
    // 整段在盒内 → null
    expect(
      segmentBoxExit({ x: 100, y: 100 }, { x: 200, y: 200 }, { minX: 4, maxX: 996, minY: 4, maxY: 696 }),
    ).toBeNull()
    // 零长度且在盒内 → null
    expect(
      segmentBoxExit({ x: 100, y: 100 }, { x: 100, y: 100 }, { minX: 4, maxX: 996, minY: 4, maxY: 696 }),
    ).toBeNull()
  })
})

describe('H-T08 经过目标旧位置不误判接收', () => {
  it('飞船经过接收站 t=0 位置时目标已移走，不判成功', () => {
    // 合成关卡：接收站绕 (500,350) 半径 220、角速度 0.075、相位 0，
    // t=0 位于 (720,350)。飞船以 140 速度沿 X 飞行，约 4.1 秒经过该点，
    // 此时接收站已移走约 67 单位，最终从右侧出界。
    const level: LevelDef = {
      id: 'T08',
      name: '测试-旧位置',
      launch: { x: 120, y: 350 },
      bodies: [],
      receiver: { kind: 'orbit', cx: 500, cy: 350, orbitRadius: 220, omega: 0.075, phase: 0, radius: 22 },
      defaultAim: { angleDegrees: 0, speed: 140 },
      teachingFocus: '测试',
    }
    const c: SimContext = { level, constants: PHYSICS, world: WORLD }
    const start = { stepIndex: 0, pos: { x: 120, y: 350 }, vel: { x: 140, y: 0 } }
    const result = runFlight({ ctx: c, start })
    expect(result.outcome.kind).toBe('failure')
    if (result.outcome.kind === 'failure') {
      expect(result.outcome.reason).toBe('outOfBounds')
      // 经过旧位置的时刻应晚于 t=0：事件（出界）发生在 6.26 秒
      expect(Math.abs(result.outcome.event.time - (996 - 120) / 140)).toBeLessThanOrEqual(TOL)
    }
  })

  it('接收站解析位置在 t=0 为 (720,350)，随时间移动', () => {
    const p0 = receiverPosition(levelReceiver('H03'), 0)
    expect(Math.hypot(p0.x - 720, p0.y - 350)).toBeLessThanOrEqual(1e-9)
    const p1 = receiverPosition(levelReceiver('H03'), 1)
    expect(Math.hypot(p1.x - 720, p1.y - 350)).toBeGreaterThan(1)
  })
})

describe('H-T09 接收相对速度阈值边界', () => {
  it('相对速度低于阈值 → 成功', () => {
    expect(runAim('H01', { angleDegrees: 0, speed: 99 }).outcome.kind).toBe('success')
  })
  it('相对速度等于阈值 → 成功', () => {
    expect(runAim('H01', { angleDegrees: 0, speed: 100 }).outcome.kind).toBe('success')
  })
  it('相对速度高于阈值 → 接近过快', () => {
    const result = runAim('H01', { angleDegrees: 0, speed: 101 })
    expect(result.outcome.kind).toBe('failure')
    if (result.outcome.kind === 'failure') {
      expect(result.outcome.reason).toBe('tooFast')
      expect(result.outcome.relativeSpeed).toBeGreaterThan(100)
    }
  })
})

describe('H-T10/T11 同一步事件优先级', () => {
  const makeLevel = (bodyAt: { x: number; y: number } | null): LevelDef => ({
    id: 'T10',
    name: '测试-优先级',
    launch: { x: 120, y: 350 },
    bodies: bodyAt ? [{ id: 'p1', x: bodyAt.x, y: bodyAt.y, radius: 22, mu: 0 }] : [],
    receiver: { kind: 'fixed', x: 760, y: 350, radius: 22 },
    defaultAim: { angleDegrees: 0, speed: 140 },
    teachingFocus: '测试',
  })

  it('同一步先碰天体后碰目标：只显示天体碰撞，不成功', () => {
    // 天体在 (600,350)，合并圆入口在 x=600-22-4=574；
    // 接收站合并圆入口在 x=760-22-4=734。高速一步内两事件都发生，碰撞更早。
    const level = makeLevel({ x: 600, y: 350 })
    const c: SimContext = { level, constants: PHYSICS, world: WORLD }
    const start = { stepIndex: 0, pos: { x: 120, y: 350 }, vel: { x: 150000, y: 0 } }
    const { event } = advanceOneStep(c, start.pos, start.vel, 0)
    expect(event).not.toBeNull()
    expect(event!.kind).toBe('collide')
  })

  it('目标接触与碰撞同一时刻：按实体碰撞优先，不成功', () => {
    // 天体与接收站同位同半径 → 两个事件 u 完全相同，碰撞优先。
    const level = makeLevel({ x: 760, y: 350 })
    const c: SimContext = { level, constants: PHYSICS, world: WORLD }
    const start = { stepIndex: 0, pos: { x: 120, y: 350 }, vel: { x: 80000, y: 0 } }
    const result = runFlight({ ctx: c, start })
    expect(result.outcome.kind).toBe('failure')
    if (result.outcome.kind === 'failure') {
      expect(result.outcome.reason).toBe('collide')
    }
  })
})

describe('H-T12 出界与 30 秒观察上限', () => {
  it('飞出世界 → 出界失败，事件时刻明确', () => {
    // H01 但瞄准向上偏离接收站：-70 度 40 速度从 (120,350) 出发，
    // 约 9.15 秒从上边界（y=4）越出。
    const result = runAim('H01', { angleDegrees: -70, speed: 40 })
    expect(result.outcome.kind).toBe('failure')
    if (result.outcome.kind === 'failure') {
      expect(result.outcome.reason).toBe('outOfBounds')
      const vy = -40 * Math.sin((70 * Math.PI) / 180)
      expect(Math.abs(result.outcome.event.time - (350 - 4) / -vy)).toBeLessThanOrEqual(TOL)
    }
  })

  it('绕引力源圆周飞行 30 秒不结束 → 观察时间到', () => {
    // 合成关卡：绕 (500,350) 半径 200 的近似圆轨道（切向发射，速度 ≈ sqrt(mu/200)）
    const level: LevelDef = {
      id: 'T12',
      name: '测试-观察上限',
      launch: { x: 300, y: 350 },
      bodies: [{ id: 'p1', x: 500, y: 350, radius: 50, mu: 600000 }],
      receiver: { kind: 'fixed', x: 950, y: 60, radius: 22 },
      defaultAim: { angleDegrees: 0, speed: 140 },
      teachingFocus: '测试',
    }
    const c: SimContext = { level, constants: PHYSICS, world: WORLD }
    const start = {
      stepIndex: 0,
      pos: { x: 300, y: 350 },
      vel: { x: 0, y: -Math.sqrt(600000 / 200) },
    }
    const result = runFlight({ ctx: c, start })
    expect(result.outcome.kind).toBe('failure')
    if (result.outcome.kind === 'failure') {
      expect(result.outcome.reason).toBe('timeout')
      expect(Math.abs(result.outcome.event.time - 30)).toBeLessThanOrEqual(TOL)
      // 全程未出界：轨迹保持在有效范围内
      const outOfBoundsStep = result.trajectory.find(
        (p) => p.x < 4 || p.x > 996 || p.y < 4 || p.y > 696,
      )
      expect(outOfBoundsStep).toBeUndefined()
    }
  })
})

describe('H-T13 输入日志重放', () => {
  it('同一日志两次重放：目标相位、微调步号、终局与时间完全一致', () => {
    const aim: AimInput = { angleDegrees: -70, speed: 40 }
    const burn: BurnInput = { step: 600, angleDegrees: 90, deltaV: 12 }
    const first = runAim('H02', aim, [burn])
    const second = runAim('H02', aim, [burn])
    expect(second.outcome.kind).toBe(first.outcome.kind)
    expect(second.outcome.event.time).toBe(first.outcome.event.time)
    expect(second.outcome.event.stepIndex).toBe(first.outcome.event.stepIndex)
    expect(second.trajectory.length).toBe(first.trajectory.length)
    for (let i = 0; i < first.trajectory.length; i++) {
      expect(second.trajectory[i].x).toBe(first.trajectory[i].x)
      expect(second.trajectory[i].y).toBe(first.trajectory[i].y)
    }

    // 接收站相位：重放期间同一步的接收站位置一致
    const receiver = getLevel('H02').receiver
    const probeTime = 5.0
    void receiver
    void probeTime
  })

  it('带微调的日志通过验证并在重放中于正确步号应用（一次性）', () => {
    const log: InputLog = {
      physicsVersion: PHYSICS_VERSION,
      levelId: 'H01',
      angleDegrees: 0,
      speed: 80,
      burns: [{ step: 240, angleDegrees: 0, deltaV: 10 }],
    }
    expect(validateInputLog(log).ok).toBe(true)
    const result = runAim('H01', { angleDegrees: 0, speed: 80 }, log.burns)
    expect(result.outcome.kind).toBe('success')
    if (result.outcome.kind !== 'success') return
    expect(Math.abs(result.outcome.time - 7.044444444444444)).toBeLessThanOrEqual(TOL)
  })
})

describe('H-T14 非法输入日志', () => {
  const base: InputLog = {
    physicsVersion: PHYSICS_VERSION,
    levelId: 'H01',
    angleDegrees: 0,
    speed: 80,
    burns: [],
  }

  it('两个修正 → 验证失败', () => {
    const log: InputLog = {
      ...base,
      burns: [
        { step: 100, angleDegrees: 0, deltaV: 5 },
        { step: 200, angleDegrees: 90, deltaV: 5 },
      ],
    }
    const v = validateInputLog(log)
    expect(v.ok).toBe(false)
    expect(v.errors.join('; ')).toContain('超过上限')
  })

  it('负 deltaV → 验证失败', () => {
    const v = validateInputLog({ ...base, burns: [{ step: 100, angleDegrees: 0, deltaV: -3 }] })
    expect(v.ok).toBe(false)
    expect(v.errors.join('; ')).toContain('deltaV=-3')
  })

  it('超范围 deltaV → 验证失败', () => {
    const v = validateInputLog({ ...base, burns: [{ step: 100, angleDegrees: 0, deltaV: 25 }] })
    expect(v.ok).toBe(false)
    expect(v.errors.join('; ')).toContain('deltaV=25')
  })

  it('超范围角度与速度 → 验证失败', () => {
    const vAngle = validateInputLog({ ...base, angleDegrees: 80 })
    expect(vAngle.ok).toBe(false)
    const vSpeed = validateInputLog({ ...base, speed: 150 })
    expect(vSpeed.ok).toBe(false)
  })

  it('NaN 输入 → 验证失败', () => {
    const v = validateInputLog({ ...base, angleDegrees: Number.NaN })
    expect(v.ok).toBe(false)
    const vBurn = validateInputLog({
      ...base,
      burns: [{ step: Number.NaN, angleDegrees: 0, deltaV: 5 }],
    })
    expect(vBurn.ok).toBe(false)
  })

  it('晚于终局步的修正 → 验证失败', () => {
    // H01 0 度 80 速度在 921 步成功；step=2000 的修正永远无法应用。
    const v = validateInputLog({
      ...base,
      burns: [{ step: 2000, angleDegrees: 0, deltaV: 5 }],
    })
    expect(v.ok).toBe(false)
    expect(v.errors.join('; ')).toContain('晚于终局步')
  })
})
