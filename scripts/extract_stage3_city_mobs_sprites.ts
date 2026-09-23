#!/usr/bin/env bun
/**
 * Extract ORIGINAL Pixel Dungeon City mob sprites (warlock.png, golem.png,
 * succubus.png — GPL-3.0, watabou/pixel-dungeon) into
 * src/assets/stage3_city_mobs_sprites.ts as embedded RGBA (base64).
 *
 * Same slice method as scripts/extract_stage3_city_sprites.ts (16x16,
 * idle frame 0 at (0,0), like mob_bee/mob_monk in original_sprites.ts).
 * Nothing redrawn/recolored.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PD_SRC = process.env.PD_SRC ?? '/home/hatch/workspace/pixel-dungeon-src/assets';
const OUT = join(ROOT, 'src', 'assets', 'stage3_city_mobs_sprites.ts');

function decodePNG(path: string): { w: number; h: number; rgba: Buffer } {
  const data = readFileSync(path);
  if (data.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${path}`);
  let pos = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat: Buffer[] = [];
  while (pos < data.length) {
    const len = data.readUInt32BE(pos);
    const type = data.toString('ascii', pos + 4, pos + 8);
    const chunk = data.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = chunk.readUInt32BE(0);
      h = chunk.readUInt32BE(4);
      bitDepth = chunk[8]!;
      colorType = chunk[9]!;
    } else if (type === 'IDAT') {
      idat.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (colorType !== 6 || bitDepth !== 8) throw new Error(`unexpected format: ${path}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const rgba = Buffer.alloc(w * h * 4);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++]!;
    const row = p;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? rgba[y * stride + x - 4]! : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + x]! : 0;
      const c = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4]! : 0;
      let v = raw[row + x]!;
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 0xff;
      }
      rgba[y * stride + x] = v;
    }
    p += stride;
  }
  return { w, h, rgba };
}

const MOBS = [
  { key: 'mob_warlock', file: 'warlock.png', java: 'WarlockSprite.java' },
  { key: 'mob_golem', file: 'golem.png', java: 'GolemSprite.java' },
  { key: 'mob_succubus', file: 'succubus.png', java: 'SuccubusSprite.java' },
];

let out = `/**
 * ORIGINAL Pixel Dungeon City mob sprites (c) Watabou, watabou/pixel-dungeon,
 * used under the GNU General Public License v3.0.
 *
 * GENERATED FILE — do not edit by hand. Regenerate with:
 *   bun scripts/extract_stage3_city_mobs_sprites.ts
 *
 * Idle frame 0 at (0,0), 16x16 (like mob_bee/mob_monk in
 * original_sprites.ts). Nothing redrawn or recolored.
 */

import type { OriginalSprite } from './original_sprites.js';

// prettier-ignore
export const STAGE3_CITY_MOBS_SPRITES: Record<string, OriginalSprite> = {
`;

for (const m of MOBS) {
  const { rgba } = decodePNG(join(PD_SRC, m.file));
  // 16x16 idle frame at (0,0)
  const frame = rgba.subarray(0, 16 * 16 * 4);
  const b64 = frame.toString('base64');
  out += `  // ${m.key}: ${m.file} @(0,0) 16x16 — ${m.java} idle frame 0\n`;
  out += `  ${m.key}: { w: 16, h: 16, rgba: '${b64}' },\n`;
}

out += `};\n`;
writeFileSync(OUT, out);
console.log(`wrote ${OUT}`);
