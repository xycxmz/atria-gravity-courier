import { PHYSICS } from '../content/levels.ts'
import type { BurnProposal, SessionSnapshot } from '../game/session.ts'
import type { FlightResult } from '../physics/simulate.ts'
import { NumberField } from './NumberField.tsx'

/** 显示规范化：仅去浮点噪声，不改用户输入的合法小数。 */
const plainNum = (v: number): string => String(Math.round(v * 1000) / 1000)

interface BurnControlsProps {
  snapshot: SessionSnapshot
  preview: FlightResult | null
  onProposal: (proposal: BurnProposal) => void
  onConfirm: () => void
  onCancel: () => void
}

function describePreview(preview: FlightResult | null): string {
  if (!preview) return '预览计算中…'
  const outcome = preview.outcome
  if (outcome.kind === 'success') {
    return `修正后预测：投递成功，约 ${outcome.time.toFixed(2)} 秒抵达`
  }
  switch (outcome.reason) {
    case 'collide':
      return '修正后预测：将撞上天体'
    case 'outOfBounds':
      return '修正后预测：将越出世界范围'
    case 'tooFast':
      return `修正后预测：接近过快（相对速度 ${(outcome.relativeSpeed ?? 0).toFixed(1)} > ${PHYSICS.maxDockRelativeSpeed}）`
    case 'timeout':
      return '修正后预测：30 秒内未能相遇'
  }
}

/**
 * 一次中途微调：控制带内紧凑横条（不遮挡世界），方向可在完整 360 度内选择，
 * 强度 0 至 24；也可在画布上从飞船直接拖出修正方向（见世界渲染的 Δv 箭头）。
 * 打开即暂停，模拟与接收站不推进；取消或零值确认不消耗次数。
 */
export function BurnControls({ snapshot, preview, onProposal, onConfirm, onCancel }: BurnControlsProps) {
  const { pendingBurn } = snapshot

  return (
    <>
      <div className="control-group">
        <label htmlFor="burn-angle">修正方向（360° 任意方向，可在画布上从飞船拖出）</label>
        <div className="control-row">
          <NumberField
            id="burn-angle"
            value={pendingBurn.angleDegrees}
            min={-180}
            max={180}
            step={1}
            format={plainNum}
            disabled={false}
            ariaLabel="修正方向数字输入"
            onCommit={(raw) => onProposal({ angleDegrees: raw, deltaV: pendingBurn.deltaV })}
          />
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={pendingBurn.angleDegrees}
            onChange={(e) =>
              onProposal({ angleDegrees: Number.parseFloat(e.target.value), deltaV: pendingBurn.deltaV })
            }
            aria-label="修正方向滑块"
          />
        </div>
      </div>
      <div className="control-group">
        <label htmlFor="burn-dv">修正强度（0 至 {PHYSICS.maxBurnDeltaV}，0 不消耗次数）</label>
        <div className="control-row">
          <NumberField
            id="burn-dv"
            value={pendingBurn.deltaV}
            min={0}
            max={PHYSICS.maxBurnDeltaV}
            step={1}
            format={plainNum}
            disabled={false}
            ariaLabel="修正强度数字输入"
            onCommit={(raw) =>
              onProposal({
                angleDegrees: pendingBurn.angleDegrees,
                deltaV: Math.min(PHYSICS.maxBurnDeltaV, Math.max(0, raw)),
              })
            }
          />
          <input
            type="range"
            min={0}
            max={PHYSICS.maxBurnDeltaV}
            step={1}
            value={pendingBurn.deltaV}
            onChange={(e) =>
              onProposal({
                angleDegrees: pendingBurn.angleDegrees,
                deltaV: Number.parseFloat(e.target.value),
              })
            }
            aria-label="修正强度滑块"
          />
        </div>
      </div>
      <div className="control-group" style={{ flex: '0 0 auto' }}>
        <div className="control-row" style={{ gap: 8 }}>
          <button className="primary-button" id="burn-confirm" onClick={onConfirm}>
            确认修正
          </button>
          <button className="secondary-button" id="burn-cancel" onClick={onCancel}>
            取消（不消耗次数）
          </button>
        </div>
      </div>
      <div className="control-group" style={{ flex: '1 1 100%', minWidth: 0 }}>
        <div className="status-line" style={{ color: 'var(--preview)' }} role="status" aria-live="polite">
          {describePreview(preview)} · 剩余 {snapshot.burnsRemaining} 次
        </div>
      </div>
    </>
  )
}
