import { PHYSICS } from '../content/levels.ts'

interface TimelineInspectorProps {
  /** 检查游标覆盖的最小时刻（微调态为当前绝对步，不能查不存在的过去）。 */
  minTime: number
  /** 检查游标覆盖的最大时刻（预览首事件时刻或当前飞行时刻）。 */
  maxTime: number
  /** 当前检查时刻；null 时不显示。 */
  value: number
  onChange: (t: number) => void
  /** 暂停下逐步观察：推进固定步并保持暂停。 */
  onObserve?: (steps: number) => void
  /** 步进按钮是否可用（暂停态）。 */
  canStep: boolean
  mode: 'preview' | 'live'
}

/**
 * 时间检查游标：在已有轨迹缓存上查看任意时刻的飞船与接收站位置，
 * 用于解释“经过同一地点却没遇到”这类失败。拖动不改变真实步号、相位或结果。
 * 暂停下可逐步观察（+0.1s=12 个固定步、+1s=120 个固定步，不改 dt）。
 */
export function TimelineInspector({ minTime, maxTime, value, onChange, onObserve, canStep, mode }: TimelineInspectorProps) {
  if (maxTime <= minTime) return null
  return (
    <div className="control-group" style={{ flex: '1 1 100%', minWidth: 0 }}>
      <label htmlFor="inspect-time">
        时间检查：{value.toFixed(2)} 秒 —— 飞船与接收站的同刻位置
        {mode === 'preview' ? '（预览）' : '（实飞）'}
      </label>
      <div className="control-row">
        <input
          id="inspect-time"
          type="range"
          min={minTime}
          max={maxTime}
          step={PHYSICS.dt}
          value={Math.min(Math.max(value, minTime), maxTime)}
          onChange={(e) => onChange(Number.parseFloat(e.target.value))}
          aria-label="时间检查滑块"
        />
        {canStep && onObserve && (
          <>
            <button
              className="secondary-button"
              onClick={() => onObserve(12)}
              title="推进 12 个固定步（0.1 秒），保持暂停"
            >
              +0.1s
            </button>
            <button
              className="secondary-button"
              onClick={() => onObserve(120)}
              title="推进 120 个固定步（1 秒），保持暂停"
            >
              +1s
            </button>
          </>
        )}
      </div>
    </div>
  )
}
