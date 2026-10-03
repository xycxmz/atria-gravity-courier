import { useEffect, useRef, useState } from 'react'

/**
 * 数字输入框（非受控 + 手动同步）：
 * 编辑期间 DOM 文本完全由用户掌控，不因钳制、外部提交或重渲染打断；
 * 非编辑态下外部值变化时由 effect 直接写回 DOM（不重挂载，不丢焦点）。
 * 提交值始终钳制到合法范围。
 */
export function NumberField({
  id,
  value,
  min,
  max,
  step,
  format,
  disabled,
  ariaLabel,
  onCommit,
}: {
  id: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  disabled: boolean
  ariaLabel: string
  onCommit: (raw: number) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || focused) return
    const formatted = format(value)
    if (el.value !== formatted) el.value = formatted
  })

  return (
    <input
      ref={ref}
      id={id}
      type="number"
      min={min}
      max={max}
      step={step}
      defaultValue={format(value)}
      disabled={disabled}
      aria-label={ariaLabel}
      onFocus={(e) => {
        setFocused(true)
        e.target.select()
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const parsed = Number.parseFloat(e.target.value)
        if (Number.isFinite(parsed)) {
          onCommit(Math.min(max, Math.max(min, parsed)))
        }
      }}
    />
  )
}
