// Cache-busting production build: bundles src/main.ts and emits dist/
// with a content-hashed JS filename so browsers never serve a stale
// bundle after a redeploy (GitHub Pages + index.html reference it).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = ROOT + 'dist/';

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const proc = Bun.spawnSync(['bun', 'build', 'src/main.ts', '--outdir', 'dist', '--target', 'browser'], {
  cwd: ROOT,
  stdout: 'inherit',
  stderr: 'inherit',
});
if (proc.exitCode !== 0) {
  console.error('bun build failed');
  process.exit(proc.exitCode);
}

const js = readFileSync(DIST + 'main.js');
const hash = createHash('sha256').update(js).digest('hex').slice(0, 10);
const hashedName = `main.${hash}.js`;
renameSync(DIST + 'main.js', DIST + hashedName);

const html = readFileSync(ROOT + 'index.html', 'utf8').replace('./main.js', `./${hashedName}`);
writeFileSync(DIST + 'index.html', html);

console.log(`build ok -> dist/${hashedName}`);
