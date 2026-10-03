import { accelerationAt } from './gravity.ts'
import { EVENT_TIE_EPSILON, segmentBoxExit, segmentCircleEntry, type Box } from './collision.ts'
import { integrateStep } from './integrator.ts'
import { receiverPosition, receiverVelocity } from './receiver.ts'
import type {
  AimInput,
  BurnInput,
  EventKind,
  LevelDef,
  Outcome,
  PhysicsConstants,
  SimEvent,
  SimSnapshot,
  Vec2,
  WorldDef,
} from './types.ts'

export interface SimContext {
  level: LevelDef
  constants: PhysicsConstants
  world: WorldDef
}

/** 飞船中心有效范围（世界尺寸与飞船半径推导）。 */
export function stepBounds(ctx: SimContext): Box {
  const r = ctx.constants.craftRadius
  return {
    minX: r,
    maxX: ctx.world.width - r,
    minY: r,
    maxY: ctx.world.height - r,
  }
}

/** 观察预算对应的整数步上限：maxFlightSeconds / dt。 */
export function maxStepCount(constants: PhysicsConstants): number {
  return Math.round(constants.maxFlightSeconds / constants.dt)
}

/** 角度（度，正为向下）转速度向量。 */
export function aimVelocity(aim: AimInput): Vec2 {
  const rad = (aim.angleDegrees * Math.PI) / 180
  return { x: aim.speed * Math.cos(rad), y: aim.speed * Math.sin(rad) }
}

/** 微调（度，360° 任意方向）转速度增量。 */
export function burnDelta(angelDegrees: number, deltaV: number): Vec2 {
  const rad = (angelDegrees * Math.PI) / 180
  return { x: deltaV * Math.cos(rad), y: deltaV * Math.sin(rad) }
}

export interface AdvanceResult {
  /** 该步内首个事件；null 表示无事件，可继续推进。 */
  event: SimEvent | null
  /** 完整步末位置（事件发生时仍返回整步末值，事件位置见 event.position）。 */
  posEnd: Vec2
  velEnd: Vec2
}

const EVENT_PRIORITY: Record<EventKind, number> = {
  collide: 0,
  outOfBounds: 1,
  dock: 2,
  timeout: 3,
}

interface EventCandidate {
  u: number
  kind: EventKind
  bodyId?: string
}

/**
 * 推进一个固定逻辑步（velocity Verlet + 扫掠接触 + 事件排序）。
 * 预览与实飞调用同一函数；burn 在该整数步起点加到速度上，然后执行该步积分。
 */
export function advanceOneStep(
  ctx: SimContext,
  pos: Vec2,
  vel: Vec2,
  stepIndex: number,
  burn?: BurnInput,
): AdvanceResult {
  const { level, constants } = ctx
  const dt = constants.dt
  const bounds = stepBounds(ctx)

  let velStart = vel
  if (burn && burn.deltaV !== 0) {
    const dv = burnDelta(burn.angleDegrees, burn.deltaV)
    velStart = { x: vel.x + dv.x, y: vel.y + dv.y }
  }

  const acc = (p: Vec2) => accelerationAt(p, level.bodies, constants.softening)
  const { posEnd, velEnd } = integrateStep(pos, velStart, dt, acc)

  const tStart = stepIndex * dt
  const tEnd = (stepIndex + 1) * dt

  const candidates: EventCandidate[] = []
  const consider = (candidate: EventCandidate) => {
    candidates.push(candidate)
  }

  // 实体碰撞：天体（含 mu=0 的无引力障碍）合并半径 = 天体半径 + 飞船半径。
  for (const body of level.bodies) {
    const u = segmentCircleEntry(pos, posEnd, body, body.radius + constants.craftRadius)
    if (u !== null) consider({ u, kind: 'collide', bodyId: body.id })
  }

  // 出界：飞船中心线段首次越出有效范围。
  const uBounds = segmentBoxExit(pos, posEnd, bounds)
  if (uBounds !== null) consider({ u: uBounds, kind: 'outOfBounds' })

  // 接收站接触：相对线段（对目标单步圆弧作线性近似）首次进入合并半径圆。
  const recvStart = receiverPosition(level.receiver, tStart)
  const recvEnd = receiverPosition(level.receiver, tEnd)
  const relA = { x: pos.x - recvStart.x, y: pos.y - recvStart.y }
  const relB = { x: posEnd.x - recvEnd.x, y: posEnd.y - recvEnd.y }
  const uDock = segmentCircleEntry(relA, relB, { x: 0, y: 0 }, level.receiver.radius + constants.craftRadius)
  if (uDock !== null) consider({ u: uDock, kind: 'dock' })

  if (candidates.length === 0) {
    return { event: null, posEnd, velEnd }
  }

  // 同一步多个事件：按最早 u；差值小于 1e-10 视为同时，优先级为
  // 实体碰撞 > 出界 > 接收站接触。
  let selected = candidates[0]
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i]
    const du = candidate.u - selected.u
    if (du < -EVENT_TIE_EPSILON) {
      selected = candidate
    } else if (Math.abs(du) <= EVENT_TIE_EPSILON) {
      if (EVENT_PRIORITY[candidate.kind] < EVENT_PRIORITY[selected.kind]) {
        selected = candidate
      }
    }
  }

  const u = selected.u
  const time = stepIndex * dt + u * dt
  const position = {
    x: pos.x + u * (posEnd.x - pos.x),
    y: pos.y + u * (posEnd.y - pos.y),
  }

  if (selected.kind === 'dock') {
    const tContact = time
    const recvVel = receiverVelocity(level.receiver, tContact)
    const craftVel = {
      x: velStart.x + u * (velEnd.x - velStart.x),
      y: velStart.y + u * (velEnd.y - velStart.y),
    }
    const relativeSpeed = Math.hypot(
      craftVel.x - recvVel.x,
      craftVel.y - recvVel.y,
    )
    const event: SimEvent = {
      kind: 'dock',
      stepIndex,
      u,
      time,
      position,
      relativeSpeed,
    }
    return { event, posEnd, velEnd }
  }

  const event: SimEvent = {
    kind: selected.kind,
    stepIndex,
    u,
    time,
    position,
    bodyId: selected.bodyId,
  }
  return { event, posEnd, velEnd }
}

export interface RunFlightOptions {
  ctx: SimContext
  start: SimSnapshot
  burns?: readonly BurnInput[]
}

export interface FlightResult {
  outcome: Outcome
  /** 位置序列：索引 i 对应步 start.stepIndex + i；末点为事件位置。 */
  trajectory: Vec2[]
  result: AdvanceResult
}

/** 从任意快照运行到结束，供预览与回放共用。 */
export function runFlight(opts: RunFlightOptions): FlightResult {
  const { ctx, start, burns = [] } = opts
  const constants = ctx.constants
  const maxN = maxStepCount(constants)
  // 边界校验（入口层）：微调次数、整数步号严格递增。内层 advanceOneStep 保持快速纯函数。
  if (burns.length > constants.maxBurnCount) {
    throw new Error(`微调次数 ${burns.length} 超过上限 ${constants.maxBurnCount}`)
  }
  for (let i = 1; i < burns.length; i++) {
    if (burns[i].step <= burns[i - 1].step) {
      throw new Error(`微调步号未严格递增：burns[${i - 1}].step=${burns[i - 1].step}, burns[${i}].step=${burns[i].step}`)
    }
  }
  const trajectory: Vec2[] = [{ ...start.pos }]
  let pos = start.pos
  let vel = start.vel
  let stepIndex = start.stepIndex
  let burnIdx = 0

  while (stepIndex < maxN) {
    let burn: BurnInput | undefined
    if (burnIdx < burns.length) {
      const next = burns[burnIdx]
      if (next.step < stepIndex) {
        throw new Error(`burn step ${next.step} 已过期（当前步 ${stepIndex}）`)
      }
      if (next.step === stepIndex) {
        burn = next
        burnIdx++
      }
    }
    const result = advanceOneStep(ctx, pos, vel, stepIndex, burn)
    if (result.event) {
      trajectory.push(result.event.position)
      return { outcome: outcomeFromEvent(result.event, constants), trajectory, result }
    }
    trajectory.push(result.posEnd)
    pos = result.posEnd
    vel = result.velEnd
    stepIndex++
  }

  const event: SimEvent = {
    kind: 'timeout',
    stepIndex: maxN,
    u: 0,
    time: maxN * constants.dt,
    position: { ...pos },
  }
  return {
    outcome: { kind: 'failure', reason: 'timeout', event },
    trajectory,
    result: { event, posEnd: pos, velEnd: vel },
  }
}

/** 由事件得出终局：dock 按相对速度阈值判成功或接近过快。 */
export function outcomeFromEvent(event: SimEvent, constants: PhysicsConstants): Outcome {
  if (event.kind === 'dock') {
    const relativeSpeed = event.relativeSpeed ?? 0
    if (relativeSpeed <= constants.maxDockRelativeSpeed) {
      return { kind: 'success', time: event.time, relativeSpeed, event }
    }
    return { kind: 'failure', reason: 'tooFast', event, relativeSpeed }
  }
  return { kind: 'failure', reason: event.kind, event }
}

/** 发射初始快照：stepIndex=0，发射点，瞄准速度。 */
export function launchSnapshot(level: LevelDef, aim: AimInput): SimSnapshot {
  return { stepIndex: 0, pos: { ...level.launch }, vel: aimVelocity(aim) }
}
