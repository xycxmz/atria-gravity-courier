import { describe, expect, it } from 'vitest'
import { createWorldTransform } from '../../src/render/worldRenderer.ts'
import { WORLD } from '../../src/content/levels.ts'

/** 1366×768、留边 16 下的缩放：min(1334/1000, 736/700) = 1.05142857… */
const FACTOR = Math.min((1366 - 32) / WORLD.width, (768 - 32) / WORLD.height)

/**
 * 按钮与拖杆的 CSS 像素位置映射到世界坐标必须覆盖留边情况：
 * 不同视口下世界居中且不裁剪；反变换与正变换互逆。
 */
describe('世界坐标变换（含留边）', () => {
  it('1920×1080：世界完整显示且居中，四角不裁剪', () => {
    const t = createWorldTransform(1920, 1080, 20)
    const tl = t.worldToScreen({ x: 0, y: 0 })
    const br = t.worldToScreen({ x: WORLD.width, y: WORLD.height })
    // 高度为限制维度时，横向留白对称
    expect(tl.x).toBeGreaterThan(0)
    expect(br.x).toBeLessThan(1920)
    expect(tl.y).toBeCloseTo(20, 6)
    expect(br.y).toBeCloseTo(1080 - 20, 6)
    // 比例一致：不拉伸
    const w = br.x - tl.x
    const h = br.y - tl.y
    expect(w / h).toBeCloseTo(WORLD.width / WORLD.height, 6)
  })

  it('390×844 竖屏：世界缩放完整显示，宽度被限制', () => {
    const t = createWorldTransform(390, 844, 12)
    const tl = t.worldToScreen({ x: 0, y: 0 })
    const br = t.worldToScreen({ x: WORLD.width, y: WORLD.height })
    expect(tl.x).toBeCloseTo(12, 6)
    expect(br.x).toBeCloseTo(378, 6)
    expect(tl.y).toBeGreaterThan(12)
    expect(br.y).toBeLessThan(844 - 12)
  })

  it('1366×768：高度限制时左右留边', () => {
    const t = createWorldTransform(1366, 768, 16)
    const tl = t.worldToScreen({ x: 0, y: 0 })
    const br = t.worldToScreen({ x: WORLD.width, y: WORLD.height })
    // 世界比例 1000/700≈1.43 比视口 1.78 更“方”，高度为限制维度
    expect(tl.y).toBeCloseTo(16, 6)
    expect(br.y).toBeCloseTo(768 - 16, 6)
    expect(tl.x).toBeCloseTo((1366 - WORLD.width * FACTOR) / 2, 4)
    expect(br.x).toBeGreaterThan(1200)
    expect(br.x - tl.x).toBeLessThan(1366 - 32)
  })

  it('正反变换互逆（留边偏移下仍精确）', () => {
    for (const size of [
      [390, 844],
      [1366, 768],
      [1920, 1080],
      [300, 200],
    ] as const) {
      const t = createWorldTransform(size[0], size[1], 16)
      const world = { x: 123.5, y: 456.25 }
      const screen = t.worldToScreen(world)
      const back = t.screenToWorld(screen)
      expect(back.x).toBeCloseTo(world.x, 9)
      expect(back.y).toBeCloseTo(world.y, 9)
    }
  })

  it('鼠标在留白区域反变换后仍在世界外（可用于点击判定）', () => {
    const t = createWorldTransform(1000, 700, 50)
    // 视口中心在世界内
    expect(t.screenToWorld({ x: 500, y: 350 })).toEqual({ x: 500, y: 350 })
    // 左上留白角在世界外
    const corner = t.screenToWorld({ x: 0, y: 0 })
    expect(corner.x).toBeLessThan(0)
    expect(corner.y).toBeLessThan(0)
  })
})
