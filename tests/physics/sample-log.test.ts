import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { PHYSICS, PHYSICS_VERSION, WORLD, getLevel } from '../../src/content/levels.ts'
import { launchSnapshot, runFlight } from '../../src/physics/simulate.ts'
import { validateInputLog } from '../../src/game/inputLog.ts'
import type { BurnInput, InputLog } from '../../src/physics/types.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const raw = readFileSync(join(__dirname, '..', 'fixtures', 'sample-input-log.json'), 'utf-8')
const sample = JSON.parse(raw) as InputLog & { expectedOutcome: { kind: string; time: number; stepsExecuted: number } }

describe('输入日志样例', () => {
  it('样例日志通过严格验证', () => {
    const v = validateInputLog(sample)
    expect(v.ok).toBe(true)
    if (!v.ok) console.error(v.errors)
  })

  it('样例日志可完整复现：终局、时间、修正步号一致', () => {
    const level = getLevel(sample.levelId)
    const result = runFlight({
      ctx: { level, constants: PHYSICS, world: WORLD },
      start: launchSnapshot(level, { angleDegrees: sample.angleDegrees, speed: sample.speed }),
      burns: sample.burns as BurnInput[],
    })
    expect(result.outcome.kind).toBe(sample.expectedOutcome.kind)
    if (result.outcome.kind === 'success') {
      expect(Math.abs(result.outcome.time - sample.expectedOutcome.time)).toBeLessThanOrEqual(1e-6)
    }
    expect(result.trajectory.length).toBe(sample.expectedOutcome.stepsExecuted)
    // 修正确实在 step=240 被应用（H-T13 回放语义）
    const burn: BurnInput = sample.burns[0]
    expect(burn.step).toBe(240)
  })

  it('样例日志携带邮路物理版本号，版本不匹配时拒绝', () => {
    const bad = { ...sample, physicsVersion: '0.0-other' }
    expect(validateInputLog(bad).ok).toBe(false)
    void PHYSICS_VERSION
  })
})
