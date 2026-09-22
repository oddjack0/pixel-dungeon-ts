/**
 * Buff icon strip: the original 7x7 buff icons (buffs.png, BuffIndicator.java)
 * drawn in attach order at vanilla pitch.
 *
 * Vanilla (BuffIndicator.java): TextureFilm(texture, SIZE=7, SIZE=7);
 * layout() draws each attached buff's icon() at x + n*(SIZE+2), y — 7px icon,
 * 2px gap, no cap. Buffs whose icon() is BuffIndicator.NONE (hunger, sleep,
 * regeneration, speed) are skipped. When an icon is removed, vanilla adds an
 * AlphaTweener fading it over 0.6s while scale.set(1 + 5*progress) about the
 * icon center.
 *
 * Canvas scale: TILE_PX (48) is 3x of the 16px art, so the 7px icons draw at
 * 3x (21px) with a 6px gap (27px pitch) — the same relative proportions as
 * vanilla's 7px icons against 16px tiles.
 */
import { ORIGINAL_SPRITES } from '../assets/original_sprites.js';

/** BuffIndicator.SIZE (BuffIndicator.java). */
export const BUFF_ICON_PX = 7;
/** Draw scale: matches TILE_PX 48 = 3x of 16px art. */
export const BUFF_ICON_SCALE = 3;
/** Drawn icon size in CSS px. */
export const BUFF_ICON_DRAW = BUFF_ICON_PX * BUFF_ICON_SCALE; // 21
/** Vanilla 2px gap, scaled. */
export const BUFF_ICON_GAP = 2 * BUFF_ICON_SCALE; // 6
/** x pitch per icon: vanilla (SIZE + 2), scaled. */
export const BUFF_ICON_PITCH = BUFF_ICON_DRAW + BUFF_ICON_GAP; // 27
/** Vanilla removal fade duration (AlphaTweener 0.6f, BuffIndicator.java). */
export const BUFF_REMOVE_MS = 600;

/**
 * BuffKind -> bufficon_* sprite key, mirroring each buff's icon() override.
 * Null = BuffIndicator.NONE (no icon in the strip): Hunger.icon() returns
 * NONE (Hunger.java:131-133), Sleep/Regeneration/Speed have no icon()
 * override, so Buff.icon() returns NONE (Buff.java).
 */
export function buffIconKey(kind: string): string | null {
  switch (kind) {
    case 'burning':
      return 'bufficon_fire'; // Burning.icon() -> FIRE (Burning.java:132-134)
    case 'poison':
      return 'bufficon_poison'; // Poison.icon() -> POISON (Poison.java:55-57)
    case 'paralysis':
      return 'bufficon_paralysis'; // Paralysis.icon() -> PARALYSIS (Paralysis.java:45-47)
    case 'ooze':
      return 'bufficon_ooze'; // Ooze.icon() -> OOZE (Ooze.java:34-36)
    case 'roots':
      return 'bufficon_roots'; // Roots.icon() -> ROOTS (Roots.java:42-44)
    default:
      return null;
  }
}

/**
 * Ordered, de-duplicated sprite keys for the strip (vanilla keys the strip
 * by icon index, so each icon appears at most once).
 */
export function buffStripKeys(buffs: string[]): string[] {
  const keys: string[] = [];
  for (const b of buffs) {
    const k = buffIconKey(b);
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

/** x position of the i-th icon (vanilla: x + i*(SIZE+2)). */
export function buffIconX(x0: number, i: number): number {
  return x0 + i * BUFF_ICON_PITCH;
}

/** A removed icon mid-poof (vanilla tweens the old Image in place). */
export interface RemovedIcon {
  key: string;
  /** Strip x at removal time. */
  x: number;
  /** Removal timestamp (ms). */
  at: number;
}

/**
 * Diff the previous strip keys against the new ones: icons present before
 * but gone now start their 0.6s removal poof at their old strip position.
 * Surviving poofs are kept (vanilla tweens each removed Image independently).
 */
export function trackRemovedIcons(
  prev: { keys: string[]; x0: number },
  nextKeys: string[],
  live: RemovedIcon[],
  now: number,
): RemovedIcon[] {
  const kept = live.filter(
    (r) => nextKeys.includes(r.key) || removedIconTransform(r.at, now) !== null,
  );
  for (let i = 0; i < prev.keys.length; i++) {
    const k = prev.keys[i]!;
    if (!nextKeys.includes(k) && !kept.some((r) => r.key === k)) {
      kept.push({ key: k, x: buffIconX(prev.x0, i), at: now });
    }
  }
  return kept;
}

/**
 * Removal-poof transform at `now`: vanilla AlphaTweener(icon, 0, 0.6f) with
 * image.scale.set(1 + 5*progress) about the icon center (BuffIndicator.java).
 * Null once the 0.6s tween is over.
 */
export function removedIconTransform(
  at: number,
  now: number,
): { scale: number; alpha: number } | null {
  const p = (now - at) / BUFF_REMOVE_MS;
  if (p < 0 || p >= 1) return null;
  return { scale: 1 + 5 * p, alpha: 1 - p };
}

/**
 * Decode a bufficon_* entry to a 7x7 canvas (cached). Null when there is no
 * DOM canvas (headless tests) or the key is missing.
 */
const iconCache = new Map<string, HTMLCanvasElement | null>();

export function buffIconCanvas(key: string): HTMLCanvasElement | null {
  if (iconCache.has(key)) return iconCache.get(key)!;
  let canvas: HTMLCanvasElement | null = null;
  try {
    const spr = ORIGINAL_SPRITES[key];
    if (spr && spr.w === BUFF_ICON_PX && spr.h === BUFF_ICON_PX) {
      const bin = atob(spr.rgba);
      const bytes = new Uint8ClampedArray(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      canvas = document.createElement('canvas');
      canvas.width = BUFF_ICON_PX;
      canvas.height = BUFF_ICON_PX;
      const g = canvas.getContext('2d');
      if (g) {
        g.putImageData(new ImageData(bytes, BUFF_ICON_PX, BUFF_ICON_PX), 0, 0);
      } else {
        canvas = null;
      }
    }
  } catch {
    canvas = null; // headless (no document/atob)
  }
  iconCache.set(key, canvas);
  return canvas;
}
