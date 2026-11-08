import { describe, expect, it } from 'vitest'
import { defaultPlayerDisplay, DISPLAY_ANCHORS, DISPLAY_CORNERS, validatePlayerDisplay } from '../../../shared/playerDisplay'
import { displayLayout, turnPlacement } from './layout'

describe('reference display geometry', () => {
  it('scales consistently between HD, FHD and 4K without a fixed TV cap', () => {
    const fhd = displayLayout(defaultPlayerDisplay, { width: 1920, height: 1080 })
    for (const factor of [2 / 3, 2]) {
      const layout = displayLayout(defaultPlayerDisplay, { width: 1920 * factor, height: 1080 * factor })
      expect(layout.logo.width).toBeCloseTo(fhd.logo.width * factor)
      expect(layout.logo.height).toBeCloseTo(fhd.logo.height * factor)
      expect(layout.announcement.width).toBeCloseTo(fhd.announcement.width * factor)
      expect(layout.announcement.titleSize).toBeCloseTo(fhd.announcement.titleSize * factor)
    }
  })
  it('keeps logo boxes and banner width inside narrow/large viewports at maximum offsets', () => {
    for (const viewport of [{ width: 320, height: 240 }, { width: 390, height: 844 }, { width: 3840, height: 2160 }]) {
      for (const position of DISPLAY_CORNERS) {
        const layout = displayLayout(validatePlayerDisplay({ logo: { scale: 300, marginX: 20, marginY: 20, position } }), viewport)
        expect(layout.logo.left).toBeGreaterThanOrEqual(0)
        expect(layout.logo.top).toBeGreaterThanOrEqual(0)
        expect(layout.logo.left + layout.logo.width).toBeLessThanOrEqual(viewport.width)
        expect(layout.logo.top + layout.logo.height).toBeLessThanOrEqual(viewport.height)
      }
      for (const position of DISPLAY_ANCHORS) {
        for (const offsetX of [-20, 20]) {
          const layout = displayLayout(validatePlayerDisplay({ announcement: { position, offsetX, width: 96, marginY: 20 } }), viewport)
          expect(layout.announcement.left).toBeGreaterThanOrEqual(0)
          expect(layout.announcement.left + layout.announcement.width).toBeLessThanOrEqual(viewport.width)
        }
      }
    }
  })
  it('reserves the opposite band for turn information and avoids the logo corner', () => {
    for (const position of DISPLAY_ANCHORS) {
      for (const corner of DISPLAY_CORNERS) {
        const settings = validatePlayerDisplay({ logo: { enabled: true, position: corner }, announcement: { enabled: true, position } })
        const turn = turnPlacement(settings, { width: 1920, height: 1080 }, true, true)
        expect(turn.position.startsWith(position.startsWith('top') ? 'bottom' : 'top')).toBe(true)
        expect(turn.position).not.toBe(corner)
        expect(turn.maxWidth).toBeGreaterThan(100)
      }
    }
  })
})
