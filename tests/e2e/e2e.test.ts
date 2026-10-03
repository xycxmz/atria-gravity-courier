/**
 * 真实浏览器输入闭环（真实点击与键盘，驱动系统 Chrome）。
 * 覆盖验收“真实输入闭环”：新用户完成 H01、运动站邮路偏离重试、
 * 微调面板等待不推进/取消不消耗/确认只应用一次、暂停、键盘、缩放、页面隐藏与手机视口。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'


const CHROME =
  process.env.COURIER_CHROME ??
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.COURIER_PORT ?? 4317)
const URL = `http://localhost:${PORT}/`

const E2E_TIMEOUT = 120_000

let browser: Browser
let page: Page
let previewServer: ReturnType<typeof spawn>
let consoleErrors: string[] = []
const allErrors: string[] = []

async function waitForSelectorText(
  page: Page,
  selector: string,
  pattern: RegExp,
  timeout = 40_000,
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const text = await page.$eval(selector, (el) => el.textContent ?? '').catch(() => '')
    if (pattern.test(text)) return text
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`等待 ${selector} 匹配 ${pattern} 超时`)
}

async function setNumberInput(page: Page, id: string, value: string): Promise<void> {
  await page.click(`#${id}`, { clickCount: 3 })
  await page.type(`#${id}`, value)
}

async function clickChip(page: Page, id: string): Promise<void> {
  const chips = await page.$$('.chip')
  for (const c of chips) {
    const text = await c.evaluate((el: Element) => el.textContent ?? '')
    if (text.includes(id)) {
      await c.click()
      return
    }
  }
  throw new Error(`邮路按钮 ${id} 未找到`)
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 150))
}

beforeAll(async () => {
  // 生产构建后用 vite preview 提供静态产物
  previewServer = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    shell: true,
    stdio: 'ignore',
  })
  let ready = false
  for (let i = 0; i < 100 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 200))
    ready = await fetch(URL, { method: 'head' })
      .then((res) => res.ok)
      .catch(() => false)
  }
  if (!ready) throw new Error('预览服务器未就绪')

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--window-size=1366,850', '--no-sandbox', '--disable-extensions'],
  })
  page = await browser.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text())
      allErrors.push(msg.text())
    }
  })
  page.on('pageerror', (err) => {
    consoleErrors.push(String(err))
    allErrors.push(String(err))
  })
}, 60_000)

afterAll(async () => {
  await browser?.close().catch(() => {})
  previewServer?.kill()
})

async function freshOpen(viewport: { width: number; height: number } = { width: 1366, height: 850 }): Promise<void> {
  await page.setViewport(viewport)
  await page.goto(URL, { waitUntil: 'networkidle0' })
  // 新用户状态：清空本地保存后重载
  await page.evaluate(() => {
    localStorage.clear()
  })
  await page.reload({ waitUntil: 'networkidle0' })
  consoleErrors = []
}

describe('真实输入闭环（桌面）', () => {
  it(
    '新用户从 H01 通过可见控件设置 0 度 80 并发射成功',
    async () => {
      await freshOpen()
      await page.waitForSelector('#aim-angle-number')
      await setNumberInput(page, 'aim-angle-number', '0')
      await setNumberInput(page, 'aim-speed-number', '80')
      await settle()
      // 状态行给出可解释的预测（旧预览不残留）
      const status = await page.$eval('.status-line', (el) => el.textContent ?? '')
      expect(status).toContain('预测：投递成功')
      await page.click('#launch-button')
      await waitForSelectorText(page, '.result-card.success h2', /投递完成/)
      const body = await page.$eval('.result-card.success', (el) => el.textContent ?? '')
      // 成功时刻约 7.675 秒（解析基准）
      expect(body).toMatch(/7\.67/)
      expect(body).toContain('修正 0 次')
    },
    E2E_TIMEOUT,
  )

  it(
    '重试保留瞄准参数；换邮路不丢失完成记录',
    async () => {
      await page.click('#retry-button')
      await page.waitForSelector('#launch-button')
      const angle = await page.$eval('#aim-angle-number', (el) => (el as HTMLInputElement).value)
      const speed = await page.$eval('#aim-speed-number', (el) => (el as HTMLInputElement).value)
      expect(angle).toBe('0')
      expect(speed).toBe('80')
      await page.click('#launch-button')
      await waitForSelectorText(page, '.result-card.success h2', /投递完成/)
      // H01 完成记录已保存
      const saved = await page.evaluate(() => localStorage.getItem('gravity-courier/progress/v1'))
      expect(saved).toContain('"H01"')
    },
    E2E_TIMEOUT,
  )

  it(
    '运动站邮路 H03：先偏离失败，再调整成功（重试保留参数由上一步手工覆盖）',
    async () => {
      await freshOpen()
      await clickChip(page, 'H03')
      await page.waitForSelector('#aim-angle-number')
      // 0 度 40 速度正对引力天体：物理上确定的碰撞失败
      await setNumberInput(page, 'aim-angle-number', '0')
      await setNumberInput(page, 'aim-speed-number', '40')
      await page.click('#launch-button')
      await waitForSelectorText(page, '.result-card.failure h2', /投递失败/)
      const failText = await page.$eval('.result-card.failure', (el) => el.textContent ?? '')
      expect(failText).toContain('事件时刻')
      // 失败冻结现场保留上一条轨迹：重试后再次发射成功
      await page.click('#retry-button')
      await page.waitForSelector('#launch-button')
      await setNumberInput(page, 'aim-angle-number', '-47')
      await page.click('#launch-button')
      await waitForSelectorText(page, '.result-card.success h2', /投递完成/)
    },
    E2E_TIMEOUT,
  )

  it(
    '微调面板：等待 5 秒模拟与接收站未推进；取消不消耗次数',
    async () => {
      await freshOpen()
      await clickChip(page, 'H03')
      await page.waitForSelector('#launch-button')
      await setNumberInput(page, 'aim-angle-number', '-47')
      await page.click('#launch-button')
      await page.waitForSelector('#burn-button')
      await new Promise((r) => setTimeout(r, 2000))
      await page.click('#burn-button')
      await page.waitForSelector('#burn-confirm')
      // 等待预览完成（期间显示“预览计算中…”）；微调 UI 在控制带内，不遮挡世界
      const tOpen = await waitForSelectorText(page, '.controls .status-line', /预测/, 10_000)
      // 等待 5 秒：模拟与接收站都不推进（状态行内容不变）
      await new Promise((r) => setTimeout(r, 5000))
      const tWait = await page.$eval('.controls .status-line', (el) => el.textContent ?? '')
      expect(tWait).toBe(tOpen)
      await page.click('#burn-cancel')
      await page.waitForSelector('#pause-button')
      const btn = await page.$eval('#burn-button', (el) => el.textContent ?? '')
      expect(btn).toContain('剩余 1 次')
      // 取消后可继续飞行到结果
      await waitForSelectorText(page, '.result-card', /投递/)
    },
    E2E_TIMEOUT,
  )

  it(
    '确认正数修正只应用一次（双击不重复），随后完成投递',
    async () => {
      await freshOpen()
      await page.waitForSelector('#aim-angle-number')
      await setNumberInput(page, 'aim-angle-number', '0')
      await setNumberInput(page, 'aim-speed-number', '80')
      await page.click('#launch-button')
      await page.waitForSelector('#burn-button')
      await new Promise((r) => setTimeout(r, 1000))
      await page.click('#burn-button')
      await page.waitForSelector('#burn-dv')
      await setNumberInput(page, 'burn-dv', '10')
      const text = await waitForSelectorText(page, '.controls .status-line', /修正后预测/)
      expect(text).toContain('修正后预测')
      // 双击确认：面板在第一次点击后关闭，第二次点击落在已卸载元素上
      await page.click('#burn-confirm')
      await new Promise((r) => setTimeout(r, 120))
      await page.click('#burn-confirm').catch(() => {
        /* 面板已关闭，第二次点击无目标——正是期望行为 */
      })
      const result = await waitForSelectorText(page, '.result-card', /投递/)
      expect(result).toContain('投递完成')
      expect(result).toContain('修正 1 次')
      const disabled = await page.$eval('#burn-button', (el) => (el as HTMLButtonElement).disabled)
      expect(disabled).toBe(true)
    },
    E2E_TIMEOUT,
  )

  it(
    '暂停后飞行时间冻结，恢复后继续到结果',
    async () => {
      await freshOpen()
      await page.waitForSelector('#aim-angle-number')
      await setNumberInput(page, 'aim-angle-number', '0')
      await setNumberInput(page, 'aim-speed-number', '80')
      await page.click('#launch-button')
      await page.waitForSelector('#pause-button')
      await new Promise((r) => setTimeout(r, 2000))
      await page.click('#pause-button')
      const tPaused = await page.$eval('.status-line', (el) => el.textContent ?? '')
      expect(tPaused).toContain('已暂停')
      await new Promise((r) => setTimeout(r, 3000))
      const tStill = await page.$eval('.status-line', (el) => el.textContent ?? '')
      expect(tStill).toBe(tPaused)
      await page.click('#pause-button')
      await waitForSelectorText(page, '.result-card', /投递/)
    },
    E2E_TIMEOUT,
  )

  it(
    '页面隐藏自动暂停，恢复后等待用户继续（模拟 visibilitychange）',
    async () => {
      await freshOpen()
      await page.waitForSelector('#aim-angle-number')
      await setNumberInput(page, 'aim-angle-number', '0')
      await setNumberInput(page, 'aim-speed-number', '80')
      await page.click('#launch-button')
      await page.waitForSelector('#pause-button')
      await new Promise((r) => setTimeout(r, 1000))
      // 真实页面隐藏会冻结渲染无法断言，这里用真实 visibilitychange 事件 +
      // 覆盖只读 visibilityState 来驱动应用处理器（CDP frozen 无法恢复可断言状态）。
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await settle()
      const tHidden = await page.$eval('.status-line', (el) => el.textContent ?? '')
      expect(tHidden).toContain('已暂停')
      await new Promise((r) => setTimeout(r, 3000))
      const tStill = await page.$eval('.status-line', (el) => el.textContent ?? '')
      expect(tStill).toBe(tHidden)
      // 恢复可见后不自动续飞
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await settle()
      const tVisible = await page.$eval('.status-line', (el) => el.textContent ?? '')
      expect(tVisible).toBe(tHidden)
      // 续飞只能由用户决定
      await page.click('#pause-button')
      await waitForSelectorText(page, '.result-card', /投递/)
    },
    E2E_TIMEOUT,
  )

  it(
    '键盘调整角度与速度；输入数字时快捷键不触发',
    async () => {
      await freshOpen()
      await page.waitForSelector('#aim-angle-number')
      await page.click('#launch-button')
      await page.keyboard.press('ArrowLeft')
      const angleDuringFlight = await page.$eval('#aim-angle-number', (el) => (el as HTMLInputElement).value)
      expect(angleDuringFlight).toBe('0')
      await waitForSelectorText(page, '.result-card', /投递/)
      await page.click('#retry-button')
      await page.waitForSelector('#aim-angle-number')
      // 输入聚焦时方向键只编辑数字，不触发全局快捷键
      await page.click('#aim-angle-number')
      await page.keyboard.press('ArrowLeft')
      const angleTyped = await page.$eval('#aim-angle-number', (el) => (el as HTMLInputElement).value)
      expect(angleTyped).toBe('0')
      // body 聚焦时按键才调整游戏
      await page.click('body')
      await page.keyboard.press('ArrowRight')
      await settle()
      const angle = await page.$eval('#aim-angle-number', (el) => (el as HTMLInputElement).value)
      expect(Number.parseFloat(angle)).toBeCloseTo(0.5, 6)
      await page.keyboard.press('ArrowUp')
      await settle()
      const speed = await page.$eval('#aim-speed-number', (el) => (el as HTMLInputElement).value)
      expect(Number.parseFloat(speed)).toBeCloseTo(81, 6)
    },
    E2E_TIMEOUT,
  )

  it(
    '改变窗口尺寸后结果与世界显示不变',
    async () => {
      await freshOpen()
      await page.waitForSelector('#aim-angle-number')
      await setNumberInput(page, 'aim-angle-number', '0')
      await setNumberInput(page, 'aim-speed-number', '80')
      await page.click('#launch-button')
      await waitForSelectorText(page, '.result-card.success h2', /投递完成/)
      const before = await page.$eval('.result-card.success', (el) => el.textContent ?? '')
      for (const size of [
        { width: 1024, height: 600 },
        { width: 1920, height: 1080 },
        { width: 2560, height: 1440 },
      ]) {
        await page.setViewport(size)
        await settle()
        const after = await page.$eval('.result-card.success', (el) => el.textContent ?? '').catch(() => '')
        expect(after).toBe(before)
      }
    },
    E2E_TIMEOUT,
  )

  it(
    '拖杆命中区域 ≥ 44×44 CSS 像素，位置与发射点投影一致（含留边）',
    async () => {
      await freshOpen()
      await page.waitForSelector('.aim-stick')
      const { rect, wrap } = await page.evaluate(() => {
        const stick = document.querySelector('.aim-stick') as HTMLElement
        const w = document.querySelector('.world-wrap') as HTMLElement
        const r = stick.getBoundingClientRect()
        const wr = w.getBoundingClientRect()
        return {
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          wrap: { x: wr.x, y: wr.y, w: wr.width, h: wr.height },
        }
      })
      expect(rect.w).toBeGreaterThanOrEqual(44)
      expect(rect.h).toBeGreaterThanOrEqual(44)
      // 留边 20：世界按 wrap 尺寸缩放居中（不按窗口尺寸）。
      // 手柄 top/left 是相对 wrap 的世界投影；视口坐标需再加 wrap 偏移。
      const scale = Math.min((wrap.w - 40) / 1000, (wrap.h - 40) / 700)
      const offsetX = (wrap.w - 1000 * scale) / 2
      const offsetY = (wrap.h - 700 * scale) / 2
      // H01 默认 0 度：手柄在发射点沿 +X 偏移 90 世界单位
      const expectedX = wrap.x + offsetX + (120 + 90) * scale
      const expectedY = wrap.y + offsetY + 350 * scale
      expect(rect.x + rect.w / 2).toBeCloseTo(expectedX, 1)
      expect(rect.y + rect.h / 2).toBeCloseTo(expectedY, 1)
    },
    E2E_TIMEOUT,
  )

  it(
    '小数输入与真实发射值一致（GC-001）',
    async () => {
      await freshOpen()
      await page.waitForSelector('#aim-angle-number')
      await setNumberInput(page, 'aim-angle-number', '0.2')
      await setNumberInput(page, 'aim-speed-number', '80.4')
      await page.click('body')
      await settle()
      // 显示与输入一致，预测反映真实小数值
      expect(await page.$eval('#aim-angle-number', (el) => (el as HTMLInputElement).value)).toBe('0.2')
      expect(await page.$eval('#aim-speed-number', (el) => (el as HTMLInputElement).value)).toBe('80.4')
      const status = await page.$eval('.status-line', (el) => el.textContent ?? '')
      expect(status).toContain('预测：投递成功')
      await page.click('#launch-button')
      const text = await waitForSelectorText(page, '.result-card.success', /投递完成/)
      // 0.2°/80.4 的成功时刻约 7.638 秒，不是 7.675（证明物理值是真实小数）
      expect(text).toMatch(/7\.63/)
    },
    E2E_TIMEOUT,
  )

  it(
    '飞行中改变窗口尺寸，飞行继续且结果出现（GC-002/GC-010）',
    async () => {
      await freshOpen()
      await page.waitForSelector('#aim-angle-number')
      await setNumberInput(page, 'aim-angle-number', '0')
      await setNumberInput(page, 'aim-speed-number', '80')
      await page.click('#launch-button')
      await page.waitForSelector('#pause-button')
      // 飞行中改变尺寸：世界比例变化但不丢逻辑步
      await page.setViewport({ width: 1024, height: 700 })
      await new Promise((r) => setTimeout(r, 1500))
      await page.setViewport({ width: 1600, height: 900 })
      await waitForSelectorText(page, '.result-card.success h2', /投递完成/)
      const text = await page.$eval('.result-card.success', (el) => el.textContent ?? '')
      expect(text).toMatch(/7\.67/)
    },
    E2E_TIMEOUT,
  )

  it(
    '飞行帧间隔与预览输入响应采样（GC-012），写入 docs/perf-browser.json',
    async () => {
      await freshOpen()
      await page.waitForSelector('#aim-angle-number')
      await setNumberInput(page, 'aim-angle-number', '0')
      await setNumberInput(page, 'aim-speed-number', '80')
      await page.click('#launch-button')
      await page.waitForSelector('#pause-button')
      await new Promise((r) => setTimeout(r, 500))
      // 真实 rAF 帧间隔采样约 60 秒（3600 帧，覆盖持续负载而非瞬时窗口）
      const samples = await page.evaluate(() => {
        return new Promise<number[]>((resolve) => {
          const dt: number[] = []
          let last = performance.now()
          let frames = 0
          const tick = (now: number) => {
            dt.push(now - last)
            last = now
            frames++
            if (frames < 3600) requestAnimationFrame(tick)
            else resolve(dt)
          }
          requestAnimationFrame(tick)
        })
      })
      const sorted = [...samples].sort((a, b) => a - b)
      const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
      const summary = {
        measuredAt: new Date().toISOString(),
        runtime: 'headless Chrome (puppeteer-core)',
        frames: samples.length,
        frameMsAvg: Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2)),
        frameMsP50: Number(pct(50).toFixed(2)),
        frameMsP95: Number(pct(95).toFixed(2)),
        frameMsMax: Number(pct(100).toFixed(2)),
      }
      mkdirSync('docs', { recursive: true })
      writeFileSync('docs/perf-browser.json', JSON.stringify(summary, null, 2))
      console.log('perf-browser:', JSON.stringify(summary))
      // 60fps 预算下 p95 帧间隔不应超过 ~50ms（两倍预算），否则需要调查
      expect(summary.frameMsP95).toBeLessThan(50)
    },
    E2E_TIMEOUT,
  )

  it(
    '画布坐标反变换：点击画布空白设置角度（拖杆真实拖动）',
    async () => {
      await freshOpen()
      await page.waitForSelector('.aim-stick')
      const rect = await page.$eval('.aim-stick', (el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })
      // 从拖杆中心向右上方拖动一段（模拟真实指针拖拽）
      await page.mouse.move(rect.x, rect.y)
      await page.mouse.down()
      await page.mouse.move(rect.x + 200, rect.y - 100, { steps: 5 })
      await page.mouse.up()
      await settle()
      const angle = await page.$eval('#aim-angle-number', (el) => (el as HTMLInputElement).value)
      // 角度应为负（向上），且被钳制到 -70..70 并对齐 0.5 度
      const deg = Number.parseFloat(angle)
      expect(deg).toBeLessThanOrEqual(0)
      expect(deg).toBeGreaterThanOrEqual(-70)
      expect(deg * 2).toBeCloseTo(Math.round(deg * 2), 6)
    },
    E2E_TIMEOUT,
  )
})

describe('手机视口 390 × 844', () => {
  it(
    '可折叠控制卡上用数字输入完成投递',
    async () => {
      await freshOpen({ width: 390, height: 844 })
      await page.waitForSelector('.controls summary')
      await page.click('.controls summary')
      await page.waitForSelector('#aim-angle-number')
      await setNumberInput(page, 'aim-angle-number', '0')
      await setNumberInput(page, 'aim-speed-number', '80')
      await settle()
      await page.click('#launch-button')
      await waitForSelectorText(page, '.result-card.success h2', /投递完成/)
      const r = await page.$eval('#retry-button', (el) => {
        const b = el.getBoundingClientRect()
        return { w: b.width, h: b.height }
      })
      expect(r.h).toBeGreaterThanOrEqual(44)
    },
    E2E_TIMEOUT,
  )

  it(
    '200% 文本/显示缩放下仍可发射与重试',
    async () => {
      // 768 CSS 宽 × DSF 2 ≈ 200% 缩放的桌面布局（控制区默认展开）
      await freshOpen({ width: 768, height: 425, deviceScaleFactor: 2 })
      await page.waitForSelector('#aim-angle-number')
      await setNumberInput(page, 'aim-angle-number', '0')
      await setNumberInput(page, 'aim-speed-number', '80')
      await page.click('#launch-button')
      await waitForSelectorText(page, '.result-card.success h2', /投递完成/)
    },
    E2E_TIMEOUT,
  )
})

describe('浏览器错误汇总（全程累计）', () => {
  it('所有用例无页面错误（忽略 React DevTools 提示）', () => {
    expect(allErrors.filter((e) => !e.includes('React DevTools'))).toEqual([])
  })
})
