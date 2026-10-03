import type { ReceiverDef, Vec2 } from './types.ts'

/** 接收站在绝对时刻 absoluteTime 的位置。运动站不受重力影响。 */
export function receiverPosition(receiver: ReceiverDef, absoluteTime: number): Vec2 {
  if (receiver.kind === 'fixed') {
    return { x: receiver.x, y: receiver.y }
  }
  const theta = receiver.phase + receiver.omega * absoluteTime
  return {
    x: receiver.cx + receiver.orbitRadius * Math.cos(theta),
    y: receiver.cy + receiver.orbitRadius * Math.sin(theta),
  }
}

/** 接收站在绝对时刻 absoluteTime 的解析速度。 */
export function receiverVelocity(receiver: ReceiverDef, absoluteTime: number): Vec2 {
  if (receiver.kind === 'fixed') {
    return { x: 0, y: 0 }
  }
  const theta = receiver.phase + receiver.omega * absoluteTime
  return {
    x: -receiver.orbitRadius * receiver.omega * Math.sin(theta),
    y: receiver.orbitRadius * receiver.omega * Math.cos(theta),
  }
}
