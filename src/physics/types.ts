// 引力邮差物理内核类型定义。
// 世界坐标：左上为原点，X 向右、Y 向下，世界 1000 × 700 单位。
// 正角度从右方向下旋转；角度输入用度，内部三角函数用弧度。

export interface Vec2 {
  x: number
  y: number
}

/** 天体：固定位置，不互相绕转。mu=0 表示无引力障碍（只碰撞不吸引）。 */
export interface BodyDef {
  id: string
  x: number
  y: number
  radius: number
  mu: number
}

/** 接收站：固定站或按预定圆周函数运动的站，不受重力影响。 */
export type ReceiverDef =
  | { kind: 'fixed'; x: number; y: number; radius: number }
  | {
      kind: 'orbit'
      cx: number
      cy: number
      orbitRadius: number
      omega: number
      phase: number
      radius: number
    }

export interface LevelDef {
  id: string
  name: string
  launch: Vec2
  bodies: BodyDef[]
  receiver: ReceiverDef
  defaultAim: { angleDegrees: number; speed: number }
  teachingFocus: string
}

export interface PhysicsConstants {
  /** 固定逻辑步长（秒） */
  dt: number
  maxFlightSeconds: number
  softening: number
  craftRadius: number
  launchSpeedMin: number
  launchSpeedMax: number
  launchAngleMinDegrees: number
  launchAngleMaxDegrees: number
  maxBurnDeltaV: number
  maxBurnCount: number
  maxDockRelativeSpeed: number
}

export interface WorldDef {
  width: number
  height: number
}

export interface LevelConfig {
  schemaVersion: number
  physicsVersion: string
  world: WorldDef
  physics: PhysicsConstants
  levels: LevelDef[]
}

/** 玩家瞄准输入：发射角度（度，-70..70，正为向下）与初速度。 */
export interface AimInput {
  angleDegrees: number
  speed: number
}

/** 一次中途微调：在整数步 step 的起点把速度增加 deltaV（角度方向，0..24，360° 任意方向）。 */
export interface BurnInput {
  step: number
  angleDegrees: number
  deltaV: number
}

/** 可复现的确定性输入日志。 */
export interface InputLog {
  physicsVersion: string
  levelId: string
  angleDegrees: number
  speed: number
  burns: BurnInput[]
}

export interface SimSnapshot {
  /** 整数步号；绝对时间 = stepIndex * dt。 */
  stepIndex: number
  pos: Vec2
  vel: Vec2
}

export type EventKind = 'dock' | 'collide' | 'outOfBounds' | 'timeout'

/** 一步内检测到的首个事件。时间 = stepIndex * dt + u * dt。 */
export interface SimEvent {
  kind: EventKind
  stepIndex: number
  /** 事件在步内线段上的参数位置，0 至 1。 */
  u: number
  time: number
  position: Vec2
  /** collide：碰撞天体 id。 */
  bodyId?: string
  /** dock / tooFast：接触时的相对速度。 */
  relativeSpeed?: number
}

export type Outcome =
  | { kind: 'success'; time: number; relativeSpeed: number; event: SimEvent }
  | {
      kind: 'failure'
      reason: 'collide' | 'outOfBounds' | 'tooFast' | 'timeout'
      event: SimEvent
      /** tooFast 时的相对速度与阈值，用于反馈。 */
      relativeSpeed?: number
    }
