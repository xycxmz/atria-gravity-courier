import { createWorldTransform } from '../render/worldRenderer.ts'
import { PHYSICS } from '../content/levels.ts'
import type { AimInput, LevelDef } from '../physics/types.ts'

interface AimStickProps {
  level: LevelDef
  cssWidth: number
  cssHeight: number
  aim: AimInput
  /** 由父级用画布容器视口坐标计算角度（先反变换到世界坐标）。 */
  onDragAngle: (clientX: number, clientY: number) => void
}

/**
 * 画布上的方向拖杆：从发射点指向右侧可发射扇区（-70° 至 70°）。
 * 命中区域为 44×44 CSS 像素，大于可见小符号。
 */
export function AimStick({ level, cssWidth, cssHeight, aim, onDragAngle }: AimStickProps) {
  const t = createWorldTransform(cssWidth, cssHeight)
  const launchScreen = t.worldToScreen(level.launch)
  // 手柄沿瞄准方向偏移一段世界单位，便于拖动
  const handleOffset = 90 * t.scale
  const rad = (aim.angleDegrees * Math.PI) / 180
  const handleX = launchScreen.x + handleOffset * Math.cos(rad)
  const handleY = launchScreen.y + handleOffset * Math.sin(rad)

  return (
    <div
      className="aim-stick"
      style={{ left: handleX, top: handleY }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        e.preventDefault()
      }}
      onPointerMove={(e) => {
        if (e.buttons > 0) onDragAngle(e.clientX, e.clientY)
      }}
      role="slider"
      aria-label={`方向拖杆，当前 ${aim.angleDegrees} 度`}
      aria-valuenow={aim.angleDegrees}
      aria-valuemin={PHYSICS.launchAngleMinDegrees}
      aria-valuemax={PHYSICS.launchAngleMaxDegrees}
    >
      <span className="deg">{aim.angleDegrees.toFixed(1)}°</span>
    </div>
  )
}
