import { PHYSICS } from '../content/levels.ts'
import type { AimInput, Outcome } from '../physics/types.ts'

interface AttemptResultProps {
  outcome: Outcome
  burnsUsed: number
  ghostNote: boolean
  ghostLabel?: string | null
  previousAttempt?: { aim: AimInput; outcome: Outcome } | null
  aim: AimInput
  levelName: string
  onRetry: () => void
  onPickLevel: () => void
  onExportLog: () => void
}

const REASON_TITLE: Record<string, string> = {
  collide: '撞上天体',
  outOfBounds: '越出世界范围',
  tooFast: '接近过快',
  timeout: '观察时间到（30 秒）',
}

/** 依据真实状态生成“下次可以试什么”，不在速度已到下限时继续建议降速。 */
function suggestionFor(reason: string, aim: AimInput): string {
  const atMinSpeed = aim.speed <= PHYSICS.launchSpeedMin + 1e-9
  const speedLine = atMinSpeed ? '初速度已是下限，降不下去——' : '降低初速度或'
  switch (reason) {
    case 'collide':
      return `${speedLine}调整方向绕开天体。无引力障碍（静石）不改变你的路径，只会阻挡。`
    case 'outOfBounds':
      return `${speedLine}调整方向，让轨迹留在世界内。`
    case 'tooFast':
      return atMinSpeed
        ? '初速度已是下限——调整方向，借助引力转弯减小接触时的相对速度。'
        : '降低初速度，或借助引力转弯，让接触相对速度降到阈值内。'
    case 'timeout':
      return '30 秒内未与接收站相遇——调整方向或速度靠近其轨道时刻，或飞行中用一次微调修正航向。'
    default:
      return ''
  }
}

/**
 * 结果卡：成功显示飞行时间与修正次数；失败冻结事件现场并说明原因与调整建议。
 * 失败现场（事件标记、轨迹终点）保留在画布上，并保留上一条轨迹供对比。
 */
export function AttemptResult({
  outcome,
  burnsUsed,
  ghostNote,
  ghostLabel,
  previousAttempt,
  aim,
  levelName,
  onRetry,
  onPickLevel,
  onExportLog,
}: AttemptResultProps) {
  if (outcome.kind === 'success') {
    return (
      <div className="result-card success" role="status" aria-live="polite">
        <h2>投递完成</h2>
        <p>
          回执：「{levelName}」信件已签收 · 飞行时间 {outcome.time.toFixed(3)} 秒 · 接触相对速度{' '}
          {outcome.relativeSpeed.toFixed(1)}（阈值{' '}
          {PHYSICS.maxDockRelativeSpeed}）· 中途修正 {burnsUsed} 次
        </p>
        {previousAttempt && previousAttempt.outcome.kind !== 'success' && (
          <p style={{ color: 'var(--aux)' }}>
            上次尝试：{previousAttempt.aim.angleDegrees.toFixed(1)}° / {previousAttempt.aim.speed.toFixed(0)}，结果为
            {ghostLabel ?? '失败'}；本次 {aim.angleDegrees.toFixed(1)}° / {aim.speed.toFixed(0)} 成功。
          </p>
        )}
        {ghostNote && !previousAttempt && <p style={{ color: 'var(--aux)' }}>{ghostLabel ?? '上一条轨迹'}已保留为对比虚线。</p>}
        <div className="actions">
          <button className="primary-button" id="retry-button" onClick={onRetry}>
            重玩本邮路
          </button>
          <button className="secondary-button" onClick={onPickLevel}>
            换邮路（顶部选择）
          </button>
          <button className="secondary-button" onClick={onExportLog} title="导出确定性输入日志（JSON），便于复现本次尝试">
            导出输入日志
          </button>
        </div>
      </div>
    )
  }

  const reason = REASON_TITLE[outcome.reason]
  const position = outcome.event.position
  return (
    <div className="result-card failure" role="status" aria-live="polite">
      <h2>投递失败：{reason}</h2>
      <p>
        事件时刻 {outcome.event.time.toFixed(3)} 秒 · 位置 ({position.x.toFixed(0)}, {position.y.toFixed(0)}) · 本次{' '}
        {aim.angleDegrees.toFixed(1)}° / {aim.speed.toFixed(0)}
      </p>
      {outcome.reason === 'tooFast' && outcome.relativeSpeed !== undefined && (
        <p>
          接触相对速度 {outcome.relativeSpeed.toFixed(1)} &gt; 阈值 {PHYSICS.maxDockRelativeSpeed}
          （此处比较的是相对速度，不是飞船自身速度）
        </p>
      )}
      <p>{suggestionFor(outcome.reason, aim)}</p>
      {previousAttempt && (
        <p style={{ color: 'var(--aux)' }}>
          上次尝试：{previousAttempt.aim.angleDegrees.toFixed(1)}° / {previousAttempt.aim.speed.toFixed(0)}，结果：
          {previousAttempt.outcome.kind === 'success' ? '成功' : REASON_TITLE[previousAttempt.outcome.reason]}。对比两条虚线可看差异。
        </p>
      )}
      <p style={{ color: 'var(--aux)' }}>
        重试将保留当前瞄准参数，接收站相位回到起点。{ghostNote ? `${ghostLabel ?? '上一条轨迹'}已保留为对比虚线。` : ''}
      </p>
      <div className="actions">
        <button className="primary-button" id="retry-button" onClick={onRetry}>
          重试（保留瞄准）
        </button>
        <button className="secondary-button" onClick={onPickLevel}>
          换邮路（顶部选择）
        </button>
        <button className="secondary-button" onClick={onExportLog} title="导出确定性输入日志（JSON），便于复现这次失败">
          导出输入日志
        </button>
      </div>
    </div>
  )
}
