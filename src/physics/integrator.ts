import type { Vec2 } from './types.ts'

export interface StepResult {
  posStart: Vec2
  velStart: Vec2
  posEnd: Vec2
  velEnd: Vec2
}

/**
 * velocity Verlet 单步，计算顺序固定：
 *   a0 = acceleration(p)
 *   vHalf = v + a0 * dt / 2
 *   pNext = p + vHalf * dt
 *   a1 = acceleration(pNext)
 *   vNext = vHalf + a1 * dt / 2
 * acc 由调用方提供，保证预览与实飞使用同一实现。
 */
export function integrateStep(
  pos: Vec2,
  vel: Vec2,
  dt: number,
  acc: (p: Vec2) => Vec2,
): StepResult {
  const a0 = acc(pos)
  const vHalfX = vel.x + (a0.x * dt) / 2
  const vHalfY = vel.y + (a0.y * dt) / 2
  const posEnd = { x: pos.x + vHalfX * dt, y: pos.y + vHalfY * dt }
  const a1 = acc(posEnd)
  const velEnd = { x: vHalfX + (a1.x * dt) / 2, y: vHalfY + (a1.y * dt) / 2 }
  return { posStart: pos, velStart: vel, posEnd, velEnd }
}
