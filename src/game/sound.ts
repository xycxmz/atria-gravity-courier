// 极简合成音：发射、修正、投递三个短音。静音下全部状态可见。
let audioCtx: AudioContext | null = null
let muted = false

export function setMuted(value: boolean): void {
  muted = value
}

function tone(freq: number, duration: number, type: OscillatorType, gain: number, delay = 0): void {
  if (muted) return
  if (typeof window === 'undefined') return
  try {
    if (!audioCtx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      audioCtx = new Ctor()
    }
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    const t0 = audioCtx.currentTime + delay
    const osc = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    g.gain.setValueAtTime(gain, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
    osc.connect(g)
    g.connect(audioCtx.destination)
    osc.start(t0)
    osc.stop(t0 + duration)
  } catch {
    // 音频不可用时静默降级。
  }
}

export const Sound = {
  launch(): void {
    tone(420, 0.18, 'square', 0.05)
    tone(260, 0.22, 'square', 0.04, 0.05)
  },
  burn(): void {
    tone(520, 0.12, 'triangle', 0.05)
  },
  dock(): void {
    tone(587, 0.14, 'sine', 0.06)
    tone(880, 0.2, 'sine', 0.05, 0.1)
  },
}
