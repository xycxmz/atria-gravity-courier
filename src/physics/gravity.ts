import type { BodyDef, Vec2 } from './types.ts'

/**
 * 计算位置 pos 处所有天体产生的加速度。
 * factor = mu / (dx*dx + dy*dy + softening^2)^(3/2)
 * 软化长度避免中心附近公式奇异，不取消实体碰撞。
 */
export function accelerationAt(
  pos: Vec2,
  bodies: readonly BodyDef[],
  softening: number,
): Vec2 {
  let ax = 0
  let ay = 0
  const s2 = softening * softening
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i]
    if (body.mu === 0) continue
    const dx = body.x - pos.x
    const dy = body.y - pos.y
    const dist2 = dx * dx + dy * dy + s2
    const factor = body.mu / (dist2 * Math.sqrt(dist2))
    ax += dx * factor
    ay += dy * factor
  }
  return { x: ax, y: ay }
}
