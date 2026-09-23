#!/usr/bin/env bun
/**
 * Extract ORIGINAL Pixel Dungeon city tiles (tiles3.png / water3.png,
 * GPL-3.0, watabou/pixel-dungeon) into src/assets/stage3_city_sprites.ts
 * as embedded RGBA (base64), `STAGE3_CITY_SPRITES`.
 *
 * Same slice method as scripts/extract_original_sprites.ts (16x16 tiles,
 * 16 columns, indices = levels/Terrain.java constants; water3.png frame
 * (0,0), static like the other water entries). Nothing redrawn/recolored.
 *
 * Source: a local clone of watabou/pixel-dungeon at
 *   ~/workspace/pixel-dungeon-src/assets/*.png
 * (override with PD_SRC env var). The coordinator merges this file into the
 * tileset at integration; this file is committed so the build works.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PD_SRC = process.env.PD_SRC ?? '/home/hatch/workspace/pixel-dungeon-src/assets';
const OUT = join(ROOT, 'src', 'assets', 'stage3_city_sprites.ts');

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
  /** Audit note: where this mapping comes from. */
  note: string;
}

/** tiles3.png: 16x16 tiles, 16 cols; indices = Terrain.java constants (city theme). */
const T3 = (key: string, idx: number, note: string): Slice => ({
  key,
  file: 'tiles3.png',
  x: (idx % 16) * 16,
  y: Math.floor(idx / 16) * 16,
  w: 16,
  h: 16,
  note,
});

// --- City tileset (indices = levels/Terrain.java constants) ---
const SLICES: Slice[] = [
  T3('tile_city_chasm', 0, 'Terrain.CHASM'),
  T3('tile_city_floor', 1, 'Terrain.EMPTY'),
  T3('tile_city_grass', 2, 'Terrain.GRASS'),
  T3('tile_city_empty_sp', 14, 'Terrain.EMPTY_SP (walkway/carpet aisle)'),
  T3('tile_city_wall', 4, 'Terrain.WALL'),
  T3('tile_city_door', 5, 'Terrain.DOOR'),
  T3('tile_city_entrance', 7, 'Terrain.ENTRANCE'),
  T3('tile_city_exit', 8, 'Terrain.EXIT'),
  T3('tile_city_embers', 9, 'Terrain.EMBERS'),
  T3('tile_city_door_locked', 10, 'Terrain.LOCKED_DOOR'),
  T3('tile_city_pedestal', 11, 'Terrain.PEDESTAL (King arena)'),
  T3('tile_city_wall_deco', 12, 'Terrain.WALL_DECO'),
  T3('tile_city_high_grass', 15, 'Terrain.HIGH_GRASS'),
  T3('tile_city_door_secret', 16, 'Terrain.SECRET_DOOR'),
  T3('tile_city_trap_toxic', 17, 'Terrain.TOXIC_TRAP'),
  T3('tile_city_trap_toxic_secret', 18, 'Terrain.SECRET_TOXIC_TRAP'),
  T3('tile_city_trap_fire', 19, 'Terrain.FIRE_TRAP'),
  T3('tile_city_trap_fire_secret', 20, 'Terrain.SECRET_FIRE_TRAP'),
  T3('tile_city_trap_paralytic', 21, 'Terrain.PARALYTIC_TRAP'),
  T3('tile_city_trap_paralytic_secret', 22, 'Terrain.SECRET_PARALYTIC_TRAP'),
  T3('tile_city_trap_inactive', 23, 'Terrain.INACTIVE_TRAP'),
  T3('tile_city_floor_deco', 24, 'Terrain.EMPTY_DECO (floor variant)'),
  T3('tile_city_locked_exit', 25, 'Terrain.LOCKED_EXIT (King arena exit)'),
  T3('tile_city_trap_poison', 27, 'Terrain.POISON_TRAP'),
  T3('tile_city_trap_poison_secret', 28, 'Terrain.SECRET_POISON_TRAP'),
  T3('tile_city_sign', 29, 'Terrain.SIGN'),
  T3('tile_city_trap_alarm', 30, 'Terrain.ALARM_TRAP'),
  T3('tile_city_trap_alarm_secret', 31, 'Terrain.SECRET_ALARM_TRAP'),
  T3('tile_city_trap_lightning', 32, 'Terrain.LIGHTNING_TRAP'),
  T3('tile_city_trap_lightning_secret', 33, 'Terrain.SECRET_LIGHTNING_TRAP'),
  T3('tile_city_well', 34, 'Terrain.WELL'),
  T3('tile_city_statue', 35, 'Terrain.STATUE'),
  T3('tile_city_statue_sp', 36, 'Terrain.STATUE_SP (King arena hall pairs)'),
  T3('tile_city_trap_gripping', 37, 'Terrain.GRIPPING_TRAP'),
  T3('tile_city_trap_gripping_secret', 38, 'Terrain.SECRET_GRIPPING_TRAP'),
  T3('tile_city_trap_summoning', 39, 'Terrain.SUMMONING_TRAP'),
  T3('tile_city_trap_summoning_secret', 40, 'Terrain.SECRET_SUMMONING_TRAP'),
  T3('tile_city_bookshelf', 41, 'Terrain.BOOKSHELF (King entrance chamber)'),
  T3('tile_city_alchemy', 42, 'Terrain.ALCHEMY'),
  { key: 'tile_city_water', file: 'water3.png', x: 0, y: 0, w: 16, h: 16, note: 'water3.png frame (0,0); original animates, static like the other water entries' },
];

function extract(s: Slice): { w: number; h: number; b64: string } {
  const src = decodePNG(join(PD_SRC, s.file));
  if (s.x + s.w > src.w || s.y + s.h > src.h) {
    throw new Error(`slice ${s.key} out of bounds in ${s.file}`);
  }
  const out = Buffer.alloc(s.w * s.h * 4);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const sp = ((s.y + y) * src.w + (s.x + x)) * 4;
      const dp = (y * s.w + x) * 4;
      out[dp] = src.rgba[sp];
      out[dp + 1] = src.rgba[sp + 1];
      out[dp + 2] = src.rgba[sp + 2];
      out[dp + 3] = src.rgba[sp + 3];
    }
  }
  return { w: s.w, h: s.h, b64: out.toString('base64') };
}

const lines: string[] = [
  '/**',
  ' * ORIGINAL Pixel Dungeon city tiles (c) Watabou, watabou/pixel-dungeon,',
  ' * used under the GNU General Public License v3.0.',
  ' *',
  ' * GENERATED FILE — do not edit by hand. Regenerate with:',
  ' *   bun scripts/extract_stage3_city_sprites.ts',
  ' * (needs a watabou/pixel-dungeon clone; PD_SRC env overrides the path).',
  ' *',
  ' * Sliced per levels/Terrain.java indices from tiles3.png (16x16, 16 cols)',
  ' * and water3.png frame (0,0). Nothing redrawn or recolored. Merged into',
  ' * the tileset at Stage 3 integration.',
  ' */',
  '',
  "import type { OriginalSprite } from './original_sprites.js';",
  '',
  '// prettier-ignore',
  'export const STAGE3_CITY_SPRITES: Record<string, OriginalSprite> = {',
];

for (const s of SLICES) {
  const { w, h, b64 } = extract(s);
  lines.push(`  // ${s.key}: ${s.file} @(${s.x},${s.y}) ${s.w}x${s.h} — ${s.note}`);
  lines.push(`  ${s.key}: { w: ${w}, h: ${h}, rgba: '${b64}' },`);
}
lines.push('};', '');

writeFileSync(OUT, lines.join('\n'));
console.log(`extracted ${SLICES.length} city sprites -> ${OUT}`);

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
    throw new Error(`verify: ${verified}/${SLICES.length} entries verified`);
  }
  console.log(`verified ${verified} city sprites byte-for-byte`);
}
