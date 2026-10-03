import { launchSnapshot, maxStepCount, runFlight } from '../physics/simulate.ts'
import { LEVEL_CONFIG, PHYSICS, PHYSICS_VERSION, WORLD } from '../content/levels.ts'
import type { BurnInput, InputLog, LevelDef } from '../physics/types.ts'

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

/**
 * 输入日志严格验证（H-T14）。
 * 不静默修正输入：任何越界、NaN、超次数、负 deltaV 或时机错误的修正都判为失败。
 */
export function validateInputLog(log: InputLog): ValidationResult {
  const errors: string[] = []
  const level = LEVELS_LOOKUP[log.levelId]
  if (!level) {
    return { ok: false, errors: [`未知邮路 ID：${log.levelId}`] }
  }
  if (log.physicsVersion !== PHYSICS_VERSION) {
    errors.push(`physicsVersion 不匹配：${log.physicsVersion} ≠ ${PHYSICS_VERSION}`)
  }

  if (!Number.isFinite(log.angleDegrees) || !Number.isFinite(log.speed)) {
    errors.push('瞄准角度或速度不是有限数值')
  } else {
    if (log.angleDegrees < PHYSICS.launchAngleMinDegrees || log.angleDegrees > PHYSICS.launchAngleMaxDegrees) {
      errors.push(
        `发射角度 ${log.angleDegrees} 超出 [${PHYSICS.launchAngleMinDegrees}, ${PHYSICS.launchAngleMaxDegrees}]`,
      )
    }
    if (log.speed < PHYSICS.launchSpeedMin || log.speed > PHYSICS.launchSpeedMax) {
      errors.push(`初速度 ${log.speed} 超出 [${PHYSICS.launchSpeedMin}, ${PHYSICS.launchSpeedMax}]`)
    }
  }

  if (!Array.isArray(log.burns)) {
    errors.push('burns 不是数组')
    return { ok: errors.length === 0, errors }
  }
  if (log.burns.length > PHYSICS.maxBurnCount) {
    errors.push(`微调次数 ${log.burns.length} 超过上限 ${PHYSICS.maxBurnCount}`)
  }

  const maxN = maxStepCount(PHYSICS)
  let prevStep = -1
  log.burns.forEach((burn: BurnInput, i: number) => {
    const label = `burns[${i}]`
    if (!Number.isFinite(burn.step) || !Number.isFinite(burn.angleDegrees) || !Number.isFinite(burn.deltaV)) {
      errors.push(`${label} 含 NaN 或非有限值`)
      return
    }
    if (!Number.isInteger(burn.step)) {
      errors.push(`${label} step=${burn.step} 不是整数`)
    }
    if (burn.step < 0 || burn.step >= maxN) {
      errors.push(`${label} step=${burn.step} 超出 [0, ${maxN - 1}]`)
    }
    if (burn.step <= prevStep) {
      errors.push(`${label} step=${burn.step} 未按递增顺序或重复`)
    }
    prevStep = burn.step
    if (burn.deltaV < 0 || burn.deltaV > PHYSICS.maxBurnDeltaV) {
      errors.push(`${label} deltaV=${burn.deltaV} 超出 [0, ${PHYSICS.maxBurnDeltaV}]`)
    }
  })

  if (errors.length > 0) return { ok: false, errors }

  // 时机验证：修正必须落在飞行尚未结束的整数步上。
  // 事件发生在终局步的线段内，而该步起点的修正在事件之前应用，因此
  // burn.step 等于终局步仍合法，只有严格晚于终局步才非法。
  const snapshot = launchSnapshot(level, { angleDegrees: log.angleDegrees, speed: log.speed })
  try {
    const result = runFlight({ ctx: { level, constants: PHYSICS, world: WORLD }, start: snapshot, burns: log.burns })
    const terminal = result.outcome.event.stepIndex
    for (let i = 0; i < log.burns.length; i++) {
      if (log.burns[i].step > terminal) {
        errors.push(`burns[${i}].step=${log.burns[i].step} 晚于终局步 ${terminal}`)
      }
    }
  } catch (err) {
    errors.push(`回放模拟出错：${err instanceof Error ? err.message : String(err)}`)
  }

  return { ok: errors.length === 0, errors }
}

const LEVELS_LOOKUP: Record<string, LevelDef> = Object.fromEntries(
  LEVEL_CONFIG.levels.map((l) => [l.id, l]),
)
