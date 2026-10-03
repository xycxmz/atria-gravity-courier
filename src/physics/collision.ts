import type { Vec2 } from './types.ts'

/** 同一步内事件按最早 u 排序时，u 差值小于该阈值视为同一时刻。 */
export const EVENT_TIE_EPSILON = 1e-10

export interface Box {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * 线段 a→b 首次进入圆 (center, radius) 的参数 u，范围 [0, 1]。
 * 起点已在圆内返回 0；不相交返回 null。
 * 相切（判别式为 0）按接触处理，返回切点参数，不产生 NaN。
 * 零长度线段：起点在圆内返回 0，否则 null。
 */
export function segmentCircleEntry(
  a: Vec2,
  b: Vec2,
  center: Vec2,
  radius: number,
): number | null {
  const fx = a.x - center.x
  const fy = a.y - center.y
  const c = fx * fx + fy * fy - radius * radius
  if (c <= 0) return 0

  const dx = b.x - a.x
  const dy = b.y - a.y
  const A = dx * dx + dy * dy
  if (A === 0) return null

  const B = 2 * (fx * dx + fy * dy)
  const disc = B * B - 4 * A * c
  if (disc < 0) return null

  // 较小根 u1 为首次进入点。c > 0 时两根同号（或复数），
  // 因此只需检查 u1 是否落在 [0,1]。
  const u1 = (-B - Math.sqrt(disc)) / (2 * A)
  if (u1 >= 0 && u1 <= 1) return u1
  return null
}

/**
 * 线段 a→b 首次离开盒子 box 的参数 u，范围 [0, 1]。
 * 起点在盒外返回 0；整段都在盒内返回 null。
 * 起点在凸盒内时，第一个越界的坐标分量给出出界时刻。
 */
export function segmentBoxExit(a: Vec2, b: Vec2, box: Box): number | null {
  if (a.x < box.minX || a.x > box.maxX || a.y < box.minY || a.y > box.maxY) {
    return 0
  }
  const dx = b.x - a.x
  const dy = b.y - a.y
  let exit = Infinity
  if (dx > 0) exit = Math.min(exit, (box.maxX - a.x) / dx)
  else if (dx < 0) exit = Math.min(exit, (box.minX - a.x) / dx)
  if (dy > 0) exit = Math.min(exit, (box.maxY - a.y) / dy)
  else if (dy < 0) exit = Math.min(exit, (box.minY - a.y) / dy)
  if (!Number.isFinite(exit) || exit > 1) return null
  return exit < 0 ? 0 : exit
}
