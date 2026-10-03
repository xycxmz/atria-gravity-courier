import { PHYSICS, WORLD } from '../content/levels.ts'
import {
  advanceOneStep,
  launchSnapshot,
  maxStepCount,
  outcomeFromEvent,
  runFlight,
  type FlightResult,
  type SimContext,
} from '../physics/simulate.ts'
import type {
  AimInput,
  BurnInput,
  LevelDef,
  Outcome,
  SimEvent,
  Vec2,
} from '../physics/types.ts'

export type Phase = 'aiming' | 'flying' | 'paused' | 'burnPanel' | 'result'

export interface BurnProposal {
  angleDegrees: number
  deltaV: number
}

export interface SessionSnapshot {
  phase: Phase
  levelId: string
  aim: AimInput
  stepIndex: number
  pos: Vec2
  vel: Vec2
  burnsRemaining: number
  burnLog: readonly BurnInput[]
  outcome: Outcome | null
  /** 实飞轨迹：索引 i 对应步 i；末点为事件位置。 */
  trajectory: readonly Vec2[]
  /** 上一次尝试的轨迹，用于失败后对比。 */
  ghost: readonly Vec2[] | null
  /** burnPanel 中待定的修正方向与强度。 */
  pendingBurn: BurnProposal
  /** 打开微调面板前的阶段，取消时恢复。 */
  burnOrigin?: Phase
  /** 上一条已完成尝试的瞄准与终局（重试时归档，终局提交不覆盖），供结果卡对比。 */
  previousAttempt: { aim: AimInput; outcome: Outcome } | null
  flightTime: number
}

function initialSnapshot(levelId: string, aim: AimInput): SessionSnapshot {
  return {
    phase: 'aiming',
    levelId,
    aim,
    stepIndex: 0,
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    burnsRemaining: PHYSICS.maxBurnCount,
    burnLog: [],
    outcome: null,
    trajectory: [],
    ghost: null,
    pendingBurn: { angleDegrees: 0, deltaV: 0 },
    previousAttempt: null,
    flightTime: 0,
  }
}

/**
 * 一次投递尝试的状态机。纯内核驱动，无 React 依赖；
 * 预览与实飞共用 advanceOneStep / runFlight，保证同输入逐步一致。
 */
export class Session {
  readonly level: LevelDef
  private listeners = new Set<() => void>()
  private snap: SessionSnapshot

  constructor(level: LevelDef, aim: AimInput) {
    this.level = level
    this.snap = initialSnapshot(level.id, aim)
  }

  get ctx(): SimContext {
    return { level: this.level, constants: PHYSICS, world: WORLD }
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  getSnapshot = (): SessionSnapshot => this.snap

  private commit(snap: SessionSnapshot): void {
    this.snap = snap
    for (const l of this.listeners) l()
  }

  setAim(aim: AimInput): void {
    if (this.snap.phase !== 'aiming') return
    this.commit({ ...this.snap, aim })
  }

  launch(): void {
    if (this.snap.phase !== 'aiming') return
    const start = launchSnapshot(this.level, this.snap.aim)
    this.commit({
      ...this.snap,
      phase: 'flying',
      stepIndex: start.stepIndex,
      pos: start.pos,
      vel: start.vel,
      trajectory: [{ ...start.pos }],
      outcome: null,
      flightTime: 0,
    })
  }

  /** 每帧推进若干固定步；运算不足时减慢呈现，不跳步追赶。 */
  tick(steps: number): void {
    if (this.snap.phase !== 'flying' || steps <= 0) return
    this.runSteps(steps, 'flying')
  }

  /** 暂停下的逐步观察：推进固定步（如 +0.1s=12 步、+1s=120 步）但保持暂停。 */
  observeSteps(steps: number): void {
    if (this.snap.phase !== 'paused' || steps <= 0) return
    this.runSteps(steps, 'paused')
  }

  private runSteps(steps: number, resumePhase: Phase): void {
    const ctx = this.ctx
    const maxN = maxStepCount(PHYSICS)
    let { stepIndex, pos, vel } = this.snap
    const trajectory = this.snap.trajectory.slice()
    let outcome: Outcome | null = null
    let guard = 0

    while (outcome === null && stepIndex < maxN && guard < steps) {
      guard++
      const burn = this.snap.burnLog.find((b) => b.step === stepIndex)
      const result = advanceOneStep(ctx, pos, vel, stepIndex, burn)
      if (result.event) {
        trajectory.push(result.event.position)
        outcome = outcomeFromEvent(result.event, PHYSICS)
        break
      }
      trajectory.push(result.posEnd)
      pos = result.posEnd
      vel = result.velEnd
      stepIndex++
    }

    if (outcome === null && stepIndex >= maxN) {
      const event: SimEvent = {
        kind: 'timeout',
        stepIndex: maxN,
        u: 0,
        time: maxN * PHYSICS.dt,
        position: { ...pos },
      }
      trajectory.push({ ...pos })
      outcome = outcomeFromEvent(event, PHYSICS)
    }

    if (outcome !== null) {
      this.commit({
        ...this.snap,
        phase: 'result',
        stepIndex: outcome.event.stepIndex,
        pos: outcome.event.position,
        vel,
        trajectory,
        outcome,
        flightTime: outcome.event.time,
      })
      return
    }

    this.commit({
      ...this.snap,
      phase: resumePhase,
      stepIndex,
      pos,
      vel,
      trajectory,
      flightTime: stepIndex * PHYSICS.dt,
    })
  }

  pause(): void {
    if (this.snap.phase === 'flying') this.commit({ ...this.snap, phase: 'paused' })
  }

  resume(): void {
    if (this.snap.phase === 'paused') this.commit({ ...this.snap, phase: 'flying' })
  }

  /** 打开微调面板：自动暂停，模拟与接收站均不推进。 */
  openBurnPanel(): void {
    if (this.snap.phase !== 'flying' && this.snap.phase !== 'paused') return
    if (this.snap.burnsRemaining <= 0 || this.snap.outcome !== null) return
    this.commit({
      ...this.snap,
      phase: 'burnPanel',
      burnOrigin: this.snap.phase,
      pendingBurn: { angleDegrees: 0, deltaV: 0 },
    })
  }

  /**
   * 边界契约：非有限值与越界强度一律拒绝且不改变状态；
   * 正常范围内的钳制由 UI（NumberField/滑块）负责。
   */
  setPendingBurn(proposal: BurnProposal): void {
    if (this.snap.phase !== 'burnPanel') return
    if (!Number.isFinite(proposal.angleDegrees) || !Number.isFinite(proposal.deltaV)) return
    if (proposal.deltaV < 0 || proposal.deltaV > PHYSICS.maxBurnDeltaV) return
    this.commit({ ...this.snap, pendingBurn: { ...proposal } })
  }

  /** 确认非零修正才消耗次数；零值确认等同取消，不消耗。确认后恢复飞行。 */
  confirmBurn(): void {
    if (this.snap.phase !== 'burnPanel') return
    const { pendingBurn, burnLog, stepIndex } = this.snap
    const resumeTo = this.snap.burnOrigin === 'paused' ? 'paused' : 'flying'
    if (pendingBurn.deltaV > 0) {
      const entry: BurnInput = {
        step: stepIndex,
        angleDegrees: pendingBurn.angleDegrees,
        deltaV: pendingBurn.deltaV,
      }
      this.commit({
        ...this.snap,
        phase: resumeTo,
        burnOrigin: undefined,
        burnLog: [...burnLog, entry],
        burnsRemaining: this.snap.burnsRemaining - 1,
        pendingBurn: { angleDegrees: 0, deltaV: 0 },
      })
      return
    }
    this.commit({
      ...this.snap,
      phase: resumeTo,
      burnOrigin: undefined,
      pendingBurn: { angleDegrees: 0, deltaV: 0 },
    })
  }

  cancelBurn(): void {
    if (this.snap.phase !== 'burnPanel') return
    const resumeTo = this.snap.burnOrigin === 'paused' ? 'paused' : 'flying'
    this.commit({ ...this.snap, phase: resumeTo, burnOrigin: undefined, pendingBurn: { angleDegrees: 0, deltaV: 0 } })
  }

  /** 重试：保留瞄准参数，世界相位回到起点，保留上一条轨迹供对比。 */
  retry(): void {
    if (this.snap.phase === 'aiming') return
    const start = launchSnapshot(this.level, this.snap.aim)
    this.commit({
      ...initialSnapshot(this.level.id, this.snap.aim),
      previousAttempt: this.snap.outcome
        ? { aim: this.snap.aim, outcome: this.snap.outcome }
        : this.snap.previousAttempt,
      ghost: this.snap.trajectory.length > 0 ? this.snap.trajectory : this.snap.ghost,
      stepIndex: start.stepIndex,
      pos: start.pos,
      vel: start.vel,
      trajectory: [{ ...start.pos }],
    })
  }

  /**
   * 从当前状态与拟执行输入生成的预览（预览与实飞同内核）。
   * 仅在瞄准与微调面板阶段返回结果；飞行中不剧透未来轨迹。
   * 过去的微调已烘焙进当前状态，预览只携带待定的修正。
   */
  preview(): FlightResult | null {
    const { phase, stepIndex, pos, vel, pendingBurn } = this.snap
    if (phase === 'burnPanel') {
      if (pendingBurn.deltaV <= 0) {
        return runFlight({ ctx: this.ctx, start: { stepIndex, pos, vel } })
      }
      const burn: BurnInput = {
        step: stepIndex,
        angleDegrees: pendingBurn.angleDegrees,
        deltaV: pendingBurn.deltaV,
      }
      return runFlight({ ctx: this.ctx, start: { stepIndex, pos, vel }, burns: [burn] })
    }
    if (phase === 'aiming') {
      return runFlight({ ctx: this.ctx, start: launchSnapshot(this.level, this.snap.aim) })
    }
    return null
  }

  hasPreview(): boolean {
    return this.snap.phase === 'aiming' || this.snap.phase === 'burnPanel'
  }
}
