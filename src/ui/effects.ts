/**
 * Combat feedback: damage numbers, hit flashes, death poofs, potion
 * sparkles, level-up bursts, Goo's pump-up telegraph, and the boss HP bar.
 *
 * Detection is robust, not message-parsing: every frame `watch()` diffs a
 * snapshot of actor HP/positions/levels against the previous frame. Only the
 * potion-drink sparkle keys off log text (there is no heal event on the
 * seam), and it degrades gracefully to nothing when no match is found.
 *
 * All drawing is canvas shapes + text in the storybook palette; entity art
 * itself is never redrawn here.
 */
import type { Game } from '../engine/loop.js';
import { drawBar, UI, type View } from './palette.js';

export type ToScreen = (tx: number, ty: number) => { x: number; y: number };

interface FloatText {
  tx: number;
  ty: number;
  text: string;
  color: string;
  size: number;
  age: number;
  ttl: number;
  rise: number; // tiles per second
}

interface Flash {
  tx: number;
  ty: number;
  age: number;
  ttl: number;
  color: string;
}

interface Particle {
  tx: number;
  ty: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  color: string;
  size: number; // px at spawn
}

interface Snap {
  hp: number;
  x: number;
  y: number;
}

function isGoo(m: { sprite: string; name: string }): boolean {
  const extra = m as unknown as { mobId?: string };
  return extra.mobId === 'goo' || m.sprite === 'mob_goo' || m.name.toLowerCase() === 'goo';
}

export class Effects {
  /** Fired when a mob disappears between frames (UiManager counts kills). */
  onMobDeath: (name: string) => void = () => {};

  private floats: FloatText[] = [];
  private flashes: Flash[] = [];
  private particles: Particle[] = [];
  private banner: { text: string; sub: string; age: number; ttl: number } | null = null;

  private heroSnap: (Snap & { lvl: number }) | null = null;
  private mobSnaps = new Map<number, Snap & { name: string }>();
  private gooPumped = false;
  private gooSeen = false;
  private logCursor = 0;
  private lastNow = 0;

  reset(): void {
    this.floats = [];
    this.flashes = [];
    this.particles = [];
    this.banner = null;
    this.heroSnap = null;
    this.mobSnaps.clear();
    this.gooPumped = false;
    this.gooSeen = false;
    this.logCursor = 0;
  }

  /** Read-only views for tests. */
  get floatTexts(): ReadonlyArray<FloatText> {
    return this.floats;
  }
  get flashes_(): ReadonlyArray<Flash> {
    return this.flashes;
  }
  get particles_(): ReadonlyArray<Particle> {
    return this.particles;
  }
  get banner_(): { text: string; sub: string; age: number; ttl: number } | null {
    return this.banner;
  }
  get gooTelegraphOn(): boolean {
    return this.gooPumped;
  }

  watch(game: Game, nowMs: number): void {
    const dt = Math.min(0.25, Math.max(0, (nowMs - this.lastNow) / 1000 || 0.016));
    this.lastNow = nowMs;
    this.ageAll(dt);

    // --- hero diff ---
    const hero = game.hero;
    const hlvl = (hero as unknown as { lvl?: number }).lvl ?? 1;
    if (!this.heroSnap) {
      this.heroSnap = { hp: hero.hp, x: hero.x, y: hero.y, lvl: hlvl };
    } else {
      const s = this.heroSnap;
      if (hero.hp < s.hp) {
        const dmg = s.hp - hero.hp;
        this.floats.push(this.mkFloat(hero.x, hero.y, `${dmg}`, UI.dmgHero, 15));
        this.flashes.push({ tx: hero.x, ty: hero.y, age: 0, ttl: 0.18, color: 'rgba(255,80,60,0.55)' });
      } else if (hero.hp > s.hp) {
        this.floats.push(this.mkFloat(hero.x, hero.y, `+${hero.hp - s.hp}`, UI.heal, 14));
      }
      if (hlvl > s.lvl) {
        this.banner = { text: 'LEVEL UP!', sub: `Welcome to level ${hlvl}`, age: 0, ttl: 1.6 };
        this.burst(hero.x, hero.y, UI.gold, 14);
      }
      this.heroSnap = { hp: hero.hp, x: hero.x, y: hero.y, lvl: hlvl };
    }

    // --- mob diffs ---
    const seen = new Set<number>();
    let gooAlive: { x: number; y: number; hp: number; ht: number; pumped: boolean; visible: boolean } | null = null;
    for (const m of game.mobs) {
      seen.add(m.id);
      const prev = this.mobSnaps.get(m.id);
      if (prev) {
        if (m.hp < prev.hp) {
          const dmg = prev.hp - m.hp;
          this.floats.push(this.mkFloat(m.x, m.y, `${dmg}`, UI.dmgMob, 14));
          this.flashes.push({ tx: m.x, ty: m.y, age: 0, ttl: 0.15, color: 'rgba(255,255,255,0.6)' });
        }
      }
      this.mobSnaps.set(m.id, { hp: m.hp, x: m.x, y: m.y, name: m.name });
      if (isGoo(m)) {
        const pumped = (m as unknown as { pumpedUp?: boolean }).pumpedUp === true;
        const i = game.level.idx(m.x, m.y);
        gooAlive = { x: m.x, y: m.y, hp: m.hp, ht: m.ht, pumped, visible: game.level.visible[i] === 1 };
        this.gooSeen = this.gooSeen || gooAlive.visible;
        if (pumped && !this.gooPumped) {
          // Rising edge: Goo starts pumping — telegraph the big hit.
          this.floats.push({ ...this.mkFloat(m.x, m.y - 1, '!', '#ff9a3d', 22), ttl: 0.9 });
          this.ring(m.x, m.y, '#ff9a3d');
        }
        this.gooPumped = pumped;
      }
    }
    for (const [id, prev] of this.mobSnaps) {
      if (!seen.has(id)) {
        // Mob left the level: death poof at its last position.
        this.poof(prev.x, prev.y);
        this.onMobDeath(prev.name);
        this.mobSnaps.delete(id);
      }
    }
    if (!gooAlive) this.gooPumped = false;
    this.gooInfo = gooAlive;

    // --- potion-drink sparkle (log-keyed; degrades to nothing) ---
    const fresh = game.log.slice(this.logCursor);
    this.logCursor = game.log.length;
    for (const line of fresh) {
      if (/you (drink|quaff)/i.test(line)) {
        this.sparkle(hero.x, hero.y);
      }
    }
  }

  private gooInfo: { x: number; y: number; hp: number; ht: number; pumped: boolean; visible: boolean } | null = null;

  draw(ctx: CanvasRenderingContext2D, game: Game, toScreen: ToScreen, view: View, nowMs: number): void {
    void game;
    // hit flashes
    for (const f of this.flashes) {
      const p = toScreen(f.tx, f.ty);
      const a = 1 - f.age / f.ttl;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = f.color;
      ctx.fillRect(p.x - 24, p.y - 24, 48, 48);
    }
    ctx.globalAlpha = 1;

    // particles
    for (const pt of this.particles) {
      const p = toScreen(pt.tx + pt.vx * pt.age, pt.ty + pt.vy * pt.age);
      const a = pt.age < 0 ? 0 : 1 - pt.age / pt.ttl;
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.fillStyle = pt.color;
      const s = pt.size * (1 - pt.age / pt.ttl * 0.5);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // floating combat text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.floats) {
      const p = toScreen(f.tx, f.ty - f.rise * f.age);
      const a = f.age < f.ttl * 0.6 ? 1 : 1 - (f.age - f.ttl * 0.6) / (f.ttl * 0.4);
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.font = `bold ${f.size}px system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(10,8,14,0.85)';
      ctx.strokeText(f.text, p.x, p.y - 10);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, p.x, p.y - 10);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';

    // Goo pump-up telegraph: pulsing warning ring while pumped.
    if (this.gooInfo?.pumped) {
      const p = toScreen(this.gooInfo.x, this.gooInfo.y);
      const pulse = 30 + Math.sin(nowMs / 130) * 6;
      ctx.strokeStyle = '#ff9a3d';
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Boss HP bar.
    if (this.gooInfo && this.gooSeen) {
      const g = this.gooInfo;
      const bw = Math.min(320, view.w - 48);
      const r = { x: (view.w - bw) / 2, y: 70, w: bw, h: 15 };
      drawBar(ctx, r, g.hp / Math.max(1, g.ht), UI.boss, UI.bossTrack, `GOO  ${Math.max(0, g.hp)}/${g.ht}`, 11);
    }

    // Level-up banner.
    if (this.banner) {
      const b = this.banner;
      const a = b.age < 0.2 ? b.age / 0.2 : b.age > b.ttl - 0.4 ? Math.max(0, (b.ttl - b.age) / 0.4) : 1;
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(10,8,14,0.9)';
      ctx.strokeText(b.text, view.w / 2, view.h * 0.38);
      ctx.fillStyle = UI.gold;
      ctx.fillText(b.text, view.w / 2, view.h * 0.38);
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillStyle = UI.textLight;
      ctx.fillText(b.sub, view.w / 2, view.h * 0.38 + 30);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
  }

  private mkFloat(tx: number, ty: number, text: string, color: string, size: number): FloatText {
    return { tx, ty, text, color, size, age: 0, ttl: 0.9, rise: 1.6 };
  }

  private ageAll(dt: number): void {
    for (const f of this.floats) f.age += dt;
    for (const f of this.flashes) f.age += dt;
    for (const p of this.particles) p.age += dt;
    if (this.banner) this.banner.age += dt;
    this.floats = this.floats.filter((f) => f.age < f.ttl);
    this.flashes = this.flashes.filter((f) => f.age < f.ttl);
    this.particles = this.particles.filter((p) => p.age < p.ttl);
    if (this.banner && this.banner.age >= this.banner.ttl) this.banner = null;
  }

  /** Death poof: soft tan/gray motes drifting up. */
  private poof(tx: number, ty: number): void {
    const colors = ['#cbbfa4', '#a89a80', '#e6dcc2'];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      this.particles.push({
        tx: tx + 0.5,
        ty: ty + 0.5,
        vx: Math.cos(a) * 1.4,
        vy: Math.sin(a) * 1.4 - 1.2,
        age: 0,
        ttl: 0.45 + (i % 3) * 0.12,
        color: colors[i % colors.length],
        size: 7 + (i % 3) * 3,
      });
    }
  }

  /** Potion-drink sparkle: rising gold/white glints. */
  private sparkle(tx: number, ty: number): void {
    for (let i = 0; i < 8; i++) {
      this.particles.push({
        tx: tx + 0.5 + (i % 4) * 0.12 - 0.18,
        ty: ty + 0.6,
        vx: 0,
        vy: -2.2 - (i % 3) * 0.5,
        age: -i * 0.03,
        ttl: 0.7,
        color: i % 2 ? '#ffe9a8' : '#ffffff',
        size: 5,
      });
    }
  }

  /** Level-up burst: gold ring of sparks. */
  private burst(tx: number, ty: number, color: string, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.particles.push({
        tx: tx + 0.5,
        ty: ty + 0.5,
        vx: Math.cos(a) * 2.6,
        vy: Math.sin(a) * 2.6,
        age: 0,
        ttl: 0.6,
        color,
        size: 6,
      });
    }
  }

  /** Warning ring pulse (Goo telegraph): one expanding ring particle set. */
  private ring(tx: number, ty: number, color: string): void {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.particles.push({
        tx: tx + 0.5,
        ty: ty + 0.5,
        vx: Math.cos(a) * 3.2,
        vy: Math.sin(a) * 3.2,
        age: 0,
        ttl: 0.5,
        color,
        size: 6,
      });
    }
  }
}
