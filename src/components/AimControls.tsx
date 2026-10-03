import { PHYSICS } from '../content/levels.ts'
import type { AimInput } from '../physics/types.ts'
import type { SessionSnapshot } from '../game/session.ts'
import { NumberField } from './NumberField.tsx'

interface AimControlsProps {
  snapshot: SessionSnapshot
  onAimChange: (aim: AimInput) => void
}

/**
 * 显示规范化：仅去掉浮点加法噪声（如 0.1+0.5 的尾差），不改变用户输入的合法小数。
 * 数字输入、滑块标签、预览、保存与导出日志使用同一值。
 */
function plain(v: number): string {
  return String(Math.round(v * 1000) / 1000)
}

/**
 * 瞄准控件：角度与速度的数字输入（步进 0.5 度 / 1 单位）与滑块。
 * 数字输入便于精确重复与无拖拽操作；方向拖杆在画布上单独提供。
 */
export function AimControls({ snapshot, onAimChange }: AimControlsProps) {
  const disabled = snapshot.phase !== 'aiming'
  const { angleDegrees, speed } = snapshot.aim

  const setAngle = (raw: number) => {
    const clamped = Math.min(
      PHYSICS.launchAngleMaxDegrees,
      Math.max(PHYSICS.launchAngleMinDegrees, raw),
    )
    onAimChange({ angleDegrees: clamped, speed })
  }

  const setSpeed = (raw: number) => {
    const clamped = Math.min(
      PHYSICS.launchSpeedMax,
      Math.max(PHYSICS.launchSpeedMin, raw),
    )
    onAimChange({ angleDegrees, speed: clamped })
  }

  return (
    <>
      <div className="control-group">
        <label htmlFor="aim-angle-number">
          方向角度（{PHYSICS.launchAngleMinDegrees}° 至 {PHYSICS.launchAngleMaxDegrees}°，正为向下）
        </label>
        <div className="control-row">
          <NumberField
            id="aim-angle-number"
            value={angleDegrees}
            min={PHYSICS.launchAngleMinDegrees}
            max={PHYSICS.launchAngleMaxDegrees}
            step={0.5}
            format={plain}
            disabled={disabled}
            ariaLabel="方向角度数字输入"
            onCommit={setAngle}
          />
          <input
            id="aim-angle"
            type="range"
            min={PHYSICS.launchAngleMinDegrees}
            max={PHYSICS.launchAngleMaxDegrees}
            step={0.5}
            value={angleDegrees}
            disabled={disabled}
            onChange={(e) => setAngle(Number.parseFloat(e.target.value))}
            aria-label="方向角度滑块"
          />
        </div>
      </div>
      <div className="control-group">
        <label htmlFor="aim-speed-number">
          初速度（{PHYSICS.launchSpeedMin} 至 {PHYSICS.launchSpeedMax} 单位/秒）
        </label>
        <div className="control-row">
          <NumberField
            id="aim-speed-number"
            value={speed}
            min={PHYSICS.launchSpeedMin}
            max={PHYSICS.launchSpeedMax}
            step={1}
            format={plain}
            disabled={disabled}
            ariaLabel="初速度数字输入"
            onCommit={setSpeed}
          />
          <input
            id="aim-speed"
            type="range"
            min={PHYSICS.launchSpeedMin}
            max={PHYSICS.launchSpeedMax}
            step={1}
            value={speed}
            disabled={disabled}
            onChange={(e) => setSpeed(Number.parseFloat(e.target.value))}
            aria-label="初速度滑块"
          />
        </div>
      </div>
    </>
  )
}
