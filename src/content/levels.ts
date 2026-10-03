import type { LevelConfig, LevelDef } from '../physics/types.ts'
import config from './level-seeds.json' with { type: 'json' }

export const LEVEL_CONFIG: LevelConfig = config as unknown as LevelConfig

export const PHYSICS = LEVEL_CONFIG.physics
export const WORLD = LEVEL_CONFIG.world
export const PHYSICS_VERSION = LEVEL_CONFIG.physicsVersion

export const LEVELS: readonly LevelDef[] = LEVEL_CONFIG.levels

export function getLevel(id: string): LevelDef {
  const level = LEVEL_CONFIG.levels.find((l) => l.id === id)
  if (!level) throw new Error(`未知邮路 ID：${id}`)
  return level
}

export const DEFAULT_LEVEL_ID = LEVELS[0]?.id ?? 'H01'
