import { PHYSICS, WORLD } from '../content/levels.ts'
import { receiverPosition, receiverVelocity } from '../physics/receiver.ts'
import type { FlightResult } from '../physics/simulate.ts'
import type { LevelDef, Vec2 } from '../physics/types.ts'
import type { SessionSnapshot } from '../game/session.ts'

export const COLORS = {
  background: '#101927',
  preview: '#F4CF7A',
  craft: '#F4F1DF',
  receiver: '#74C8B8',
  danger: '#E68A7C',
  aux: '#657C96',
} as const

export interface WorldTransform {
  scale: number
  offsetX: number
  offsetY: number
  worldToScreen: (p: Vec2) => Vec2
  /** CSS 像素（含留边）→ 世界坐标，用于拖杆角度计算。 */
  screenToWorld: (p: Vec2) => Vec2
}

/**
 * 世界 1000×700 按比例适配并留边，不裁掉关键星体和目标。
 */
export function createWorldTransform(cssWidth: number, cssHeight: number, padding = 20): WorldTransform {
  const usableW = Math.max(1, cssWidth - padding * 2)
  const usableH = Math.max(1, cssHeight - padding * 2)
  const scale = Math.min(usableW / WORLD.width, usableH / WORLD.height)
  const offsetX = (cssWidth - WORLD.width * scale) / 2
  const offsetY = (cssHeight - WORLD.height * scale) / 2
  return {
    scale,
    offsetX,
    offsetY,
    worldToScreen: (p: Vec2) => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY }),
    screenToWorld: (p: Vec2) => ({ x: (p.x - offsetX) / scale, y: (p.y - offsetY) / scale }),
  }
}

/** 确定性星点（线性同余 PRNG，无视差不闪烁）。 */
function deterministicStars(count: number): Array<{ x: number; y: number; r: number; a: number }> {
  let seed = 20261003
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const stars = []
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rand() * WORLD.width,
      y: rand() * WORLD.height,
      r: 0.5 + rand() * 1.1,
      a: 0.12 + rand() * 0.28,
    })
  }
  return stars
}

const STARS = deterministicStars(90)

export interface DrawParams {
  ctx: CanvasRenderingContext2D
  cssWidth: number
  cssHeight: number
  level: LevelDef
  snapshot: SessionSnapshot
  preview: FlightResult | null
  /** 预览轨迹起点对应的整数步（瞄准为 0，微调为当前步）。 */
  previewStartStep: number
  /** 时间检查游标（绝对游戏秒）；null 不绘制。 */
  inspectT: number | null
  /** 距离结果出现的秒数，用于成功环形扩散。 */
  outcomeAnim: number
  reducedMotion: boolean
}

export function drawWorld(params: DrawParams): void {
  const { ctx, cssWidth, cssHeight, level, snapshot, preview, previewStartStep, outcomeAnim, reducedMotion } = params
  const t = createWorldTransform(cssWidth, cssHeight)
  const { scale } = t

  ctx.save()
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, cssWidth, cssHeight)

  // 世界框
  const screenWorld = t.worldToScreen({ x: 0, y: 0 })
  ctx.strokeStyle = 'rgba(101,124,150,0.35)'
  ctx.lineWidth = 1
  ctx.strokeRect(screenWorld.x, screenWorld.y, WORLD.width * scale, WORLD.height * scale)

  // 星点
  ctx.fillStyle = COLORS.craft
  for (const star of STARS) {
    const p = t.worldToScreen(star)
    ctx.globalAlpha = star.a
    ctx.beginPath()
    ctx.arc(p.x, p.y, Math.max(0.5, star.r * scale), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // 接收站轨道（点划线，与飞船轨迹区分）
  if (level.receiver.kind === 'orbit') {
    const c = t.worldToScreen({ x: level.receiver.cx, y: level.receiver.cy })
    ctx.strokeStyle = COLORS.aux
    ctx.lineWidth = 1.2
    ctx.setLineDash([8, 6, 2, 6])
    ctx.beginPath()
    ctx.arc(c.x, c.y, level.receiver.orbitRadius * scale, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 天体：引力源（同心环标记）；无引力障碍（虚线轮廓 + 静石标签）
  for (const body of level.bodies) {
    const c = t.worldToScreen({ x: body.x, y: body.y })
    const r = body.radius * scale
    ctx.beginPath()
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(101,124,150,0.28)'
    ctx.fill()
    ctx.strokeStyle = body.mu > 0 ? COLORS.aux : COLORS.danger
    ctx.lineWidth = body.mu > 0 ? 2 : 1.6
    if (body.mu === 0) ctx.setLineDash([5, 4])
    ctx.stroke()
    ctx.setLineDash([])
    if (body.mu > 0) {
      for (let ring = 1; ring <= 2; ring++) {
        ctx.beginPath()
        ctx.arc(c.x, c.y, r + 6 * ring + 2, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(101,124,150,0.5)'
        ctx.lineWidth = 1
        ctx.stroke()
      }
      // 中心十字
      ctx.beginPath()
      ctx.moveTo(c.x - 4, c.y)
      ctx.lineTo(c.x + 4, c.y)
      ctx.moveTo(c.x, c.y - 4)
      ctx.lineTo(c.x, c.y + 4)
      ctx.strokeStyle = COLORS.aux
      ctx.lineWidth = 1
      ctx.stroke()
    } else {
      ctx.fillStyle = COLORS.danger
      ctx.font = '13px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('静石', c.x, c.y + r + 12)
    }
  }

  // 接收站当前位置（圆环 + 朝速度方向的缺口）
  const receiverTime =
    snapshot.phase === 'result' && snapshot.outcome
      ? snapshot.outcome.event.time
      : snapshot.phase === 'aiming'
        ? 0
        : snapshot.stepIndex * PHYSICS.dt
  const recvPos = receiverPosition(level.receiver, receiverTime)
  const recvVel = receiverVelocity(level.receiver, receiverTime)
  const velocityDir = Math.atan2(recvVel.y, recvVel.x)
  drawReceiver(ctx, t, recvPos, level.receiver.radius * scale, velocityDir)

  // 发射点标记
  const launchScreen = t.worldToScreen(level.launch)
  ctx.strokeStyle = COLORS.aux
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(launchScreen.x, launchScreen.y, 7, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(launchScreen.x - 10, launchScreen.y)
  ctx.lineTo(launchScreen.x + 10, launchScreen.y)
  ctx.moveTo(launchScreen.x, launchScreen.y - 10)
  ctx.lineTo(launchScreen.x, launchScreen.y + 10)
  ctx.stroke()

  // 可发射扇区边界（仅瞄准时）
  if (snapshot.phase === 'aiming') {
    drawAimSector(ctx, t, level.launch)
    drawAimArrow(ctx, t, level.launch, snapshot.aim)
  }

  // 上一条轨迹（对比，点线）
  if (snapshot.ghost && snapshot.ghost.length > 1) {
    drawPolyline(ctx, t, snapshot.ghost, { color: COLORS.aux, width: 1.4, dash: [2, 5], alpha: 0.7 })
  }

  // 预测线（虚线 + 每秒时间点 + 首个事件标记 + 接收站同时刻虚线位置）
  if (preview && (snapshot.phase === 'aiming' || snapshot.phase === 'burnPanel')) {
    drawPreview(ctx, t, preview, previewStartStep, level, snapshot)
  }

  // 实飞轨迹（实线）
  if (snapshot.trajectory.length > 1 && snapshot.phase !== 'aiming') {
    drawPolyline(ctx, t, snapshot.trajectory, { color: COLORS.craft, width: 2, dash: [], alpha: 0.95 })
  }

  // 事件标记与飞船
  drawCraft(ctx, t, level, snapshot)
  if (snapshot.phase === 'burnPanel' && snapshot.pendingBurn.deltaV > 0) {
    drawBurnVector(ctx, t, snapshot)
  }
  if (params.inspectT !== null) {
    drawInspect(ctx, t, level, snapshot, params.preview, params.previewStartStep, params.inspectT)
  }
  if (snapshot.phase === 'result' && snapshot.outcome) {
    drawEventMarker(ctx, t, snapshot.outcome, outcomeAnim, reducedMotion)
  }

  // 图例（形状 + 线型 + 文字，色盲安全）
  drawLegend(ctx, t)

  ctx.restore()
}

function drawReceiver(
  ctx: CanvasRenderingContext2D,
  t: WorldTransform,
  pos: Vec2,
  radius: number,
  velocityDir: number,
): void {
  const c = t.worldToScreen(pos)
  ctx.beginPath()
  ctx.arc(c.x, c.y, radius, 0, Math.PI * 2)
  ctx.strokeStyle = COLORS.receiver
  ctx.lineWidth = 2.5
  ctx.stroke()
  // 缺口方向依据真实运动速度（固定站速度为 0，缺口朝右）
  ctx.beginPath()
  ctx.arc(c.x, c.y, radius + 4, velocityDir - 0.5, velocityDir + 0.5)
  ctx.strokeStyle = 'rgba(116,200,184,0.55)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fillStyle = 'rgba(116,200,184,0.16)'
  ctx.beginPath()
  ctx.arc(c.x, c.y, radius, 0, Math.PI * 2)
  ctx.fill()
}

function drawAimSector(ctx: CanvasRenderingContext2D, t: WorldTransform, launch: Vec2): void {
  const c = t.worldToScreen(launch)
  const length = 150 * t.scale
  for (const deg of [PHYSICS.launchAngleMinDegrees, PHYSICS.launchAngleMaxDegrees]) {
    const rad = (deg * Math.PI) / 180
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(c.x + length * Math.cos(rad), c.y + length * Math.sin(rad))
    ctx.strokeStyle = 'rgba(101,124,150,0.45)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 5])
    ctx.stroke()
    ctx.setLineDash([])
  }
}

function drawAimArrow(
  ctx: CanvasRenderingContext2D,
  t: WorldTransform,
  launch: Vec2,
  aim: { angleDegrees: number; speed: number },
): void {
  const c = t.worldToScreen(launch)
  const rad = (aim.angleDegrees * Math.PI) / 180
  const length = 70 + (aim.speed / PHYSICS.launchSpeedMax) * 90
  const ex = c.x + length * t.scale * Math.cos(rad)
  const ey = c.y + length * t.scale * Math.sin(rad)
  ctx.beginPath()
  ctx.moveTo(c.x, c.y)
  ctx.lineTo(ex, ey)
  ctx.strokeStyle = COLORS.preview
  ctx.lineWidth = 2
  ctx.setLineDash([6, 4])
  ctx.stroke()
  ctx.setLineDash([])
  // 箭头
  const ah = 10
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - ah * Math.cos(rad - 0.4), ey - ah * Math.sin(rad - 0.4))
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - ah * Math.cos(rad + 0.4), ey - ah * Math.sin(rad + 0.4))
  ctx.strokeStyle = COLORS.preview
  ctx.lineWidth = 2
  ctx.stroke()
}

interface PolylineStyle {
  color: string
  width: number
  dash: number[]
  alpha: number
}

function drawPolyline(ctx: CanvasRenderingContext2D, t: WorldTransform, pts: readonly Vec2[], style: PolylineStyle): void {
  if (pts.length < 2) return
  ctx.save()
  ctx.strokeStyle = style.color
  ctx.lineWidth = style.width
  ctx.setLineDash(style.dash)
  ctx.globalAlpha = style.alpha
  ctx.lineJoin = 'round'
  ctx.beginPath()
  const first = t.worldToScreen(pts[0])
  ctx.moveTo(first.x, first.y)
  for (let i = 1; i < pts.length; i++) {
    const p = t.worldToScreen(pts[i])
    ctx.lineTo(p.x, p.y)
  }
  ctx.stroke()
  ctx.restore()
}

function drawPreview(
  ctx: CanvasRenderingContext2D,
  t: WorldTransform,
  preview: FlightResult,
  previewStartStep: number,
  level: LevelDef,
  snapshot: SessionSnapshot,
): void {
  const pts = preview.trajectory
  drawPolyline(ctx, t, pts, { color: COLORS.preview, width: 2, dash: [7, 5], alpha: 0.9 })

  // 每秒时间点
  const startAbs = previewStartStep * PHYSICS.dt
  const eventTime = preview.outcome.event.time
  ctx.fillStyle = COLORS.preview
  for (let s = Math.ceil(startAbs); s <= eventTime; s++) {
    if (s <= 0) continue
    const index = Math.round(s / PHYSICS.dt) - previewStartStep
    if (index < 0 || index >= pts.length) continue
    const p = t.worldToScreen(pts[index])
    ctx.beginPath()
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
    ctx.fill()
    if (s % 5 === 0) {
      ctx.font = '12px system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`${s}s`, p.x + 6, p.y - 5)
    }
  }

  // 预览终点的首个事件标记（预测终点不越过首个事件）；按真实终局分色分形状，
  // 接近过快不能画成与成功相同的样式。
  const ev = preview.outcome
  const success = ev.kind === 'success'
  const p = t.worldToScreen(ev.event.position)
  ctx.strokeStyle = success ? COLORS.receiver : COLORS.danger
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(p.x, p.y, 7, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(p.x - 4, p.y - 4)
  ctx.lineTo(p.x + 4, p.y + 4)
  ctx.moveTo(p.x + 4, p.y - 4)
  ctx.lineTo(p.x - 4, p.y + 4)
  ctx.stroke()
  ctx.font = '13px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = success ? COLORS.receiver : COLORS.danger
  ctx.fillText(success ? '预计成功' : '预计失败', p.x + 11, p.y - 8)

  // 运动接收站：相同时刻的虚线位置 + 虚线连线
  if (level.receiver.kind === 'orbit') {
    const future = receiverPosition(level.receiver, ev.event.time)
    const current = receiverPosition(level.receiver, snapshot.phase === 'aiming' ? 0 : snapshot.stepIndex * PHYSICS.dt)
    const fp = t.worldToScreen(future)
    const cp = t.worldToScreen(current)
    ctx.strokeStyle = COLORS.receiver
    ctx.lineWidth = 1.6
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(cp.x, cp.y)
    ctx.lineTo(fp.x, fp.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(fp.x, fp.y, level.receiver.radius * t.scale, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  }
}

/**
 * 时间检查游标：在已有轨迹缓存上画同刻的飞船与接收站、二者连线与距离。
 * 不改变真实步号、相位或结果；预览态查预览缓存，实飞态查实飞轨迹。
 */
function drawInspect(
  ctx: CanvasRenderingContext2D,
  t: WorldTransform,
  level: LevelDef,
  snapshot: SessionSnapshot,
  preview: FlightResult | null,
  previewStartStep: number,
  inspectT: number,
): void {
  const onPreview = (snapshot.phase === 'aiming' || snapshot.phase === 'burnPanel') && preview
  const pts = onPreview ? preview.trajectory : snapshot.trajectory
  const startStep = onPreview ? previewStartStep : 0
  const idx = Math.round(inspectT / PHYSICS.dt) - startStep
  if (idx < 0 || idx >= pts.length || pts.length === 0) return // 超出缓存范围不画假同刻
  const i = idx
  const craft = pts[i]
  const recv = receiverPosition(level.receiver, inspectT)

  const cp = t.worldToScreen(craft)
  const rp = t.worldToScreen(recv)
  ctx.save()
  // 飞船同刻位置：空心三角标记
  ctx.strokeStyle = COLORS.craft
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cp.x, cp.y, 8, 0, Math.PI * 2)
  ctx.stroke()
  // 接收站同刻位置：虚线圆环
  ctx.strokeStyle = COLORS.receiver
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.arc(rp.x, rp.y, level.receiver.radius * t.scale, 0, Math.PI * 2)
  ctx.stroke()
  // 同刻连线
  ctx.beginPath()
  ctx.moveTo(cp.x, cp.y)
  ctx.lineTo(rp.x, rp.y)
  ctx.stroke()
  ctx.setLineDash([])
  // 时间与距离标注（距离为世界单位，非可对接距离）
  const distWorld = Math.hypot(recv.x - craft.x, recv.y - craft.y)
  ctx.fillStyle = COLORS.preview
  ctx.font = '13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  const mx = (cp.x + rp.x) / 2
  const my = (cp.y + rp.y) / 2
  ctx.fillText(`${inspectT.toFixed(2)}s · 相距 ${distWorld.toFixed(0)}`, mx, my - 8)
  ctx.restore()
}

/** 微调面板期：在飞船处画拟修正矢量箭头（可拖动该方向）。 */
function drawBurnVector(ctx: CanvasRenderingContext2D, t: WorldTransform, snapshot: SessionSnapshot): void {
  const { pendingBurn, pos } = snapshot
  const c = t.worldToScreen(pos)
  const rad = (pendingBurn.angleDegrees * Math.PI) / 180
  const length = (40 + pendingBurn.deltaV * 5) * t.scale
  const ex = c.x + length * Math.cos(rad)
  const ey = c.y + length * Math.sin(rad)
  ctx.save()
  ctx.strokeStyle = COLORS.preview
  ctx.lineWidth = 2.5
  ctx.setLineDash([2, 0])
  ctx.beginPath()
  ctx.moveTo(c.x, c.y)
  ctx.lineTo(ex, ey)
  ctx.stroke()
  const ah = 12
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - ah * Math.cos(rad - 0.35), ey - ah * Math.sin(rad - 0.35))
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - ah * Math.cos(rad + 0.35), ey - ah * Math.sin(rad + 0.35))
  ctx.stroke()
  ctx.fillStyle = COLORS.preview
  ctx.font = '13px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(`Δv ${pendingBurn.deltaV}`, ex + 8, ey - 6)
  ctx.font = '13px system-ui, sans-serif'
  ctx.fillText('从飞船拖出方向', c.x + 10, c.y + 18)
  ctx.restore()
}

function drawCraft(
  ctx: CanvasRenderingContext2D,
  t: WorldTransform,
  level: LevelDef,
  snapshot: SessionSnapshot,
): void {
  if (snapshot.phase === 'aiming') {
    drawCraftTriangle(ctx, t, level.launch, (snapshot.aim.angleDegrees * Math.PI) / 180)
    return
  }
  drawCraftTriangle(ctx, t, snapshot.pos, Math.atan2(snapshot.vel.y, snapshot.vel.x))
}

function drawCraftTriangle(ctx: CanvasRenderingContext2D, t: WorldTransform, pos: Vec2, dir: number): void {
  const c = t.worldToScreen(pos)
  const size = 9
  ctx.save()
  ctx.translate(c.x, c.y)
  ctx.rotate(dir)
  ctx.beginPath()
  ctx.moveTo(size, 0)
  ctx.lineTo(-size * 0.7, -size * 0.6)
  ctx.lineTo(-size * 0.4, 0)
  ctx.lineTo(-size * 0.7, size * 0.6)
  ctx.closePath()
  ctx.fillStyle = COLORS.craft
  ctx.fill()
  ctx.strokeStyle = COLORS.background
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}

function drawEventMarker(
  ctx: CanvasRenderingContext2D,
  t: WorldTransform,
  outcome: SessionSnapshot['outcome'],
  outcomeAnim: number,
  reducedMotion: boolean,
): void {
  if (!outcome) return
  const p = t.worldToScreen(outcome.event.position)
  if (outcome.kind === 'success') {
    // 短暂环形扩散（reduced-motion 时只画一个静态环）
    ctx.strokeStyle = COLORS.receiver
    ctx.lineWidth = 2.5
    if (reducedMotion) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 14, 0, Math.PI * 2)
      ctx.stroke()
      return
    }
    const phase = Math.min(1, outcomeAnim / 0.9)
    for (let ring = 0; ring < 2; ring++) {
      const r = 8 + (phase + ring * 0.35) * 22
      ctx.globalAlpha = (1 - phase) * (ring === 0 ? 1 : 0.6)
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    return
  }
  // 失败：接触点标记
  ctx.strokeStyle = COLORS.danger
  ctx.fillStyle = COLORS.danger
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(p.x - 7, p.y - 7)
  ctx.lineTo(p.x + 7, p.y + 7)
  ctx.moveTo(p.x + 7, p.y - 7)
  ctx.lineTo(p.x - 7, p.y + 7)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(p.x, p.y, 11, 0, Math.PI * 2)
  ctx.stroke()
}

function drawLegend(ctx: CanvasRenderingContext2D, t: WorldTransform): void {
  const x = t.worldToScreen({ x: 12, y: 12 }).x
  let y = t.worldToScreen({ x: 12, y: 12 }).y
  const line = (label: string, draw: () => void) => {
    draw()
    ctx.fillStyle = COLORS.aux
    ctx.font = '13px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(label, x + 26, y + 4)
    y += 17
  }
  ctx.save()
  ctx.lineWidth = 2
  line('预测轨迹（虚线）', () => {
    ctx.strokeStyle = COLORS.preview
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 20, y)
    ctx.stroke()
    ctx.setLineDash([])
  })
  line('实飞轨迹（实线）', () => {
    ctx.strokeStyle = COLORS.craft
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 20, y)
    ctx.stroke()
  })
  line('接收站', () => {
    ctx.strokeStyle = COLORS.receiver
    ctx.beginPath()
    ctx.arc(x + 10, y, 7, 0, Math.PI * 2)
    ctx.stroke()
  })
  line('事件点 ×', () => {
    ctx.strokeStyle = COLORS.danger
    ctx.beginPath()
    ctx.moveTo(x + 5, y - 5)
    ctx.lineTo(x + 15, y + 5)
    ctx.moveTo(x + 15, y - 5)
    ctx.lineTo(x + 5, y + 5)
    ctx.stroke()
  })
  ctx.restore()
}
