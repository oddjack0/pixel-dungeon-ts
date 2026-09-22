import { hashSeed } from './core/rng.js';
import { UiManager } from './ui/ui.js';

/**
 * Boot: the UiManager owns the title screen, run lifecycle, input wiring,
 * turn pacing, renderer, and all UI overlays. Game/save mechanics still come
 * from the engine + mechanics workers (UiManager composes them).
 *
 * URL params:
 *   ?seed=N  pre-fills the title screen's seed field (numeric, or any
 *            string — hashed the same way runs are seeded)
 */

function defaultSeed(): string | undefined {
  const q = new URLSearchParams(location.search).get('seed');
  if (q === null || q === '') return undefined;
  const n = Number(q);
  return Number.isFinite(n) && q.trim() !== '' ? `${n >>> 0}` : `${hashSeed(q)}`;
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = new UiManager(canvas);
ui.boot(defaultSeed());

(window as unknown as { ui: UiManager }).ui = ui;
