#!/usr/bin/env bun
/**
 * Extract ORIGINAL Pixel Dungeon sprites (watabou/pixel-dungeon, GPL-3.0)
 * into src/assets/original_sprites.ts as embedded RGBA (base64).
 *
 * Frames are sliced per the original Java sprite classes (TextureFilm sizes
 * and idle frame 0) and padded to 16x16 bottom-aligned where the original
 * frame is smaller. Nothing is redrawn or recolored — pure slice.
 *
 * Source: a local clone of watabou/pixel-dungeon at
 *   ~/workspace/pixel-dungeon-src/assets/*.png
 * (override with PD_SRC env var). Re-run after changing the slice table;
 * the generated file is committed so `bun run build` works without the
 * source clone.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PD_SRC = process.env.PD_SRC ?? '/home/hatch/workspace/pixel-dungeon-src/assets';
const OUT = join(ROOT, 'src', 'assets', 'original_sprites.ts');

interface Decoded {
  w: number;
  h: number;
  rgba: Buffer;
}

const cache = new Map<string, Decoded>();

function decodePNG(path: string): Decoded {
  const hit = cache.get(path);
  if (hit) return hit;
  const data = readFileSync(path);
  if (data.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${path}`);
  let pos = 8;
  let w = 0,
    h = 0,
    bitDepth = 0,
    colorType = 0;
  const idat: Buffer[] = [];
  while (pos < data.length) {
    const len = data.readUInt32BE(pos);
    const type = data.toString('ascii', pos + 4, pos + 8);
    const chunk = data.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = chunk.readUInt32BE(0);
      h = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
    } else if (type === 'IDAT') {
      idat.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG ${path}: bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const recon = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = y * stride;
    const prev = (y - 1) * stride;
    for (let i = 0; i < stride; i++) {
      const v = raw[p++];
      const a = i >= ch ? recon[row + i - ch] : 0;
      const b = y > 0 ? recon[prev + i] : 0;
      const c = y > 0 && i >= ch ? recon[prev + i - ch] : 0;
      let r: number;
      switch (filter) {
        case 0:
          r = v;
          break;
        case 1:
          r = (v + a) & 255;
          break;
        case 2:
          r = (v + b) & 255;
          break;
        case 3:
          r = (v + ((a + b) >> 1)) & 255;
          break;
        case 4: {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          r = (v + pr) & 255;
          break;
        }
        default:
          throw new Error(`bad PNG filter ${filter} in ${path}`);
      }
      recon[row + i] = r;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = y * stride + x * ch;
      const d = (y * w + x) * 4;
      rgba[d] = recon[s];
      rgba[d + 1] = recon[s + 1];
      rgba[d + 2] = recon[s + 2];
      rgba[d + 3] = ch === 4 ? recon[s + 3] : 255;
    }
  }
  const dec = { w, h, rgba };
  cache.set(path, dec);
  return dec;
}

interface Slice {
  key: string;
  file: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pad to 16x16, bottom-aligned, when the frame is smaller. */
  pad?: boolean;
  /** Audit note: where this mapping comes from. */
  note: string;
}

/** tiles0.png: 16x16 tiles, 16 cols; indices = Terrain.java constants. */
const T = (key: string, idx: number, note: string): Slice => ({
  key,
  file: 'tiles0.png',
  x: (idx % 16) * 16,
  y: Math.floor(idx / 16) * 16,
  w: 16,
  h: 16,
  note,
});
/** items.png: 16x16 icons, 8 cols; indices = ItemSpriteSheet.java. */
const I = (key: string, idx: number, note: string): Slice => ({
  key,
  file: 'items.png',
  x: (idx % 8) * 16,
  y: Math.floor(idx / 8) * 16,
  w: 16,
  h: 16,
  note,
});
/**
 * buffs.png: 7x7 buff icons; TextureFilm(texture, 7, 7) (BuffIndicator.java).
 * cols = 128 / 7 = 18, rows = 16 / 7 = 2; frame i at ((i % 18) * 7, (i / 18 | 0) * 7).
 * Constants = BuffIndicator.java icon indices (MIND_VISION = 0 .. SACRIFICE = 31).
 */
const B = (key: string, idx: number, note: string): Slice => ({
  key,
  file: 'buffs.png',
  x: (idx % 18) * 7,
  y: Math.floor(idx / 18) * 7,
  w: 7,
  h: 7,
  note,
});

const SLICES: Slice[] = [
  // --- hero & mobs: idle frame 0, per the original *Sprite.java classes ---
  { key: 'hero', file: 'warrior.png', x: 0, y: 15, w: 12, h: 15, pad: true, note: 'HeroSprite: tier row 1 (cloth armor, hero starts equipped), frame 0' },
  { key: 'hero_warrior', file: 'warrior.png', x: 0, y: 15, w: 12, h: 15, pad: true, note: 'HeroSprite: tier row 1 (cloth armor), frame 0' },
  { key: 'mob_rat', file: 'rat.png', x: 0, y: 0, w: 16, h: 15, pad: true, note: 'RatSprite: TextureFilm 16x15, idle frame 0' },
  { key: 'mob_gnoll', file: 'gnoll.png', x: 0, y: 0, w: 12, h: 15, pad: true, note: 'GnollSprite: TextureFilm 12x15, idle frame 0' },
  { key: 'mob_crab', file: 'crab.png', x: 0, y: 0, w: 16, h: 16, note: 'CrabSprite: TextureFilm 16 (16x16), idle frame 0' },
  { key: 'mob_swarm', file: 'swarm.png', x: 0, y: 0, w: 16, h: 16, note: 'SwarmSprite: TextureFilm 16x16, idle frame 0' },
  { key: 'mob_skeleton', file: 'skeleton.png', x: 0, y: 0, w: 12, h: 15, pad: true, note: 'SkeletonSprite: TextureFilm 12x15, idle frame 0' },
  { key: 'mob_thief', file: 'thief.png', x: 0, y: 0, w: 12, h: 13, pad: true, note: 'ThiefSprite: TextureFilm 12x13, idle frame 0' },
  { key: 'mob_goo', file: 'goo.png', x: 0, y: 0, w: 20, h: 14, pad: true, note: 'GooSprite: TextureFilm 20x14, idle frame 0' },
  // --- items ---
  I('shortsword', 2, 'ItemSpriteSheet.SHORT_SWORD'),
  I('dart', 31, 'ItemSpriteSheet.DART'),
  I('armor_cloth', 24, 'ItemSpriteSheet.ARMOR_CLOTH'),
  I('potion_red', 57, 'ItemSpriteSheet.POTION_CRIMSON (potion of healing)'),
  I('potion_strength', 60, 'ItemSpriteSheet.POTION_GOLDEN (potion of strength)'),
  I('ration', 4, 'ItemSpriteSheet.RATION'),
  I('scroll', 40, 'ItemSpriteSheet.SCROLL_KAUNAN (unidentified scroll rune)'),
  I('scroll_upgrade', 41, 'ItemSpriteSheet.SCROLL_SOWILO (unidentified scroll rune)'),
  I('gold', 14, 'ItemSpriteSheet.GOLD'),
  I('key_iron', 9, 'ItemSpriteSheet.IRON_KEY'),
  I('key_skeleton', 8, 'ItemSpriteSheet.SKELETON_KEY'),
  // Heap sprites (Heap.image -> ItemSpriteSheet): chests/tombs/bones are heap
  // sprites drawn on floor cells in the original, not terrain tiles.
  I('chest', 11, 'ItemSpriteSheet.CHEST'),
  I('chest_locked', 12, 'ItemSpriteSheet.LOCKED_CHEST'),
  I('tomb', 13, 'ItemSpriteSheet.TOMB'),
  I('bones', 0, 'ItemSpriteSheet.BONES'),
  // --- tiles (indices = Terrain.java constants) ---
  T('floor0', 1, 'Terrain.EMPTY'),
  T('floor1', 24, 'Terrain.EMPTY_DECO (floor variant)'),
  T('wall', 4, 'Terrain.WALL'),
  T('door', 5, 'Terrain.DOOR'),
  T('door_locked', 10, 'Terrain.LOCKED_DOOR'),
  T('door_secret', 16, 'Terrain.SECRET_DOOR'),
  T('stairs_up', 7, 'Terrain.ENTRANCE'),
  T('stairs_down', 8, 'Terrain.EXIT'),
  T('embers', 9, 'Terrain.EMBERS'),
  T('grass', 2, 'Terrain.GRASS'),
  T('chasm', 0, 'Terrain.CHASM'),
  T('well', 34, 'Terrain.WELL'),
  // Special-room tiles (indices = Terrain.java constants).
  T('pedestal', 11, 'Terrain.PEDESTAL'),
  T('statue', 35, 'Terrain.STATUE'),
  T('bookshelf', 41, 'Terrain.BOOKSHELF'),
  T('alchemy', 42, 'Terrain.ALCHEMY'),
  { key: 'water', file: 'water0.png', x: 0, y: 0, w: 16, h: 16, note: 'water0.png frame (0,0); original animates, M1 is static' },
  T('trap_revealed', 17, 'alias of trap_toxic (legacy key)'),
  T('trap_toxic', 17, 'Terrain.TOXIC_TRAP'),
  T('trap_fire', 19, 'Terrain.FIRE_TRAP'),
  T('trap_paralytic', 21, 'Terrain.PARALYTIC_TRAP'),
  T('trap_poison', 27, 'Terrain.POISON_TRAP'),
  T('trap_alarm', 30, 'Terrain.ALARM_TRAP'),
  T('trap_lightning', 32, 'Terrain.LIGHTNING_TRAP'),
  T('trap_gripping', 37, 'Terrain.GRIPPING_TRAP'),
  T('trap_summoning', 39, 'Terrain.SUMMONING_TRAP'),
  // Secret (hidden) trap tiles: vanilla renders SECRET_*_TRAP map cells with
  // these floor-like tiles (DungeonTilemap draws the map tile directly).
  T('trap_toxic_secret', 18, 'Terrain.SECRET_TOXIC_TRAP'),
  T('trap_fire_secret', 20, 'Terrain.SECRET_FIRE_TRAP'),
  T('trap_paralytic_secret', 22, 'Terrain.SECRET_PARALYTIC_TRAP'),
  T('trap_inactive', 23, 'Terrain.INACTIVE_TRAP (visible, inert)'),
  T('trap_poison_secret', 28, 'Terrain.SECRET_POISON_TRAP'),
  T('trap_alarm_secret', 31, 'Terrain.SECRET_ALARM_TRAP'),
  T('trap_lightning_secret', 33, 'Terrain.SECRET_LIGHTNING_TRAP'),
  T('trap_gripping_secret', 38, 'Terrain.SECRET_GRIPPING_TRAP'),
  T('trap_summoning_secret', 40, 'Terrain.SECRET_SUMMONING_TRAP'),
  // High grass and sign tiles (indices = Terrain.java constants).
  T('high_grass', 15, 'Terrain.HIGH_GRASS'),
  T('sign', 29, 'Terrain.SIGN'),
  // --- buff icons: 7x7, BuffIndicator.java constants (buffs.png) ---
  B('bufficon_mind_vision', 0, 'BuffIndicator.MIND_VISION'),
  B('bufficon_levitation', 1, 'BuffIndicator.LEVITATION'),
  B('bufficon_fire', 2, 'BuffIndicator.FIRE'),
  B('bufficon_poison', 3, 'BuffIndicator.POISON'),
  B('bufficon_paralysis', 4, 'BuffIndicator.PARALYSIS'),
  B('bufficon_hunger', 5, 'BuffIndicator.HUNGER'),
  B('bufficon_starvation', 6, 'BuffIndicator.STARVATION'),
  B('bufficon_slow', 7, 'BuffIndicator.SLOW'),
  B('bufficon_ooze', 8, 'BuffIndicator.OOZE'),
  B('bufficon_amok', 9, 'BuffIndicator.AMOK'),
  B('bufficon_terror', 10, 'BuffIndicator.TERROR'),
  B('bufficon_roots', 11, 'BuffIndicator.ROOTS'),
  B('bufficon_invisible', 12, 'BuffIndicator.INVISIBLE'),
  B('bufficon_shadows', 13, 'BuffIndicator.SHADOWS'),
  B('bufficon_weakness', 14, 'BuffIndicator.WEAKNESS'),
  B('bufficon_frost', 15, 'BuffIndicator.FROST'),
  B('bufficon_blindness', 16, 'BuffIndicator.BLINDNESS'),
  B('bufficon_combo', 17, 'BuffIndicator.COMBO'),
  B('bufficon_fury', 18, 'BuffIndicator.FURY'),
  B('bufficon_healing', 19, 'BuffIndicator.HEALING'),
  B('bufficon_armor', 20, 'BuffIndicator.ARMOR'),
  B('bufficon_heart', 21, 'BuffIndicator.HEART'),
  B('bufficon_light', 22, 'BuffIndicator.LIGHT'),
  B('bufficon_cripple', 23, 'BuffIndicator.CRIPPLE'),
  B('bufficon_barkskin', 24, 'BuffIndicator.BARKSKIN'),
  B('bufficon_immunity', 25, 'BuffIndicator.IMMUNITY'),
  B('bufficon_bleeding', 26, 'BuffIndicator.BLEEDING'),
  B('bufficon_mark', 27, 'BuffIndicator.MARK'),
  B('bufficon_deferred', 28, 'BuffIndicator.DEFERRED'),
  B('bufficon_vertigo', 29, 'BuffIndicator.VERTIGO'),
  B('bufficon_rage', 30, 'BuffIndicator.RAGE'),
  B('bufficon_sacrifice', 31, 'BuffIndicator.SACRIFICE'),
  // NOTE: status_pane.png has NO opaque "strip background" art — its shield
  // interior is alpha 0 in the source PNG (verified with PIL against the raw
  // file; vanilla draws the buff icons directly on the pane, whose interior
  // shows the black scene behind it). The icon strip therefore needs no
  // additional chrome; the HUD's dark top bar is its background.
];

function extract(s: Slice): { w: number; h: number; b64: string } {
  const src = decodePNG(join(PD_SRC, s.file));
  if (s.x + s.w > src.w || s.y + s.h > src.h) {
    throw new Error(`slice ${s.key} out of bounds in ${s.file}`);
  }
  const W = s.pad ? 16 : s.w;
  const H = s.pad ? 16 : s.h;
  const out = Buffer.alloc(W * H * 4); // transparent
  const dx = 0;
  const dy = s.pad ? H - s.h : 0; // bottom-align
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const sp = ((s.y + y) * src.w + (s.x + x)) * 4;
      const dp = ((dy + y) * W + (dx + x)) * 4;
      out[dp] = src.rgba[sp];
      out[dp + 1] = src.rgba[sp + 1];
      out[dp + 2] = src.rgba[sp + 2];
      out[dp + 3] = src.rgba[sp + 3];
    }
  }
  return { w: W, h: H, b64: out.toString('base64') };
}

const lines: string[] = [
  '/**',
  ' * ORIGINAL Pixel Dungeon sprites (c) Watabou, watabou/pixel-dungeon,',
  ' * used under the GNU General Public License v3.0.',
  ' *',
  ' * GENERATED FILE — do not edit by hand. Regenerate with:',
  ' *   bun scripts/extract_original_sprites.ts',
  ' * (needs a watabou/pixel-dungeon clone; PD_SRC env overrides the path).',
  ' *',
  ' * Frames are sliced per the original Java *Sprite classes (idle frame 0;',
  ' * hero uses the cloth-armor tier row) and padded to 16x16 bottom-aligned',
  ' * where the original frame is smaller. Nothing redrawn or recolored.',
  ' */',
  '',
  '/** One extracted sprite: 16x16 RGBA pixels (padded), base64-encoded. */',
  'export interface OriginalSprite {',
  '  w: number;',
  '  h: number;',
  '  /** base64 of w*h*4 RGBA bytes, row-major. */',
  '  rgba: string;',
  '}',
  '',
  '// prettier-ignore',
  'export const ORIGINAL_SPRITES: Record<string, OriginalSprite> = {',
];

for (const s of SLICES) {
  const { w, h, b64 } = extract(s);
  lines.push(`  // ${s.key}: ${s.file} @(${s.x},${s.y}) ${s.w}x${s.h} — ${s.note}`);
  lines.push(`  ${s.key}: { w: ${w}, h: ${h}, rgba: '${b64}' },`);
}
lines.push('};', '');

writeFileSync(OUT, lines.join('\n'));
const bytes = SLICES.length;
console.log(`extracted ${bytes} sprites -> ${OUT}`);

// --- pixel verification: re-read the generated file and compare every
// entry byte-for-byte against a fresh slice of the source PNG. ---
{
  const gen = readFileSync(OUT, 'utf8');
  const entry = /^  (\w+): \{ w: (\d+), h: (\d+), rgba: '([A-Za-z0-9+/=]+)' \},$/gm;
  let verified = 0;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(gen)) !== null) {
    const [, key, w, h, b64] = m;
    const slice = SLICES.find((s) => s.key === key);
    if (!slice) throw new Error(`verify: unknown key ${key} in generated file`);
    const fresh = extract(slice);
    if (Number(w) !== fresh.w || Number(h) !== fresh.h || b64 !== fresh.b64) {
      throw new Error(`verify FAILED for ${key}: generated pixels differ from ${slice.file}`);
    }
    verified++;
  }
  if (verified !== SLICES.length) {
    throw new Error(`verify: only ${verified}/${SLICES.length} entries checked`);
  }
  console.log(`verified ${verified}/${SLICES.length} pixel-identical to source PNGs`);
}
