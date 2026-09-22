/**
 * Regression: the dungeon camera is the FULL-WINDOW noosa Camera.main
 * (vanilla GameScene.java:125 `Camera.main.zoom( defaultZoom + PixelDungeon.zoom() )`
 * on a fullscreen PixelCamera; :289 `Camera.main.target = hero`). The port must
 * draw tiles across the entire window, centered exactly on the hero, with no
 * fixed sub-rectangle viewport and no clamping to level bounds (vanilla shows
 * black void beyond map edges).
 *
 * Coverage tests use a level larger than the view (64x64) so no map edge is
 * in frame: every drawn tile must exist, and the drawn span must reach every
 * window edge. A fixed 560x570-style sub-viewport would fail these.
 */
import { describe, expect, test } from 'bun:test';
import { cameraTileRect, TILE_PX } from '../src/engine/render.js';

/** Level bigger than any tested view: no map-edge void in frame. */
const LEVEL_W = 64;
const LEVEL_H = 64;
const HX = 32;
const HY = 32;

function spanCovers(r: ReturnType<typeof cameraTileRect>, vw: number, vh: number) {
  const left = (r.x0 - r.camX) * TILE_PX;
  const right = (r.x1 + 1 - r.camX) * TILE_PX;
  const top = (r.y0 - r.camY) * TILE_PX;
  const bottom = (r.y1 + 1 - r.camY) * TILE_PX;
  return { left, right, top, bottom };
}

describe('cameraTileRect', () => {
  test('hero is exactly centered in the window', () => {
    const vw = 1919;
    const vh = 992;
    const r = cameraTileRect(HX, HY, vw, vh, LEVEL_W, LEVEL_H);
    expect((HX + 0.5 - r.camX) * TILE_PX).toBeCloseTo(vw / 2, 9);
    expect((HY + 0.5 - r.camY) * TILE_PX).toBeCloseTo(vh / 2, 9);
  });

  test('drawn tiles cover the full 1919x992 window (no black bars)', () => {
    const r = cameraTileRect(HX, HY, 1919, 992, LEVEL_W, LEVEL_H);
    const { left, right, top, bottom } = spanCovers(r, 1919, 992);
    expect(left).toBeLessThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(1919);
    expect(top).toBeLessThanOrEqual(0);
    expect(bottom).toBeGreaterThanOrEqual(992);
  });

  test('coverage holds at other window sizes (desktop, phone portrait)', () => {
    for (const [vw, vh] of [
      [1920, 1080],
      [1366, 768],
      [390, 844],
      [800, 600],
    ] as const) {
      const r = cameraTileRect(HX, HY, vw, vh, LEVEL_W, LEVEL_H);
      const { left, right, top, bottom } = spanCovers(r, vw, vh);
      expect(left).toBeLessThanOrEqual(0);
      expect(right).toBeGreaterThanOrEqual(vw);
      expect(top).toBeLessThanOrEqual(0);
      expect(bottom).toBeGreaterThanOrEqual(vh);
      // Exact centering at every size.
      expect((HX + 0.5 - r.camX) * TILE_PX).toBeCloseTo(vw / 2, 9);
      expect((HY + 0.5 - r.camY) * TILE_PX).toBeCloseTo(vh / 2, 9);
    }
  });

  test('no level-bounds clamping on the camera itself (vanilla shows void at edges)', () => {
    // Hero in the top-left corner of a real 32x32 level: the camera must go
    // negative (unclamped) — only the tile INDEX range clamps for safety.
    const r = cameraTileRect(0, 0, 1919, 992, 32, 32);
    expect(r.camX).toBeLessThan(0);
    expect(r.camY).toBeLessThan(0);
    expect(r.x0).toBe(0);
    expect(r.y0).toBe(0);
    expect(r.x1).toBeLessThanOrEqual(31);
    expect(r.y1).toBeLessThanOrEqual(31);
  });

  test('fractional hero positions keep the hero centered and the view tiled', () => {
    // Hero positions well clear of every map edge (view is ~40x20 tiles,
    // so keep 20+ tiles from each edge on the 64x64 level).
    for (const hx of [24, 32, 40]) {
      for (const hy of [24, 32, 40]) {
        const r = cameraTileRect(hx, hy, 1919, 992, LEVEL_W, LEVEL_H);
        const { left, top } = spanCovers(r, 1919, 992);
        expect(left).toBeLessThanOrEqual(0);
        expect(top).toBeLessThanOrEqual(0);
        // Hero stays within half a tile of exact center regardless of fraction.
        expect(Math.abs((hx + 0.5 - r.camX) * TILE_PX - 1919 / 2)).toBeLessThanOrEqual(TILE_PX / 2);
      }
    }
  });
});
