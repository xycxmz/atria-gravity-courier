import { DEFAULT_LEVEL_ID, PHYSICS } from '../content/levels.ts'
import type { AimInput } from '../physics/types.ts'

const STORAGE_KEY = 'gravity-courier/progress/v1'

export interface Progress {
  selectedLevel: string
  completed: Record<string, { bestTime: number; at: number }>
  lastAim: Record<string, AimInput>
  settings: { muted: boolean }
}

function defaults(): Progress {
  return { selectedLevel: DEFAULT_LEVEL_ID, completed: {}, lastAim: {}, settings: { muted: false } }
}

/** 本地只保存邮路选择、每条是否完成、最近瞄准和设置；飞行中途不持久化。 */
export function loadProgress(): Progress {
  if (typeof localStorage === 'undefined') return defaults()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults()
    const parsed = JSON.parse(raw) as Partial<Progress>
    return {
      selectedLevel: typeof parsed.selectedLevel === 'string' ? parsed.selectedLevel : DEFAULT_LEVEL_ID,
      completed: parsed.completed ?? {},
      lastAim: parsed.lastAim ?? {},
      settings: { muted: parsed.settings?.muted ?? false },
    }
  } catch {
    return defaults()
  }
}

export function saveProgress(progress: Progress): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // 存储不可用时降级为纯会话体验。
  }
}

export function isValidAim(aim: AimInput): boolean {
  return (
    Number.isFinite(aim.angleDegrees) &&
    Number.isFinite(aim.speed) &&
    aim.angleDegrees >= PHYSICS.launchAngleMinDegrees &&
    aim.angleDegrees <= PHYSICS.launchAngleMaxDegrees &&
    aim.speed >= PHYSICS.launchSpeedMin &&
    aim.speed <= PHYSICS.launchSpeedMax
  )
}

export function clampAim(aim: AimInput): AimInput {
  return {
    angleDegrees: Math.min(
      PHYSICS.launchAngleMaxDegrees,
      Math.max(PHYSICS.launchAngleMinDegrees, aim.angleDegrees),
    ),
    speed: Math.min(PHYSICS.launchSpeedMax, Math.max(PHYSICS.launchSpeedMin, aim.speed)),
  }
}
