// src/core/rng.ts
class RNG {
  s;
  seed;
  constructor(seed) {
    this.seed = seed >>> 0;
    this.s = this.seed || 2654435769;
  }
  next() {
    this.s = this.s + 1831565813 >>> 0;
    let t = this.s;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  float(min, max) {
    return min + this.next() * (max - min);
  }
  int(min, max) {
    return min + Math.floor(this.next() * Math.max(0, max - min));
  }
  intRange(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  normalIntRange(min, max) {
    const a = this.float(min, max + 1);
    const b = this.float(min, max + 1);
    return Math.floor((a + b) / 2);
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    if (arr.length === 0)
      throw new Error("RNG.pick: empty array");
    return arr[Math.floor(this.next() * arr.length)];
  }
  shuffle(arr) {
    for (let i = arr.length - 1;i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }
  serialize() {
    return this.s >>> 0;
  }
  static restore(seed, state) {
    const rng = new RNG(seed);
    rng.s = state >>> 0;
    return rng;
  }
  subSeed(salt) {
    let h = (this.seed ^ Math.imul(salt | 0, 2654435769)) >>> 0;
    h = Math.imul(h ^ h >>> 16, 569420461);
    h = Math.imul(h ^ h >>> 15, 1935289751);
    return new RNG((h ^ h >>> 15) >>> 0);
  }
}
function hashSeed(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0;i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// src/core/grid.ts
var TRAP_NAMES = {
  [20 /* TRAP_TOXIC */]: "a toxic gas trap",
  [22 /* TRAP_FIRE */]: "a fire trap",
  [24 /* TRAP_PARALYTIC */]: "a paralytic gas trap",
  [26 /* TRAP_POISON */]: "a poison dart trap",
  [28 /* TRAP_ALARM */]: "an alarm trap",
  [30 /* TRAP_LIGHTNING */]: "a lightning trap",
  [32 /* TRAP_GRIPPING */]: "a gripping trap",
  [34 /* TRAP_SUMMONING */]: "a summoning trap"
};
function isHiddenTrap(t) {
  return t === 21 /* TRAP_TOXIC_HIDDEN */ || t === 23 /* TRAP_FIRE_HIDDEN */ || t === 25 /* TRAP_PARALYTIC_HIDDEN */ || t === 27 /* TRAP_POISON_HIDDEN */ || t === 29 /* TRAP_ALARM_HIDDEN */ || t === 31 /* TRAP_LIGHTNING_HIDDEN */ || t === 33 /* TRAP_GRIPPING_HIDDEN */ || t === 35 /* TRAP_SUMMONING_HIDDEN */;
}
function revealTrapTile(t) {
  return isHiddenTrap(t) ? t - 1 : t;
}
function trapName(t) {
  return TRAP_NAMES[revealTrapTile(t)] ?? "a trap";
}
function regionForDepth(depth) {
  if (depth <= 5)
    return "sewers" /* SEWERS */;
  if (depth <= 10)
    return "prison" /* PRISON */;
  if (depth <= 15)
    return "caves" /* CAVES */;
  if (depth <= 21)
    return "city" /* CITY */;
  return "halls" /* HALLS */;
}
var REGION_LABELS = {
  ["sewers" /* SEWERS */]: "Sewers",
  ["prison" /* PRISON */]: "Prison",
  ["caves" /* CAVES */]: "Caves",
  ["city" /* CITY */]: "Metropolis",
  ["halls" /* HALLS */]: "Demon Halls"
};
var DIRS4 = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 }
];
var DIRS8 = [
  ...DIRS4,
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 }
];

class Grid {
  w;
  h;
  constructor(w, h) {
    this.w = w;
    this.h = h;
  }
  get size() {
    return this.w * this.h;
  }
  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  idx(x, y) {
    return y * this.w + x;
  }
  xy(i) {
    return { x: i % this.w, y: Math.floor(i / this.w) };
  }
  neighbors4(x, y) {
    const out = [];
    for (const d of DIRS4) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (this.inBounds(nx, ny))
        out.push({ x: nx, y: ny });
    }
    return out;
  }
  neighbors8(x, y) {
    const out = [];
    for (const d of DIRS8) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (this.inBounds(nx, ny))
        out.push({ x: nx, y: ny });
    }
    return out;
  }
  static chebyshev(ax, ay, bx, by) {
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  }
}

// src/core/fov.ts
function computeFov(grid, opaque, cx, cy, radius, out) {
  out.fill(0);
  if (!grid.inBounds(cx, cy))
    return;
  out[grid.idx(cx, cy)] = 1;
  const transforms = [
    [1, 0, 0, 1],
    [0, 1, 1, 0],
    [0, -1, 1, 0],
    [-1, 0, 0, 1],
    [-1, 0, 0, -1],
    [0, -1, -1, 0],
    [0, 1, -1, 0],
    [1, 0, 0, -1]
  ];
  for (const t of transforms) {
    castLight(grid, opaque, cx, cy, radius, 1, 1, 0, t[0], t[1], t[2], t[3], out);
  }
}
function castLight(grid, opaque, cx, cy, radius, row, startSlope, endSlope, xx, xy, yx, yy, out) {
  if (startSlope < endSlope)
    return;
  let newStart = startSlope;
  for (let j = row;j <= radius; j++) {
    let blocked = false;
    for (let dx = -j, dy = -j;dx <= 0; dx++) {
      const lSlope = (dx - 0.5) / (dy + 0.5);
      const rSlope = (dx + 0.5) / (dy - 0.5);
      if (startSlope < rSlope)
        continue;
      if (endSlope > lSlope)
        break;
      const sax = dx * xx + dy * xy;
      const say = dx * yx + dy * yy;
      const ax = cx + sax;
      const ay = cy + say;
      if (ax < 0 || ay < 0 || ax >= grid.w || ay >= grid.h)
        continue;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > radius)
        continue;
      out[grid.idx(ax, ay)] = 1;
      const isOpaque = opaque(ax, ay);
      if (blocked) {
        if (isOpaque) {
          newStart = rSlope;
          continue;
        }
        blocked = false;
        startSlope = newStart;
      } else if (isOpaque && j < radius) {
        blocked = true;
        castLight(grid, opaque, cx, cy, radius, j + 1, startSlope, lSlope, xx, xy, yx, yy, out);
        newStart = rSlope;
      }
    }
    if (blocked)
      break;
  }
}

// src/dungeon/level.ts
function newRunState() {
  return {
    weakFloor: false,
    ghostSpawned: false,
    dewVialNeeded: true,
    scrollsOfUpgrade: 0,
    wandmakerSpawned: false,
    blacksmithSpawned: false
  };
}

class Level extends Grid {
  tiles;
  explored;
  visible;
  depth = 1;
  region = "sewers" /* SEWERS */;
  get width() {
    return this.w;
  }
  get height() {
    return this.h;
  }
  stairsUp = -1;
  stairsDown = -1;
  doors = [];
  traps = [];
  blobs = [];
  items = [];
  mobs = [];
  feeling = "none" /* NONE */;
  bossLevel = false;
  sealed = false;
  bossArena = null;
  arenaDoorCell = -1;
  enteredArena = false;
  keyDropped = false;
  secretDoors = 0;
  constructor(w, h) {
    super(w, h);
    this.tiles = new Uint8Array(w * h);
    this.explored = new Uint8Array(w * h);
    this.visible = new Uint8Array(w * h);
  }
  get(x, y) {
    return this.inBounds(x, y) ? this.tiles[this.idx(x, y)] : 0 /* WALL */;
  }
  set(x, y, t) {
    if (this.inBounds(x, y))
      this.tiles[this.idx(x, y)] = t;
  }
  getAt(i) {
    return this.tiles[i];
  }
  isOpaque(x, y) {
    const t = this.get(x, y);
    return t === 0 /* WALL */ || t === 4 /* DOOR_SECRET */ || t === 39 /* HIGH_GRASS */ || t === 37 /* BARRICADE */;
  }
  isPassable(x, y) {
    const t = this.get(x, y);
    switch (t) {
      case 1 /* FLOOR */:
      case 2 /* DOOR */:
      case 40 /* OPEN_DOOR */:
      case 6 /* ENTRANCE */:
      case 7 /* EXIT */:
      case 9 /* WATER */:
      case 10 /* GRASS */:
      case 11 /* WALKWAY */:
      case 38 /* EMBERS */:
      case 39 /* HIGH_GRASS */:
      case 36 /* TRAP_INACTIVE */:
        return true;
      default:
        return isHiddenTrap(t) || t >= 20 /* TRAP_TOXIC */ && t <= 34 /* TRAP_SUMMONING */ && t % 2 === 0;
    }
  }
  revealTrap(x, y) {
    const t = this.get(x, y);
    if (!isHiddenTrap(t))
      return null;
    this.set(x, y, revealTrapTile(t));
    return trapName(t);
  }
  isAvoid(x, y) {
    const t = this.get(x, y);
    return t === 8 /* CHASM */ || t === 12 /* WELL */ || t >= 20 /* TRAP_TOXIC */ && t <= 34 /* TRAP_SUMMONING */ && t % 2 === 0 && !isHiddenTrap(t);
  }
  revealSecretDoor(x, y) {
    if (this.get(x, y) !== 4 /* DOOR_SECRET */)
      return false;
    this.set(x, y, 2 /* DOOR */);
    return true;
  }
  updateFov(cx, cy, radius) {
    computeFov(this, (x, y) => this.isOpaque(x, y), cx, cy, radius, this.visible);
    for (let i = 0;i < this.size; i++) {
      if (this.visible[i])
        this.explored[i] = 1;
    }
  }
  itemAt(x, y) {
    const i = this.idx(x, y);
    return this.items.find((it) => it.pos === i);
  }
  mobAt(x, y) {
    return this.mobs.find((m) => m.x === x && m.y === y);
  }
  exploredCount() {
    let n = 0;
    for (let i = 0;i < this.size; i++)
      n += this.explored[i];
    return n;
  }
}

// src/dungeon/rooms.ts
function upgradeDoor(door, type) {
  if (type > door.type)
    door.type = type;
}
function makeRoom(l, t, r, b) {
  return { l, t, r, b, type: 0 /* NULL */, neighbours: [], carvedTo: [], doors: [], price: 1 };
}
var roomW = (r) => r.r - r.l;
var roomH = (r) => r.b - r.t;
function randomRoomCell(rng, r, margin = 0) {
  return {
    x: rng.int(r.l + 1 + margin, r.r - margin),
    y: rng.int(r.t + 1 + margin, r.b - margin)
  };
}
var MIN_ROOM = 7;
var MAX_ROOM = 9;
var MIN_ROOMS = 8;
function buildRooms(rng) {
  const rooms = [];
  const split = (l, t, r, b) => {
    const w = r - l;
    const h = b - t;
    if (w > MAX_ROOM && h < MIN_ROOM) {
      const vw = rng.int(l + 3, r - 3);
      split(l, t, vw, b);
      split(vw, t, r, b);
    } else if (h > MAX_ROOM && w < MIN_ROOM) {
      const vh = rng.int(t + 3, b - 3);
      split(l, t, r, vh);
      split(l, vh, r, b);
    } else if (rng.float(0, 1) <= Math.floor(MIN_ROOM * MIN_ROOM / (w * h)) && w <= MAX_ROOM && h <= MAX_ROOM || w < MIN_ROOM || h < MIN_ROOM) {
      rooms.push(makeRoom(l, t, r, b));
    } else if (rng.float(0, 1) < (w - 2) / (w + h - 4)) {
      const vw = rng.int(l + 3, r - 3);
      split(l, t, vw, b);
      split(vw, t, r, b);
    } else {
      const vh = rng.int(t + 3, b - 3);
      split(l, t, r, vh);
      split(l, vh, r, b);
    }
  };
  split(0, 0, 31, 31);
  if (rooms.length < MIN_ROOMS)
    return null;
  for (let i = 0;i < rooms.length; i++) {
    for (let j = i + 1;j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      const il = Math.max(a.l, b.l);
      const it = Math.max(a.t, b.t);
      const ir = Math.min(a.r, b.r);
      const ib = Math.min(a.b, b.b);
      if (ir - il === 0 && ib - it >= 3 || ib - it === 0 && ir - il >= 3) {
        a.neighbours.push(b);
        b.neighbours.push(a);
      }
    }
  }
  return rooms;
}
function buildDistanceMap(rooms, focus) {
  const dist = new Map;
  for (const r of rooms)
    dist.set(r, Infinity);
  dist.set(focus, 0);
  const queue = [focus];
  while (queue.length > 0) {
    const node = queue.shift();
    const d = dist.get(node);
    for (const edge of node.neighbours) {
      if (dist.get(edge) > d + node.price) {
        dist.set(edge, d + node.price);
        queue.push(edge);
      }
    }
  }
  return dist;
}
function buildPath(from, to, dist) {
  const path = [];
  let room = from;
  let guard = 1e5;
  while (room !== to && guard-- > 0) {
    let min = dist.get(room);
    let next = null;
    for (const edge of room.neighbours) {
      const d = dist.get(edge);
      if (d < min) {
        min = d;
        next = edge;
      }
    }
    if (!next)
      return null;
    path.push(next);
    room = next;
  }
  return room === to ? path : null;
}
function setPrice(path, price) {
  for (const r of path)
    r.price = price;
}
function connectRooms(a, b) {
  if (a.carvedTo.includes(b))
    return;
  a.carvedTo.push(b);
  b.carvedTo.push(a);
}
function planConnections(rng, rooms, opts) {
  const minDistance = Math.floor(Math.sqrt(rooms.length));
  let entrance = null;
  let exit = null;
  for (let attempt = 0;attempt < 11; attempt++) {
    let e = null;
    for (let i = 0;i < 1000; i++) {
      const r = rng.pick(rooms);
      if (roomW(r) >= 4 && roomH(r) >= 4) {
        e = r;
        break;
      }
    }
    if (!e)
      return null;
    let x = null;
    for (let i = 0;i < 1000; i++) {
      const r = rng.pick(rooms);
      if (r !== e && roomW(r) >= opts.exitMinSize && roomH(r) >= opts.exitMinSize && (!opts.exitTopNotZero || r.t !== 0)) {
        x = r;
        break;
      }
    }
    if (!x)
      return null;
    const dist2 = buildDistanceMap(rooms, x);
    if (dist2.get(e) >= minDistance) {
      entrance = e;
      exit = x;
      break;
    }
  }
  if (!entrance || !exit)
    return null;
  entrance.type = 2 /* ENTRANCE */;
  exit.type = opts.exitType;
  const connected = new Set([entrance]);
  const carve = (path2) => {
    if (!path2)
      return;
    let room = entrance;
    for (const next of path2) {
      connectRooms(room, next);
      connected.add(next);
      room = next;
    }
  };
  let dist = buildDistanceMap(rooms, exit);
  let path = buildPath(entrance, exit, dist);
  if (!path)
    return null;
  if (opts.connectFirstPath)
    carve(path);
  setPrice(path, dist.get(entrance));
  dist = buildDistanceMap(rooms, exit);
  path = buildPath(entrance, exit, dist);
  if (!path)
    return null;
  carve(path);
  if (opts.fillRandom) {
    const nConnected = Math.floor(rooms.length * rng.float(0.5, 0.7));
    let guard = rooms.length * 20;
    while (connected.size < nConnected && guard-- > 0) {
      const cr = rng.pick([...connected]);
      if (cr.neighbours.length === 0)
        continue;
      const or = rng.pick(cr.neighbours);
      if (!connected.has(or)) {
        connectRooms(cr, or);
        connected.add(or);
      }
    }
  }
  return { entrance, exit, connected };
}
function planBossConnections(rng, rooms) {
  const minDistance = Math.floor(Math.sqrt(rooms.length));
  let entrance = null;
  let exit = null;
  for (let attempt = 0;attempt < 11; attempt++) {
    let innerRetry = 0;
    let e = null;
    while (innerRetry++ <= 10) {
      const cand = rng.pick(rooms);
      if (roomW(cand) >= 4 && roomH(cand) >= 4) {
        e = cand;
        break;
      }
    }
    if (!e)
      return null;
    innerRetry = 0;
    let x = null;
    while (innerRetry++ <= 10) {
      const cand = rng.pick(rooms);
      if (cand !== e && roomW(cand) >= 6 && roomH(cand) >= 6 && cand.t !== 0) {
        x = cand;
        break;
      }
    }
    if (!x)
      return null;
    const dist2 = buildDistanceMap(rooms, x);
    if (dist2.get(e) >= minDistance) {
      entrance = e;
      exit = x;
      break;
    }
  }
  if (!entrance || !exit)
    return null;
  entrance.type = 2 /* ENTRANCE */;
  exit.type = 4 /* BOSS_EXIT */;
  let dist = buildDistanceMap(rooms, exit);
  let path = buildPath(entrance, exit, dist);
  if (!path)
    return null;
  setPrice(path, dist.get(entrance));
  dist = buildDistanceMap(rooms, exit);
  path = buildPath(entrance, exit, dist);
  if (!path)
    return null;
  let room = entrance;
  for (const next of path) {
    connectRooms(room, next);
    room = next;
  }
  const approach = exit.carvedTo[0];
  if (!approach || exit.t === approach.b)
    return null;
  for (const r of rooms) {
    if (r.type === 0 /* NULL */ && r.carvedTo.length > 0)
      r.type = 5 /* TUNNEL */;
  }
  const rkCands = exit.neighbours.filter((r) => !exit.carvedTo.includes(r) && (exit.l === r.r || exit.r === r.l || exit.b === r.t));
  if (rkCands.length > 0) {
    const rk = rng.pick(rkCands);
    connectRooms(rk, exit);
    rk.type = 21 /* RAT_KING */;
  }
  return { entrance, exit, approach };
}
function planPrisonBossConnections(rng, rooms) {
  let entrance = null;
  let exit = null;
  for (let attempt = 0;attempt < 11; attempt++) {
    let innerRetry = 0;
    let e = null;
    while (innerRetry++ <= 10) {
      const cand = rng.pick(rooms);
      if (roomW(cand) >= 4 && roomH(cand) >= 4) {
        e = cand;
        break;
      }
    }
    if (!e)
      return null;
    innerRetry = 0;
    let x = null;
    while (innerRetry++ <= 10) {
      const cand = rng.pick(rooms);
      if (cand !== e && roomW(cand) >= 7 && roomH(cand) >= 7 && cand.t !== 0) {
        x = cand;
        break;
      }
    }
    if (!x)
      return null;
    const probe = buildPath(e, x, buildDistanceMap(rooms, x));
    if (probe && probe.length >= 2) {
      entrance = e;
      exit = x;
      break;
    }
  }
  if (!entrance || !exit)
    return null;
  entrance.type = 2 /* ENTRANCE */;
  exit.type = 4 /* BOSS_EXIT */;
  let dist = buildDistanceMap(rooms, exit);
  let path = buildPath(entrance, exit, dist);
  if (!path)
    return null;
  setPrice(path, dist.get(entrance));
  dist = buildDistanceMap(rooms, exit);
  path = buildPath(entrance, exit, dist);
  if (!path)
    return null;
  const anteroom = path[path.length - 2];
  anteroom.type = 1 /* STANDARD */;
  let room = entrance;
  for (const next of path) {
    connectRooms(room, next);
    room = next;
  }
  for (const r of rooms) {
    if (r.type === 0 /* NULL */ && r.carvedTo.length > 0)
      r.type = 6 /* PASSAGE */;
  }
  return { entrance, exit, anteroom };
}
var SPECIALS_POOL = [
  10 /* ARMORY */,
  22 /* WEAK_FLOOR */,
  16 /* MAGIC_WELL */,
  18 /* CRYPT */,
  20 /* POOL */,
  17 /* GARDEN */,
  11 /* LIBRARY */,
  9 /* TREASURY */,
  14 /* TRAPS */,
  15 /* STORAGE */,
  19 /* STATUE */,
  12 /* LABORATORY */,
  13 /* VAULT */,
  24 /* ALTAR */
];
var SPECIAL_SET = new Set(SPECIALS_POOL);
var specialsRotation = [...SPECIALS_POOL];
function resetSpecials(rng) {
  specialsRotation = [...SPECIALS_POOL];
  for (let i = 0;i < specialsRotation.length - 1; i++) {
    const j = rng.int(i, specialsRotation.length);
    if (j !== i) {
      const t = specialsRotation[i];
      specialsRotation[i] = specialsRotation[j];
      specialsRotation[j] = t;
    }
  }
}
function useSpecial(t) {
  const i = specialsRotation.indexOf(t);
  if (i >= 0) {
    specialsRotation.splice(i, 1);
    specialsRotation.push(t);
  }
}
function currentSpecials() {
  return [...specialsRotation];
}
function assignRoomTypes(rng, rooms, depth, opts) {
  const specials = currentSpecials();
  if (opts.nextIsBoss) {
    const i = specials.indexOf(22 /* WEAK_FLOOR */);
    if (i >= 0)
      specials.splice(i, 1);
  }
  const removeFromSpecials = (t) => {
    const i = specials.indexOf(t);
    if (i >= 0)
      specials.splice(i, 1);
  };
  let pitRoomNeeded = opts.prevWeakFloor;
  let weakFloorCreated = false;
  let specialRooms = 0;
  const leaves = rng.shuffle(rooms.filter((r) => r.type === 0 /* NULL */));
  for (const r of leaves) {
    if (r.type !== 0 /* NULL */ || r.carvedTo.length !== 1)
      continue;
    if (specials.length > 0 && roomW(r) > 3 && roomH(r) > 3 && rng.int(0, specialRooms * specialRooms + 2) === 0) {
      if (pitRoomNeeded) {
        r.type = 23 /* PIT */;
        pitRoomNeeded = false;
        for (const t of [
          10 /* ARMORY */,
          18 /* CRYPT */,
          12 /* LABORATORY */,
          11 /* LIBRARY */,
          19 /* STATUE */,
          9 /* TREASURY */,
          13 /* VAULT */,
          22 /* WEAK_FLOOR */
        ]) {
          removeFromSpecials(t);
        }
      } else if (depth % 5 === 2 && specials.includes(12 /* LABORATORY */)) {
        r.type = 12 /* LABORATORY */;
      } else {
        const n = specials.length;
        r.type = specials[Math.min(rng.int(0, n), rng.int(0, n))];
      }
      if (r.type === 22 /* WEAK_FLOOR */)
        weakFloorCreated = true;
      useSpecial(r.type);
      removeFromSpecials(r.type);
      specialRooms++;
    } else if (rng.int(0, 2) === 0) {
      const options = r.neighbours.filter((n) => !r.carvedTo.includes(n) && !SPECIAL_SET.has(n.type) && n.type !== 23 /* PIT */);
      if (options.length > 1) {
        connectRooms(r, rng.pick(options));
      }
    }
  }
  let count = 0;
  for (const r of rooms) {
    if (r.type !== 0 /* NULL */)
      continue;
    const connections = r.carvedTo.length;
    if (connections === 0) {} else if (rng.int(0, connections * connections) === 0) {
      r.type = 1 /* STANDARD */;
      count++;
    } else {
      r.type = 5 /* TUNNEL */;
    }
  }
  let guard = 1000;
  while (count < 4 && guard-- > 0) {
    const r = rng.pick(rooms);
    if (r.type === 5 /* TUNNEL */) {
      r.type = 1 /* STANDARD */;
      count++;
    }
  }
  if (opts.tunnelsToPassages) {
    for (const r of rooms) {
      if (r.type === 5 /* TUNNEL */)
        r.type = 6 /* PASSAGE */;
    }
  }
  return { ok: true, weakFloor: weakFloorCreated };
}
function intersectRooms(a, b) {
  const l = Math.max(a.l, b.l);
  const t = Math.max(a.t, b.t);
  const r = Math.min(a.r, b.r);
  const bb = Math.min(a.b, b.b);
  if (l > r || t > bb)
    return null;
  return { l, t, r, b: bb };
}
function placeDoor(rng, a, b) {
  if (sharedDoor(a, b))
    return sharedDoor(a, b);
  const w = intersectRooms(a, b);
  if (!w)
    return null;
  let door;
  if (w.l === w.r) {
    door = { x: w.l, y: rng.int(w.t + 1, w.b), type: 0 /* EMPTY */ };
  } else {
    door = { x: rng.int(w.l + 1, w.r), y: w.t, type: 0 /* EMPTY */ };
  }
  a.doors.push(door);
  b.doors.push(door);
  return door;
}
function sharedDoor(a, b) {
  return a.doors.find((d) => b.doors.includes(d));
}
function entranceDoor(room) {
  const n = room.carvedTo[0];
  return n ? sharedDoor(room, n) : undefined;
}
function joinRooms(a, b) {
  if (a.type !== 1 /* STANDARD */ || b.type !== 1 /* STANDARD */)
    return null;
  const w = intersectRooms(a, b);
  if (!w)
    return null;
  const cells = [];
  if (w.l === w.r) {
    if (w.b - w.t < 3)
      return null;
    if (w.b - w.t === Math.max(roomH(a), roomH(b)))
      return null;
    if (roomW(a) + roomW(b) > MAX_ROOM)
      return null;
    for (let y = w.t + 1;y < w.b; y++)
      cells.push({ x: w.l, y });
  } else {
    if (w.r - w.l < 3)
      return null;
    if (w.r - w.l === Math.max(roomW(a), roomW(b)))
      return null;
    if (roomH(a) + roomH(b) > MAX_ROOM)
      return null;
    for (let x = w.l + 1;x < w.r; x++)
      cells.push({ x, y: w.t });
  }
  return cells;
}

// src/dungeon/shopPainter.ts
function paintShopRoom(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 11 /* WALKWAY */);
  const pasWidth = roomW(room) - 2;
  const pasHeight = roomH(room) - 2;
  const per = pasWidth * 2 + pasHeight * 2;
  const stock = shopStock(ctx, ctx.depth);
  const door = entranceDoor(room);
  const entrance = door ? { x: door.x, y: door.y } : { x: Math.floor((room.l + room.r) / 2), y: room.t };
  let pos = xy2p(pasWidth, pasHeight, room, entrance) + Math.floor((per - stock.length) / 2);
  for (const tag of stock) {
    const xy = p2xy(pasWidth, pasHeight, room, ((pos + per) % per + per) % per);
    let cell = ctx.idx(xy.x, xy.y);
    if (ctx.heaps.has(cell)) {
      let guard = 4096;
      do {
        const c = randomRoomCell(ctx.rng, room, 0);
        cell = ctx.idx(c.x, c.y);
      } while (ctx.heaps.has(cell) && guard-- > 0);
    }
    ctx.out.items.push({ pos: cell, heap: "FOR_SALE", tag });
    ctx.heaps.add(cell);
    pos++;
  }
  placeShopkeeper(ctx, room);
  for (const d of room.doors)
    upgradeDoor(d, 2 /* REGULAR */);
}
function shopStock(ctx, depth) {
  const items = [];
  switch (depth) {
    case 6:
      items.push(ctx.rng.int(0, 2) === 0 ? "quarterstaff" : "spear");
      items.push("leather-armor");
      items.push("seed-pouch");
      items.push("weightstone");
      break;
    case 11:
      items.push(ctx.rng.int(0, 2) === 0 ? "sword" : "mace");
      items.push("mail-armor");
      items.push("scroll-holder");
      items.push("weightstone");
      break;
    case 16:
      items.push(ctx.rng.int(0, 2) === 0 ? "longsword" : "battle-axe");
      items.push("scale-armor");
      items.push("wand-holster");
      items.push("weightstone");
      break;
    case 21:
      switch (ctx.rng.int(0, 3)) {
        case 0:
          items.push("glaive");
          break;
        case 1:
          items.push("war-hammer");
          break;
        case 2:
          items.push("plate-armor");
          break;
      }
      items.push("torch");
      items.push("torch");
      break;
    default:
      break;
  }
  items.push("potion-of-healing");
  for (let i = 0;i < 3; i++)
    items.push("random-potion");
  items.push("scroll-of-identify");
  items.push("scroll-of-remove-curse");
  items.push("scroll-of-magic-mapping");
  items.push("random-scroll");
  items.push("overpriced-ration");
  items.push("overpriced-ration");
  items.push("ankh");
  ctx.rng.shuffle(items);
  return items;
}
function placeShopkeeper(ctx, room) {
  let pos;
  let guard = 4096;
  do {
    const c = randomRoomCell(ctx.rng, room, 0);
    pos = ctx.idx(c.x, c.y);
  } while (ctx.heaps.has(pos) && guard-- > 0);
  ctx.out.mobs.push({ pos, kind: "shopkeeper" });
  if (ctx.depth === 21) {
    const px = pos % ctx.width;
    const py = Math.floor(pos / ctx.width);
    for (let dy = -1;dy <= 1; dy++) {
      for (let dx = -1;dx <= 1; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= ctx.width || y >= ctx.height)
          continue;
        const i = ctx.idx(x, y);
        if (ctx.tiles[i] === 11 /* WALKWAY */)
          ctx.tiles[i] = 9 /* WATER */;
      }
    }
  }
}
function xy2p(pasWidth, pasHeight, room, xy) {
  if (xy.y === room.t) {
    return xy.x - room.l - 1;
  } else if (xy.x === room.r) {
    return xy.y - room.t - 1 + pasWidth;
  } else if (xy.y === room.b) {
    return room.r - xy.x - 1 + pasWidth + pasHeight;
  } else {
    if (xy.y === room.t + 1) {
      return 0;
    }
    return room.b - xy.y - 1 + pasWidth * 2 + pasHeight;
  }
}
function p2xy(pasWidth, pasHeight, room, p) {
  if (p < pasWidth) {
    return { x: room.l + 1 + p, y: room.t + 1 };
  } else if (p < pasWidth + pasHeight) {
    return { x: room.r - 1, y: room.t + 1 + (p - pasWidth) };
  } else if (p < pasWidth * 2 + pasHeight) {
    return { x: room.r - 1 - (p - (pasWidth + pasHeight)), y: room.b - 1 };
  } else {
    return { x: room.l + 1, y: room.b - 1 - (p - (pasWidth * 2 + pasHeight)) };
  }
}

// src/dungeon/painters.ts
var TRAP_ORDER = [
  "toxic",
  "fire",
  "paralytic",
  "poison",
  "alarm",
  "lightning",
  "gripping",
  "summoning"
];
function emptyOut() {
  return {
    doors: [],
    traps: [],
    items: [],
    mobs: [],
    spawnQueue: [],
    markers: { alchemy: [], wells: [], signs: [], wallDeco: [], emptyDeco: [], dryWells: [] }
  };
}

class PainterCtx {
  rng;
  width;
  height;
  depth;
  feeling;
  bossLevel;
  bossNext;
  tiles;
  out;
  heaps = new Set;
  constructor(rng, width, height, depth, feeling, bossLevel, bossNext) {
    this.rng = rng;
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.feeling = feeling;
    this.bossLevel = bossLevel;
    this.bossNext = bossNext;
    this.tiles = new Uint8Array(width * height).fill(0 /* WALL */);
    this.out = emptyOut();
  }
  idx(x, y) {
    return y * this.width + x;
  }
  x(i) {
    return i % this.width;
  }
  y(i) {
    return Math.floor(i / this.width);
  }
  set(x, y, t) {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
      this.tiles[y * this.width + x] = t;
    }
  }
  get(x, y) {
    return this.tiles[y * this.width + x];
  }
  fillRect(x, y, w, h, t) {
    for (let j = y;j < y + h; j++) {
      for (let i = x;i < x + w; i++) {
        this.set(i, j, t);
      }
    }
  }
  fillRoom(r, t) {
    this.fillRect(r.l, r.t, r.r - r.l + 1, r.b - r.t + 1, t);
  }
  fillRoomMargin(r, m, t) {
    this.fillRect(r.l + m, r.t + m, r.r - r.l + 1 - m * 2, r.b - r.t + 1 - m * 2, t);
  }
  paintDoorsRegular(r) {
    for (const d of r.doors)
      upgradeDoor(d, 2 /* REGULAR */);
  }
  drop(pos, spawn, heap = spawn.heap) {
    this.out.items.push({ pos, heap, tag: spawn.tag });
    this.heaps.add(pos);
  }
}
function randomCell(ctx, room, margin = 0) {
  return ctx.idx(ctx.rng.int(room.l + 1 + margin, room.r - margin), ctx.rng.int(room.t + 1 + margin, room.b - margin));
}
function roomCenterCell(ctx, r) {
  return {
    x: Math.floor((r.l + r.r) / 2) + (roomW(r) % 2 === 1 ? ctx.rng.int(0, 2) : 0),
    y: Math.floor((r.t + r.b) / 2) + (roomH(r) % 2 === 1 ? ctx.rng.int(0, 2) : 0)
  };
}
function drawInside(ctx, room, from, n, t) {
  let sx = 0;
  let sy = 0;
  if (from.x === room.l)
    sx = 1;
  else if (from.x === room.r)
    sx = -1;
  else if (from.y === room.t)
    sy = 1;
  else if (from.y === room.b)
    sy = -1;
  let x = from.x + sx;
  let y = from.y + sy;
  for (let i = 0;i < n; i++) {
    ctx.set(x, y, t);
    x += sx;
    y += sy;
  }
  return { x, y };
}
function takeSpawnAsPrize(ctx) {
  return null;
}
function isPotionKind(k) {
  return k.tag === "levitation" || k.tag === "invisibility" || k.tag === "liquid-flame" || k.tag === "potion-of-strength" || k.tag === "dew-vial";
}
function isScrollKind(k) {
  return k.tag === "scroll-of-upgrade" || k.tag === "scroll-of-enchantment";
}
function paintGraveyard(ctx, room) {
  const w = roomW(room);
  const h = roomH(room);
  ctx.fillRect(room.l + 1, room.t + 1, w - 1, h - 1, 10 /* GRASS */);
  const nGraves = Math.floor(Math.max(w, h) / 2);
  const index = ctx.rng.int(0, nGraves);
  const shift = ctx.rng.int(0, 2);
  for (let i = 0;i < nGraves; i++) {
    const pos = w > h ? ctx.idx(room.l + 1 + shift + i * 2, room.t + 2 + ctx.rng.int(0, h - 2)) : ctx.idx(room.l + 2 + ctx.rng.int(0, w - 2), room.t + 1 + shift + i * 2);
    ctx.drop(pos, prize(i === index ? "random" : `gold:${ctx.rng.intRange(1, 3)}`), "TOMB");
  }
}
function paintBurned(ctx, room) {
  for (let i = room.t + 1;i < room.b; i++) {
    for (let j = room.l + 1;j < room.r; j++) {
      let t = 38 /* EMBERS */;
      switch (ctx.rng.int(0, 5)) {
        case 0:
          t = 1 /* FLOOR */;
          break;
        case 1:
          t = 22 /* TRAP_FIRE */;
          break;
        case 2:
          t = 23 /* TRAP_FIRE_HIDDEN */;
          break;
        case 3:
          t = 36 /* TRAP_INACTIVE */;
          break;
      }
      ctx.set(j, i, t);
      if (t === 22 /* TRAP_FIRE */) {
        ctx.out.traps.push({ x: j, y: i, trap: 1, hidden: false });
      } else if (t === 23 /* TRAP_FIRE_HIDDEN */) {
        ctx.out.traps.push({ x: j, y: i, trap: 1, hidden: true });
      }
    }
  }
}
function paintStriped(ctx, room) {
  const w = roomW(room);
  const h = roomH(room);
  ctx.fillRect(room.l + 1, room.t + 1, w - 1, h - 1, 11 /* WALKWAY */);
  if (w > h) {
    for (let i = room.l + 2;i < room.r; i += 2) {
      ctx.fillRect(i, room.t + 1, 1, h - 1, 39 /* HIGH_GRASS */);
    }
  } else {
    for (let i = room.t + 2;i < room.b; i += 2) {
      ctx.fillRect(room.l + 1, i, w - 1, 1, 39 /* HIGH_GRASS */);
    }
  }
}
function paintStudy(ctx, room) {
  const w = roomW(room);
  const h = roomH(room);
  ctx.fillRect(room.l + 1, room.t + 1, w - 1, h - 1, 17 /* BOOKSHELF */);
  ctx.fillRect(room.l + 2, room.t + 2, w - 3, h - 3, 11 /* WALKWAY */);
  for (const door of room.doors) {
    if (door.x === room.l)
      ctx.set(door.x + 1, door.y, 1 /* FLOOR */);
    else if (door.x === room.r)
      ctx.set(door.x - 1, door.y, 1 /* FLOOR */);
    else if (door.y === room.t)
      ctx.set(door.x, door.y + 1, 1 /* FLOOR */);
    else if (door.y === room.b)
      ctx.set(door.x, door.y - 1, 1 /* FLOOR */);
  }
  const c = roomCenterCell(ctx, room);
  ctx.set(c.x, c.y, 14 /* PEDESTAL */);
}
function paintBridge(ctx, room) {
  const w = roomW(room);
  const h = roomH(room);
  const fill = !ctx.bossLevel && !ctx.bossNext && ctx.rng.int(0, 3) === 0 ? 8 /* CHASM */ : 9 /* WATER */;
  ctx.fillRect(room.l + 1, room.t + 1, w - 1, h - 1, fill);
  const door1 = room.doors[0];
  const door2 = room.doors[1];
  if (!door1 || !door2)
    return;
  const c = roomCenterCell(ctx, room);
  if (door1.x === room.l && door2.x === room.r || door1.x === room.r && door2.x === room.l) {
    const s = Math.floor(w / 2);
    drawInside(ctx, room, door1, s, 11 /* WALKWAY */);
    drawInside(ctx, room, door2, s, 11 /* WALKWAY */);
    ctx.fillRect(c.x, Math.min(door1.y, door2.y), 1, Math.abs(door1.y - door2.y) + 1, 11 /* WALKWAY */);
  } else if (door1.y === room.t && door2.y === room.b || door1.y === room.b && door2.y === room.t) {
    const s = Math.floor(h / 2);
    drawInside(ctx, room, door1, s, 11 /* WALKWAY */);
    drawInside(ctx, room, door2, s, 11 /* WALKWAY */);
    ctx.fillRect(Math.min(door1.x, door2.x), c.y, Math.abs(door1.x - door2.x) + 1, 1, 11 /* WALKWAY */);
  } else if (door1.x === door2.x) {
    ctx.fillRect(door1.x === room.l ? room.l + 1 : room.r - 1, Math.min(door1.y, door2.y), 1, Math.abs(door1.y - door2.y) + 1, 11 /* WALKWAY */);
  } else if (door1.y === door2.y) {
    ctx.fillRect(Math.min(door1.x, door2.x), door1.y === room.t ? room.t + 1 : room.b - 1, Math.abs(door1.x - door2.x) + 1, 1, 11 /* WALKWAY */);
  } else if (door1.y === room.t || door1.y === room.b) {
    drawInside(ctx, room, door1, Math.abs(door1.y - door2.y), 11 /* WALKWAY */);
    drawInside(ctx, room, door2, Math.abs(door1.x - door2.x), 11 /* WALKWAY */);
  } else if (door1.x === room.l || door1.x === room.r) {
    drawInside(ctx, room, door1, Math.abs(door1.x - door2.x), 11 /* WALKWAY */);
    drawInside(ctx, room, door2, Math.abs(door1.y - door2.y), 11 /* WALKWAY */);
  }
}
function paintFissure(ctx, room) {
  const w = roomW(room);
  const h = roomH(room);
  ctx.fillRect(room.l + 1, room.t + 1, w - 1, h - 1, 1 /* FLOOR */);
  for (let i = room.t + 2;i < room.b - 1; i++) {
    for (let j = room.l + 2;j < room.r - 1; j++) {
      const v = Math.min(i - room.t, room.b - i);
      const hh = Math.min(j - room.l, room.r - j);
      if (Math.min(v, hh) > 2 || ctx.rng.int(0, 2) === 0) {
        ctx.set(j, i, 8 /* CHASM */);
      }
    }
  }
}
function paintStandard(ctx, room) {
  const w = roomW(room);
  const h = roomH(room);
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.paintDoorsRegular(room);
  if (!ctx.bossLevel && ctx.rng.int(0, 5) === 0) {
    switch (ctx.rng.int(0, 6)) {
      case 0:
        if (ctx.feeling !== "grass") {
          if (Math.min(w, h) >= 4 && Math.max(w, h) >= 6) {
            paintGraveyard(ctx, room);
            return;
          }
          break;
        }
      case 1:
        if (ctx.depth > 1) {
          paintBurned(ctx, room);
          return;
        }
        break;
      case 2:
        if (Math.max(w, h) >= 4) {
          paintStriped(ctx, room);
          return;
        }
        break;
      case 3:
        if (w >= 6 && h >= 6) {
          paintStudy(ctx, room);
          return;
        }
        break;
      case 4:
        if (ctx.feeling !== "water") {
          if (room.doors.length === 2 && w >= 4 && h >= 4) {
            paintBridge(ctx, room);
            return;
          }
          break;
        }
      case 5:
        if (!ctx.bossLevel && !ctx.bossNext && Math.min(w, h) >= 5) {
          paintFissure(ctx, room);
          return;
        }
        break;
    }
  }
  ctx.fillRoomMargin(room, 1, 1 /* FLOOR */);
}
function paintTunnel(ctx, room) {
  const w = roomW(room);
  const h = roomH(room);
  const floor = ctx.feeling === "chasm" ? 11 /* WALKWAY */ : 1 /* FLOOR */;
  const c = roomCenterCell(ctx, room);
  if (w > h || w === h && ctx.rng.int(0, 2) === 0) {
    let from = room.r - 1;
    let to = room.l + 1;
    for (const door of room.doors) {
      const step = door.y < c.y ? 1 : -1;
      if (door.x === room.l) {
        from = room.l + 1;
        for (let i = door.y;i !== c.y; i += step)
          ctx.set(from, i, floor);
      } else if (door.x === room.r) {
        to = room.r - 1;
        for (let i = door.y;i !== c.y; i += step)
          ctx.set(to, i, floor);
      } else {
        if (door.x < from)
          from = door.x;
        if (door.x > to)
          to = door.x;
        for (let i = door.y + step;i !== c.y; i += step)
          ctx.set(door.x, i, floor);
      }
    }
    for (let i = from;i <= to; i++)
      ctx.set(i, c.y, floor);
  } else {
    let from = room.b - 1;
    let to = room.t + 1;
    for (const door of room.doors) {
      const step = door.x < c.x ? 1 : -1;
      if (door.y === room.t) {
        from = room.t + 1;
        for (let i = door.x;i !== c.x; i += step)
          ctx.set(i, from, floor);
      } else if (door.y === room.b) {
        to = room.b - 1;
        for (let i = door.x;i !== c.x; i += step)
          ctx.set(i, to, floor);
      } else {
        if (door.y < from)
          from = door.y;
        if (door.y > to)
          to = door.y;
        for (let i = door.x + step;i !== c.x; i += step)
          ctx.set(i, door.y, floor);
      }
    }
    for (let i = from;i <= to; i++)
      ctx.set(c.x, i, floor);
  }
  for (const door of room.doors)
    upgradeDoor(door, 1 /* TUNNEL */);
}
function paintPassage(ctx, room) {
  const pasWidth = roomW(room) - 2;
  const pasHeight = roomH(room) - 2;
  const floor = ctx.feeling === "chasm" ? 11 /* WALKWAY */ : 1 /* FLOOR */;
  const xy2p2 = (x, y) => {
    if (y === room.t) {
      return x - room.l - 1;
    } else if (x === room.r) {
      return y - room.t - 1 + pasWidth;
    } else if (y === room.b) {
      return room.r - x - 1 + pasWidth + pasHeight;
    } else {
      if (y === room.t + 1) {
        return 0;
      }
      return room.b - y - 1 + pasWidth * 2 + pasHeight;
    }
  };
  const p2xy2 = (p2) => {
    if (p2 < pasWidth) {
      return { x: room.l + 1 + p2, y: room.t + 1 };
    } else if (p2 < pasWidth + pasHeight) {
      return { x: room.r - 1, y: room.t + 1 + (p2 - pasWidth) };
    } else if (p2 < pasWidth * 2 + pasHeight) {
      return { x: room.r - 1 - (p2 - (pasWidth + pasHeight)), y: room.b - 1 };
    } else {
      return { x: room.l + 1, y: room.b - 1 - (p2 - (pasWidth * 2 + pasHeight)) };
    }
  };
  const joints = [];
  for (const door of room.doors)
    joints.push(xy2p2(door.x, door.y));
  joints.sort((a, b) => a - b);
  const nJoints = joints.length;
  const perimeter = pasWidth * 2 + pasHeight * 2;
  if (nJoints === 0) {
    ctx.fillRoomMargin(room, 1, floor);
    return;
  }
  let start = 0;
  let maxD = joints[0] + perimeter - joints[nJoints - 1];
  for (let i = 1;i < nJoints; i++) {
    const d = joints[i] - joints[i - 1];
    if (d > maxD) {
      maxD = d;
      start = i;
    }
  }
  const end = (start + nJoints - 1) % nJoints;
  let p = joints[start];
  do {
    const c2 = p2xy2(p);
    ctx.set(c2.x, c2.y, floor);
    p = (p + 1) % perimeter;
  } while (p !== joints[end]);
  const c = p2xy2(p);
  ctx.set(c.x, c.y, floor);
  for (const door of room.doors)
    upgradeDoor(door, 1 /* TUNNEL */);
}
function paintEntrance(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 1 /* FLOOR */);
  ctx.paintDoorsRegular(room);
  const entrance = randomCell(ctx, room, 1);
  ctx.tiles[entrance] = 6 /* ENTRANCE */;
  return entrance;
}
function paintExit(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 1 /* FLOOR */);
  ctx.paintDoorsRegular(room);
  const exit = randomCell(ctx, room, 1);
  ctx.tiles[exit] = 7 /* EXIT */;
  return exit;
}
function paintBossExit(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 1 /* FLOOR */);
  ctx.paintDoorsRegular(room);
  const exit = room.t * ctx.width + Math.floor((room.l + room.r) / 2);
  ctx.tiles[exit] = 5 /* EXIT_LOCKED */;
  return exit;
}
var prize = (tag) => ({ tag, heap: "HEAP" });
function armoryPrize(ctx) {
  if (ctx.rng.int(0, 6) === 0)
    return prize("prize-bomb");
  return prize(ctx.rng.pick(["prize-armor", "prize-weapon"]));
}
function genericPrize(ctx, categories) {
  const p = takeSpawnAsPrize(ctx);
  if (p)
    return p;
  return prize(ctx.rng.pick(categories));
}
function labPrize(ctx) {
  const p = takeSpawnAsPrize(ctx);
  if (p && isPotionKind(p))
    return p;
  if (p)
    ctx.out.spawnQueue.push(p);
  return prize("prize-potion");
}
function libraryPrize(ctx) {
  const p = takeSpawnAsPrize(ctx);
  if (p && isScrollKind(p))
    return p;
  if (p)
    ctx.out.spawnQueue.push(p);
  return prize("prize-scroll");
}
function farCorner(ctx, room, door) {
  if (door.x === room.l) {
    return { x: room.r - 1, y: ctx.rng.int(0, 2) === 0 ? room.t + 1 : room.b - 1 };
  } else if (door.x === room.r) {
    return { x: room.l + 1, y: ctx.rng.int(0, 2) === 0 ? room.t + 1 : room.b - 1 };
  } else if (door.y === room.t) {
    return { x: ctx.rng.int(0, 2) === 0 ? room.l + 1 : room.r - 1, y: room.b - 1 };
  }
  return { x: ctx.rng.int(0, 2) === 0 ? room.l + 1 : room.r - 1, y: room.t + 1 };
}
function paintArmory(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 1 /* FLOOR */);
  const entrance = entranceDoor(room);
  if (entrance) {
    const s = farCorner(ctx, room, entrance);
    ctx.set(s.x, s.y, 15 /* STATUE */);
  }
  const n = 3 + (ctx.rng.int(0, 4) === 0 ? 1 : 0);
  for (let i = 0;i < n; i++) {
    let pos = randomCell(ctx, room);
    let guard = 1000;
    while ((ctx.tiles[pos] !== 1 /* FLOOR */ || ctx.heaps.has(pos)) && guard-- > 0) {
      pos = randomCell(ctx, room);
    }
    ctx.drop(pos, armoryPrize(ctx));
  }
  if (entrance)
    upgradeDoor(entrance, 6 /* LOCKED */);
  ctx.out.spawnQueue.push(prize("iron-key"));
}
function paintCrypt(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 1 /* FLOOR */);
  const c = roomCenterCell(ctx, room);
  let cx = c.x;
  let cy = c.y;
  const entrance = entranceDoor(room);
  if (entrance) {
    upgradeDoor(entrance, 6 /* LOCKED */);
    ctx.out.spawnQueue.push(prize("iron-key"));
    if (entrance.x === room.l) {
      ctx.set(room.r - 1, room.t + 1, 15 /* STATUE */);
      ctx.set(room.r - 1, room.b - 1, 15 /* STATUE */);
      cx = room.r - 2;
    } else if (entrance.x === room.r) {
      ctx.set(room.l + 1, room.t + 1, 15 /* STATUE */);
      ctx.set(room.l + 1, room.b - 1, 15 /* STATUE */);
      cx = room.l + 2;
    } else if (entrance.y === room.t) {
      ctx.set(room.l + 1, room.b - 1, 15 /* STATUE */);
      ctx.set(room.r - 1, room.b - 1, 15 /* STATUE */);
      cy = room.b - 2;
    } else if (entrance.y === room.b) {
      ctx.set(room.l + 1, room.t + 1, 15 /* STATUE */);
      ctx.set(room.r - 1, room.t + 1, 15 /* STATUE */);
      cy = room.t + 2;
    }
  }
  ctx.drop(ctx.idx(cx, cy), prize("prize-armor"), "TOMB");
}
function paintLibrary(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 1 /* FLOOR */);
  const entrance = entranceDoor(room);
  let a = null;
  let b = null;
  if (entrance) {
    const h = roomH(room);
    const w = roomW(room);
    if (entrance.x === room.l) {
      a = { x: room.l + 1, y: entrance.y - 1 };
      b = { x: room.l + 1, y: entrance.y + 1 };
      ctx.fillRect(room.r - 1, room.t + 1, 1, h - 1, 17 /* BOOKSHELF */);
    } else if (entrance.x === room.r) {
      a = { x: room.r - 1, y: entrance.y - 1 };
      b = { x: room.r - 1, y: entrance.y + 1 };
      ctx.fillRect(room.l + 1, room.t + 1, 1, h - 1, 17 /* BOOKSHELF */);
    } else if (entrance.y === room.t) {
      a = { x: entrance.x + 1, y: room.t + 1 };
      b = { x: entrance.x - 1, y: room.t + 1 };
      ctx.fillRect(room.l + 1, room.b - 1, w - 1, 1, 17 /* BOOKSHELF */);
    } else if (entrance.y === room.b) {
      a = { x: entrance.x + 1, y: room.b - 1 };
      b = { x: entrance.x - 1, y: room.b - 1 };
      ctx.fillRect(room.l + 1, room.t + 1, w - 1, 1, 17 /* BOOKSHELF */);
    }
  }
  if (a && ctx.tiles[ctx.idx(a.x, a.y)] === 1 /* FLOOR */)
    ctx.set(a.x, a.y, 15 /* STATUE */);
  if (b && ctx.tiles[ctx.idx(b.x, b.y)] === 1 /* FLOOR */)
    ctx.set(b.x, b.y, 15 /* STATUE */);
  const n = ctx.rng.intRange(2, 3);
  for (let i = 0;i < n; i++) {
    let pos = randomCell(ctx, room);
    let guard = 1000;
    while ((ctx.tiles[pos] !== 1 /* FLOOR */ || ctx.heaps.has(pos)) && guard-- > 0) {
      pos = randomCell(ctx, room);
    }
    ctx.drop(pos, libraryPrize(ctx));
  }
  if (entrance)
    upgradeDoor(entrance, 6 /* LOCKED */);
  ctx.out.spawnQueue.push(prize("iron-key"));
}
function paintLaboratory(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 11 /* WALKWAY */);
  const entrance = entranceDoor(room);
  if (entrance) {
    const pot = farCorner(ctx, room, entrance);
    ctx.set(pot.x, pot.y, 13 /* ALCHEMY */);
    ctx.out.markers.alchemy.push(ctx.idx(pot.x, pot.y));
  }
  const n = ctx.rng.intRange(2, 3);
  for (let i = 0;i < n; i++) {
    let pos = randomCell(ctx, room);
    let guard = 1000;
    while ((ctx.tiles[pos] !== 11 /* WALKWAY */ || ctx.heaps.has(pos)) && guard-- > 0) {
      pos = randomCell(ctx, room);
    }
    ctx.drop(pos, labPrize(ctx));
  }
  if (entrance)
    upgradeDoor(entrance, 6 /* LOCKED */);
  ctx.out.spawnQueue.push(prize("iron-key"));
}
function paintMagicWell(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 1 /* FLOOR */);
  const c = roomCenterCell(ctx, room);
  ctx.set(c.x, c.y, 12 /* WELL */);
  const kind = ctx.rng.pick(["awareness", "health", "transmutation"]);
  ctx.out.markers.wells.push({ cell: ctx.idx(c.x, c.y), kind });
  const entrance = entranceDoor(room);
  if (entrance)
    upgradeDoor(entrance, 2 /* REGULAR */);
}
function paintGarden(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 39 /* HIGH_GRASS */);
  ctx.fillRoomMargin(room, 2, 10 /* GRASS */);
  const entrance = entranceDoor(room);
  if (entrance)
    upgradeDoor(entrance, 2 /* REGULAR */);
  if (ctx.rng.int(0, 2) === 0) {
    ctx.drop(randomCell(ctx, room), prize("honeypot"));
  } else {
    const bushes = ctx.rng.int(0, 5) === 0 ? 2 : 1;
    for (let i = 0;i < bushes; i++) {
      const pos = randomCell(ctx, room);
      ctx.tiles[pos] = 10 /* GRASS */;
      ctx.drop(pos, prize("sungrass-seed"));
    }
  }
}
var NPIRANHAS = 3;
function paintPool(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 9 /* WATER */);
  const door = entranceDoor(room);
  if (door)
    upgradeDoor(door, 2 /* REGULAR */);
  let x = -1;
  let y = -1;
  if (door) {
    if (door.x === room.l) {
      x = room.r - 1;
      y = room.t + Math.floor(roomH(room) / 2);
    } else if (door.x === room.r) {
      x = room.l + 1;
      y = room.t + Math.floor(roomH(room) / 2);
    } else if (door.y === room.t) {
      x = room.l + Math.floor(roomW(room) / 2);
      y = room.b - 1;
    } else if (door.y === room.b) {
      x = room.l + Math.floor(roomW(room) / 2);
      y = room.t + 1;
    }
  }
  if (x >= 0) {
    const pos = ctx.idx(x, y);
    ctx.drop(pos, genericPrize(ctx, ["prize-weapon", "prize-armor", "prize-wand", "prize-ring"]), ctx.rng.int(0, 3) === 0 ? "CHEST" : "HEAP");
    ctx.set(x, y, 14 /* PEDESTAL */);
  }
  ctx.out.spawnQueue.push(prize("invisibility"));
  const occupied = new Set;
  for (let i = 0;i < NPIRANHAS; i++) {
    let pos = randomCell(ctx, room);
    let guard = 1000;
    while ((ctx.tiles[pos] !== 9 /* WATER */ || occupied.has(pos)) && guard-- > 0) {
      pos = randomCell(ctx, room);
    }
    occupied.add(pos);
    ctx.out.mobs.push({ pos, kind: "piranha" });
  }
}
function paintStatueRoom(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 1 /* FLOOR */);
  const c = roomCenterCell(ctx, room);
  let cx = c.x;
  let cy = c.y;
  const door = entranceDoor(room);
  if (door) {
    upgradeDoor(door, 6 /* LOCKED */);
    ctx.out.spawnQueue.push(prize("iron-key"));
    const w = roomW(room);
    const h = roomH(room);
    if (door.x === room.l) {
      ctx.fillRect(room.r - 1, room.t + 1, 1, h - 1, 15 /* STATUE */);
      cx = room.r - 2;
    } else if (door.x === room.r) {
      ctx.fillRect(room.l + 1, room.t + 1, 1, h - 1, 15 /* STATUE */);
      cx = room.l + 2;
    } else if (door.y === room.t) {
      ctx.fillRect(room.l + 1, room.b - 1, w - 1, 1, 15 /* STATUE */);
      cy = room.b - 2;
    } else if (door.y === room.b) {
      ctx.fillRect(room.l + 1, room.t + 1, w - 1, 1, 15 /* STATUE */);
      cy = room.t + 2;
    }
  }
  ctx.out.mobs.push({ pos: ctx.idx(cx, cy), kind: "statue" });
}
function paintTreasury(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 1 /* FLOOR */);
  const c = roomCenterCell(ctx, room);
  ctx.set(c.x, c.y, 15 /* STATUE */);
  const heapType = ctx.rng.int(0, 2) === 0 ? "CHEST" : "HEAP";
  const n = ctx.rng.intRange(2, 3);
  for (let i = 0;i < n; i++) {
    let pos = randomCell(ctx, room);
    let guard = 1000;
    while ((ctx.tiles[pos] !== 1 /* FLOOR */ || ctx.heaps.has(pos)) && guard-- > 0) {
      pos = randomCell(ctx, room);
    }
    ctx.drop(pos, prize(`gold:${ctx.rng.intRange(20 + ctx.depth * 10, 40 + ctx.depth * 20)}`), i === 0 && heapType === "CHEST" ? "MIMIC" : heapType);
  }
  if (heapType === "HEAP") {
    for (let i = 0;i < 6; i++) {
      let pos = randomCell(ctx, room);
      let guard = 1000;
      while (ctx.tiles[pos] !== 1 /* FLOOR */ && guard-- > 0) {
        pos = randomCell(ctx, room);
      }
      ctx.drop(pos, prize(`gold:${ctx.rng.intRange(1, 3)}`));
    }
  }
  const entrance = entranceDoor(room);
  if (entrance)
    upgradeDoor(entrance, 6 /* LOCKED */);
  ctx.out.spawnQueue.push(prize("iron-key"));
}
function paintTrapsRoom(ctx, room) {
  const traps = [
    20 /* TRAP_TOXIC */,
    20 /* TRAP_TOXIC */,
    20 /* TRAP_TOXIC */,
    24 /* TRAP_PARALYTIC */,
    24 /* TRAP_PARALYTIC */,
    ctx.bossNext ? 34 /* TRAP_SUMMONING */ : 8 /* CHASM */
  ];
  ctx.fillRoom(room, 0 /* WALL */);
  const trapTile = ctx.rng.pick(traps);
  ctx.fillRoomMargin(room, 1, trapTile);
  if (trapTile !== 8 /* CHASM */) {
    const trapIndex = TRAP_ORDER.indexOf(trapTile === 20 /* TRAP_TOXIC */ ? "toxic" : trapTile === 24 /* TRAP_PARALYTIC */ ? "paralytic" : "summoning");
    for (let j = room.t + 1;j < room.b; j++) {
      for (let i = room.l + 1;i < room.r; i++) {
        ctx.out.traps.push({ x: i, y: j, trap: trapIndex, hidden: false });
      }
    }
  }
  const door = entranceDoor(room);
  if (door)
    upgradeDoor(door, 2 /* REGULAR */);
  const lastRow = ctx.tiles[ctx.idx(room.l + 1, room.t + 1)] === 8 /* CHASM */ ? 8 /* CHASM */ : 1 /* FLOOR */;
  let x = -1;
  let y = -1;
  if (door) {
    const h = roomH(room);
    const w = roomW(room);
    if (door.x === room.l) {
      x = room.r - 1;
      y = room.t + Math.floor(h / 2);
      ctx.fillRect(x, room.t + 1, 1, h - 1, lastRow);
    } else if (door.x === room.r) {
      x = room.l + 1;
      y = room.t + Math.floor(h / 2);
      ctx.fillRect(x, room.t + 1, 1, h - 1, lastRow);
    } else if (door.y === room.t) {
      x = room.l + Math.floor(w / 2);
      y = room.b - 1;
      ctx.fillRect(room.l + 1, y, w - 1, 1, lastRow);
    } else if (door.y === room.b) {
      x = room.l + Math.floor(w / 2);
      y = room.t + 1;
      ctx.fillRect(room.l + 1, y, w - 1, 1, lastRow);
    }
  }
  if (x >= 0) {
    const pos = ctx.idx(x, y);
    const kind = genericPrize(ctx, ["prize-weapon", "prize-armor", "prize-wand"]);
    if (ctx.rng.int(0, 3) === 0) {
      if (lastRow === 8 /* CHASM */)
        ctx.set(x, y, 1 /* FLOOR */);
      ctx.drop(pos, kind, "CHEST");
    } else {
      ctx.set(x, y, 14 /* PEDESTAL */);
      ctx.drop(pos, kind);
    }
  }
  ctx.out.spawnQueue.push(prize("levitation"));
}
function paintStorage(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 11 /* WALKWAY */);
  const n = ctx.rng.intRange(3, 4);
  for (let i = 0;i < n; i++) {
    let pos = randomCell(ctx, room);
    let guard = 1000;
    while (ctx.tiles[pos] !== 11 /* WALKWAY */ && guard-- > 0) {
      pos = randomCell(ctx, room);
    }
    ctx.drop(pos, genericPrize(ctx, ["prize-potion", "prize-scroll", "prize-food"]));
  }
  const entrance = entranceDoor(room);
  if (entrance)
    upgradeDoor(entrance, 5 /* BARRICADE */);
  ctx.out.spawnQueue.push(prize("liquid-flame"));
}
function paintVault(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 11 /* WALKWAY */);
  ctx.fillRoomMargin(room, 2, 1 /* FLOOR */);
  const cx = Math.floor((room.l + room.r) / 2);
  const cy = Math.floor((room.t + room.b) / 2);
  const c = ctx.idx(cx, cy);
  const vaultPrize = () => genericPrize(ctx, ["prize-wand", "prize-ring"]);
  switch (ctx.rng.int(0, 3)) {
    case 0:
      ctx.drop(c, vaultPrize(), "LOCKED_CHEST");
      ctx.out.spawnQueue.push(prize("golden-key"));
      break;
    case 1: {
      const i1 = vaultPrize();
      const i2 = vaultPrize();
      ctx.drop(c, i1, "CRYSTAL_CHEST");
      const n = ctx.rng.int(0, 8);
      const dx = [-1, 0, 1, -1, 1, -1, 0, 1][n];
      const dy = [-1, -1, -1, 0, 0, 1, 1, 1][n];
      ctx.drop(ctx.idx(cx + dx, cy + dy), i2, "CRYSTAL_CHEST");
      ctx.out.spawnQueue.push(prize("golden-key"));
      break;
    }
    default:
      ctx.drop(c, vaultPrize());
      ctx.set(cx, cy, 14 /* PEDESTAL */);
      break;
  }
  const entrance = entranceDoor(room);
  if (entrance)
    upgradeDoor(entrance, 6 /* LOCKED */);
  ctx.out.spawnQueue.push(prize("iron-key"));
}
function paintAltar(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, ctx.bossNext ? 39 /* HIGH_GRASS */ : 8 /* CHASM */);
  const c = roomCenterCell(ctx, room);
  const door = entranceDoor(room);
  if (door) {
    if (door.x === room.l || door.x === room.r) {
      const p = drawInside(ctx, room, door, Math.abs(door.x - c.x) - 2, 11 /* WALKWAY */);
      for (;p.y !== c.y; p.y += p.y < c.y ? 1 : -1)
        ctx.set(p.x, p.y, 11 /* WALKWAY */);
    } else {
      const p = drawInside(ctx, room, door, Math.abs(door.y - c.y) - 2, 11 /* WALKWAY */);
      for (;p.x !== c.x; p.x += p.x < c.x ? 1 : -1)
        ctx.set(p.x, p.y, 11 /* WALKWAY */);
    }
  }
  ctx.fillRect(c.x - 1, c.y - 1, 3, 3, 38 /* EMBERS */);
  ctx.set(c.x, c.y, 14 /* PEDESTAL */);
  if (door)
    upgradeDoor(door, 0 /* EMPTY */);
}
function paintWeakFloor(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 8 /* CHASM */);
  const door = entranceDoor(room);
  if (door)
    upgradeDoor(door, 2 /* REGULAR */);
  if (!door)
    return;
  const w = roomW(room);
  const h = roomH(room);
  if (door.x === room.l) {
    for (let i = room.t + 1;i < room.b; i++) {
      drawInside(ctx, room, { x: room.l, y: i }, ctx.rng.intRange(1, w - 2), 11 /* WALKWAY */);
    }
  } else if (door.x === room.r) {
    for (let i = room.t + 1;i < room.b; i++) {
      drawInside(ctx, room, { x: room.r, y: i }, ctx.rng.intRange(1, w - 2), 11 /* WALKWAY */);
    }
  } else if (door.y === room.t) {
    for (let i = room.l + 1;i < room.r; i++) {
      drawInside(ctx, room, { x: i, y: room.t }, ctx.rng.intRange(1, h - 2), 11 /* WALKWAY */);
    }
  } else if (door.y === room.b) {
    for (let i = room.l + 1;i < room.r; i++) {
      drawInside(ctx, room, { x: i, y: room.b }, ctx.rng.intRange(1, h - 2), 11 /* WALKWAY */);
    }
  }
}
function paintPit(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 1 /* FLOOR */);
  const entrance = entranceDoor(room);
  if (entrance)
    upgradeDoor(entrance, 6 /* LOCKED */);
  if (entrance) {
    const well = farCorner(ctx, room, entrance);
    ctx.set(well.x, well.y, 1 /* FLOOR */);
    ctx.out.markers.dryWells.push(ctx.idx(well.x, well.y));
  }
  const dry = new Set(ctx.out.markers.dryWells);
  let remains = randomCell(ctx, room);
  let guard = 1000;
  while (dry.has(remains) && guard-- > 0)
    remains = randomCell(ctx, room);
  ctx.drop(remains, prize("iron-key"), "SKELETON");
  const ringOrWeapon = ctx.rng.int(0, 5) === 0 ? "prize-ring" : ctx.rng.pick(["prize-weapon", "prize-armor"]);
  ctx.drop(remains, prize(ringOrWeapon));
  const n = ctx.rng.intRange(1, 2);
  for (let i = 0;i < n; i++) {
    ctx.drop(remains, genericPrize(ctx, ["prize-potion", "prize-scroll"]));
  }
}
function paintRatKing(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 11 /* WALKWAY */);
  const entrance = entranceDoor(room);
  if (entrance)
    upgradeDoor(entrance, 4 /* HIDDEN */);
  const doorCell = entrance ? ctx.idx(entrance.x, entrance.y) : -1;
  const W = ctx.width;
  const addChest = (pos) => {
    if (pos === doorCell - 1 || pos === doorCell + 1 || pos === doorCell - W || pos === doorCell + W) {
      return;
    }
    const r = ctx.rng.int(0, 10);
    const kind = r === 0 ? prize("prize-weapon") : r === 1 ? prize("prize-armor") : prize(`gold:${ctx.rng.intRange(1, 5)}`);
    ctx.drop(pos, kind, "CHEST");
  };
  const before = ctx.out.items.length;
  for (let i = room.l + 1;i < room.r; i++) {
    addChest(ctx.idx(i, room.t + 1));
    addChest(ctx.idx(i, room.b - 1));
  }
  for (let i = room.t + 2;i < room.b - 1; i++) {
    addChest(ctx.idx(room.l + 1, i));
    addChest(ctx.idx(room.r - 1, i));
  }
  const chests = ctx.out.items.slice(before);
  if (chests.length > 0) {
    ctx.rng.pick(chests).heap = "MIMIC";
  }
  const king = randomCell(ctx, room, 1);
  ctx.out.mobs.push({ pos: king, kind: "ratking" });
}
function paintRooms(ctx, rooms) {
  let entrance = -1;
  let exit = -1;
  const ordered = [...rooms].sort((a, b) => a.t - b.t || a.l - b.l);
  for (const room of ordered) {
    if (room.type === 0 /* NULL */) {
      if (ctx.feeling === "chasm" && ctx.rng.int(0, 2) === 0) {
        ctx.fillRoom(room, 0 /* WALL */);
      }
      continue;
    }
    for (const n of room.carvedTo)
      placeDoor(ctx.rng, room, n);
    switch (room.type) {
      case 1 /* STANDARD */:
        paintStandard(ctx, room);
        break;
      case 5 /* TUNNEL */:
        paintTunnel(ctx, room);
        break;
      case 6 /* PASSAGE */:
        paintPassage(ctx, room);
        break;
      case 7 /* SHOP */:
        paintShopRoom(ctx, room);
        break;
      case 2 /* ENTRANCE */:
        entrance = paintEntrance(ctx, room);
        break;
      case 3 /* EXIT */:
        exit = paintExit(ctx, room);
        break;
      case 4 /* BOSS_EXIT */:
        exit = paintBossExit(ctx, room);
        break;
      case 10 /* ARMORY */:
        paintArmory(ctx, room);
        break;
      case 16 /* MAGIC_WELL */:
        paintMagicWell(ctx, room);
        break;
      case 18 /* CRYPT */:
        paintCrypt(ctx, room);
        break;
      case 20 /* POOL */:
        paintPool(ctx, room);
        break;
      case 17 /* GARDEN */:
        paintGarden(ctx, room);
        break;
      case 11 /* LIBRARY */:
        paintLibrary(ctx, room);
        break;
      case 9 /* TREASURY */:
        paintTreasury(ctx, room);
        break;
      case 14 /* TRAPS */:
        paintTrapsRoom(ctx, room);
        break;
      case 15 /* STORAGE */:
        paintStorage(ctx, room);
        break;
      case 19 /* STATUE */:
        paintStatueRoom(ctx, room);
        break;
      case 12 /* LABORATORY */:
        paintLaboratory(ctx, room);
        break;
      case 13 /* VAULT */:
        paintVault(ctx, room);
        break;
      case 24 /* ALTAR */:
        paintAltar(ctx, room);
        break;
      case 22 /* WEAK_FLOOR */:
        paintWeakFloor(ctx, room);
        break;
      case 23 /* PIT */:
        paintPit(ctx, room);
        break;
      case 21 /* RAT_KING */:
        paintRatKing(ctx, room);
        break;
      case 8 /* BLACKSMITH */:
        paintBlacksmith(ctx, room);
        break;
      default:
        ctx.fillRoomMargin(room, 1, 1 /* FLOOR */);
        break;
    }
  }
  return { entrance, exit };
}
function generatePatch(rng, fillRate, cleanPasses, w, h) {
  const size = w * h;
  let off = new Array(size);
  for (let i = 0;i < size; i++)
    off[i] = rng.float(0, 1) < fillRate;
  for (let p = 0;p < cleanPasses; p++) {
    const cur = new Array(size).fill(false);
    for (let y = 1;y < h - 1; y++) {
      for (let x = 1;x < w - 1; x++) {
        const pos = x + y * w;
        let count = 0;
        if (off[pos - w - 1])
          count++;
        if (off[pos - w])
          count++;
        if (off[pos - w + 1])
          count++;
        if (off[pos - 1])
          count++;
        if (off[pos + 1])
          count++;
        if (off[pos + w - 1])
          count++;
        if (off[pos + w])
          count++;
        if (off[pos + w + 1])
          count++;
        cur[pos] = !off[pos] ? count >= 5 : count >= 4;
      }
    }
    off = cur;
  }
  return off;
}
function paintWaterGrass(ctx, rooms, waterFill, grassFill, waterPasses = 5, grassPasses = 4) {
  const W = ctx.width;
  const H = ctx.height;
  const water = generatePatch(ctx.rng, waterFill ?? (ctx.feeling === "water" ? 0.6 : 0.45), waterPasses, W, H);
  for (let i = 0;i < W * H; i++) {
    if (ctx.tiles[i] === 1 /* FLOOR */ && water[i])
      ctx.tiles[i] = 9 /* WATER */;
  }
  const grass = generatePatch(ctx.rng, grassFill ?? (ctx.feeling === "grass" ? 0.6 : 0.4), grassPasses, W, H);
  if (ctx.feeling === "grass") {
    for (const room of rooms) {
      if (room.type !== 0 /* NULL */ && room.type !== 6 /* PASSAGE */ && room.type !== 5 /* TUNNEL */) {
        grass[ctx.idx(room.l + 1, room.t + 1)] = true;
        grass[ctx.idx(room.r - 1, room.t + 1)] = true;
        grass[ctx.idx(room.l + 1, room.b - 1)] = true;
        grass[ctx.idx(room.r - 1, room.b - 1)] = true;
      }
    }
  }
  for (let i = W + 1;i < W * H - W - 1; i++) {
    if (ctx.tiles[i] === 1 /* FLOOR */ && grass[i]) {
      let count = 1;
      const x = i % W;
      const y = Math.floor(i / W);
      for (let dy = -1;dy <= 1; dy++) {
        for (let dx = -1;dx <= 1; dx++) {
          if (dx === 0 && dy === 0)
            continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H && grass[ny * W + nx])
            count++;
        }
      }
      ctx.tiles[i] = ctx.rng.float(0, 1) < count / 12 ? 39 /* HIGH_GRASS */ : 10 /* GRASS */;
    }
  }
}
function paintDoorTiles(ctx, rooms) {
  let secretDoors = 0;
  const seen = new Set;
  const tileFor = (d) => {
    switch (d.type) {
      case 0 /* EMPTY */:
        return 1 /* FLOOR */;
      case 1 /* TUNNEL */:
        return ctx.feeling === "chasm" ? 11 /* WALKWAY */ : 1 /* FLOOR */;
      case 2 /* REGULAR */:
        if (ctx.depth <= 1)
          return 2 /* DOOR */;
        if (ctx.rng.int(0, ctx.depth < 6 ? 12 - ctx.depth : 6) === 0) {
          secretDoors++;
          return 4 /* DOOR_SECRET */;
        }
        return 2 /* DOOR */;
      case 3 /* UNLOCKED */:
        return 2 /* DOOR */;
      case 4 /* HIDDEN */:
        secretDoors++;
        return 4 /* DOOR_SECRET */;
      case 5 /* BARRICADE */:
        return ctx.rng.int(0, 3) === 0 ? 17 /* BOOKSHELF */ : 37 /* BARRICADE */;
      case 6 /* LOCKED */:
        return 3 /* DOOR_LOCKED */;
    }
  };
  for (const room of rooms) {
    for (const n of room.carvedTo) {
      const door = room.doors.find((d) => n.doors.includes(d));
      if (!door || seen.has(door))
        continue;
      seen.add(door);
      const joined = joinRooms(room, n);
      if (joined) {
        for (const c of joined)
          ctx.set(c.x, c.y, 1 /* FLOOR */);
        continue;
      }
      const tile = tileFor(door);
      ctx.set(door.x, door.y, tile);
      ctx.out.doors.push({ x: door.x, y: door.y, type: door.type, tile });
    }
  }
  return secretDoors;
}
function paintPrisonBossDoors(ctx, rooms, exitRoom, arenaDoor) {
  const seen = new Set;
  for (const room of rooms) {
    if (room.type === 0 /* NULL */)
      continue;
    for (const n of room.carvedTo) {
      const door = room.doors.find((d) => n.doors.includes(d));
      if (!door || seen.has(door))
        continue;
      seen.add(door);
      let tile;
      if (door === arenaDoor) {
        upgradeDoor(door, 6 /* LOCKED */);
        tile = 3 /* DOOR_LOCKED */;
      } else if (room.type === 6 /* PASSAGE */ && n.type === 6 /* PASSAGE */) {
        tile = 1 /* FLOOR */;
      } else {
        upgradeDoor(door, 2 /* REGULAR */);
        tile = 2 /* DOOR */;
      }
      ctx.set(door.x, door.y, tile);
      if (tile !== 1 /* FLOOR */) {
        ctx.out.doors.push({ x: door.x, y: door.y, type: door.type, tile });
      }
    }
  }
  return 0;
}
function placePoisonTraps(ctx, rooms) {
  const nTraps = ctx.depth <= 1 ? 0 : ctx.rng.int(1, rooms.length + ctx.depth);
  let placed = 0;
  for (let i = 0;i < nTraps; i++) {
    const cell = ctx.rng.int(0, ctx.width * ctx.height);
    if (ctx.tiles[cell] === 1 /* FLOOR */) {
      ctx.tiles[cell] = 26 /* TRAP_POISON */;
      ctx.out.traps.push({ x: ctx.x(cell), y: ctx.y(cell), trap: 3, hidden: false });
      placed++;
    }
  }
  return { attempts: nTraps, placed };
}
function placeTraps(ctx, rooms) {
  const nTraps = ctx.depth <= 1 ? 0 : ctx.rng.int(1, rooms.length + ctx.depth);
  let placed = 0;
  for (let i = 0;i < nTraps; i++) {
    const cell = ctx.rng.int(0, ctx.width * ctx.height);
    if (ctx.tiles[cell] === 1 /* FLOOR */) {
      const trap = ctx.rng.int(0, 8);
      ctx.tiles[cell] = 21 /* TRAP_TOXIC_HIDDEN */ + trap * 2;
      ctx.out.traps.push({ x: ctx.x(cell), y: ctx.y(cell), trap, hidden: true });
      placed++;
    }
  }
  return { attempts: nTraps, placed };
}
function decorateSewers(ctx, entranceRoom, entranceCell) {
  const W = ctx.width;
  const H = ctx.height;
  const rng = ctx.rng;
  for (let i = 0;i < W; i++) {
    if (ctx.tiles[i] === 0 /* WALL */ && ctx.tiles[i + W] === 9 /* WATER */ && rng.int(0, 4) === 0) {
      ctx.out.markers.wallDeco.push(i);
    }
  }
  for (let i = W;i < W * H - W; i++) {
    if (ctx.tiles[i] === 0 /* WALL */ && ctx.tiles[i - W] === 0 /* WALL */ && ctx.tiles[i + W] === 9 /* WATER */ && rng.int(0, 2) === 0) {
      ctx.out.markers.wallDeco.push(i);
    }
  }
  const DIRS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];
  for (let i = W + 1;i < W * H - W - 1; i++) {
    if (ctx.tiles[i] === 1 /* FLOOR */) {
      const x = i % W;
      const y = Math.floor(i / W);
      let count = 0;
      for (const d of DIRS) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H && ctx.tiles[ny * W + nx] === 0 /* WALL */)
          count++;
      }
      if (rng.int(0, 16) < count * count) {
        ctx.out.markers.emptyDeco.push(i);
      }
    }
  }
  placeSign(ctx, entranceRoom, entranceCell);
}
function placeSign(ctx, entranceRoom, entranceCell) {
  while (true) {
    const pos = randomCell(ctx, entranceRoom);
    if (pos !== entranceCell) {
      ctx.out.markers.signs.push(pos);
      break;
    }
  }
}
function decorateBoss(ctx, exitRoom, exitCell) {
  const W = ctx.width;
  const start = exitRoom.t * W + exitRoom.l + 1;
  const end = start + roomW(exitRoom) - 1;
  for (let i = start;i < end; i++) {
    if (i !== exitCell) {
      ctx.out.markers.wallDeco.push(i);
      ctx.tiles[i + W] = 9 /* WATER */;
    } else {
      ctx.tiles[i + W] = 1 /* FLOOR */;
    }
  }
}
function decoratePrisonCore(ctx, entranceRoom, entranceCell, base, torchTop, torchInner) {
  const W = ctx.width;
  const H = ctx.height;
  const rng = ctx.rng;
  for (let i = W + 1;i < W * H - W - 1; i++) {
    if (ctx.tiles[i] === 1 /* FLOOR */) {
      let c = base;
      if (ctx.tiles[i + 1] === 0 /* WALL */ && ctx.tiles[i + W] === 0 /* WALL */)
        c += 0.2;
      if (ctx.tiles[i - 1] === 0 /* WALL */ && ctx.tiles[i + W] === 0 /* WALL */)
        c += 0.2;
      if (ctx.tiles[i + 1] === 0 /* WALL */ && ctx.tiles[i - W] === 0 /* WALL */)
        c += 0.2;
      if (ctx.tiles[i - 1] === 0 /* WALL */ && ctx.tiles[i - W] === 0 /* WALL */)
        c += 0.2;
      if (rng.float(0, 1) < c)
        ctx.out.markers.emptyDeco.push(i);
    }
  }
  const openBelow = (i) => {
    const t = ctx.tiles[i + W];
    return t === 1 /* FLOOR */ || t === 11 /* WALKWAY */;
  };
  for (let i = 0;i < W; i++) {
    if (ctx.tiles[i] === 0 /* WALL */ && openBelow(i) && rng.int(0, torchTop) === 0) {
      ctx.out.markers.wallDeco.push(i);
    }
  }
  for (let i = W;i < W * H - W; i++) {
    if (ctx.tiles[i] === 0 /* WALL */ && ctx.tiles[i - W] === 0 /* WALL */ && openBelow(i) && rng.int(0, torchInner) === 0) {
      ctx.out.markers.wallDeco.push(i);
    }
  }
  placeSign(ctx, entranceRoom, entranceCell);
}
function decoratePrison(ctx, entranceRoom, entranceCell) {
  decoratePrisonCore(ctx, entranceRoom, entranceCell, 0.05, 6, 3);
}
function decoratePrisonBoss(ctx, entranceRoom, entranceCell, exitRoom) {
  decoratePrisonCore(ctx, entranceRoom, entranceCell, 0.15, 4, 2);
  ctx.fillRect(exitRoom.l + 2, exitRoom.t + 2, roomW(exitRoom) - 3, roomH(exitRoom) - 3, 36 /* TRAP_INACTIVE */);
}
function paintBlacksmith(ctx, room) {
  ctx.fillRoom(room, 0 /* WALL */);
  ctx.fillRoomMargin(room, 1, 22 /* TRAP_FIRE */);
  ctx.fillRoomMargin(room, 2, 11 /* WALKWAY */);
  for (let i = 0;i < 2; i++) {
    let pos2 = randomCell(ctx, room);
    let guard2 = 4096;
    while (ctx.tiles[pos2] !== 11 /* WALKWAY */ && guard2-- > 0) {
      pos2 = randomCell(ctx, room);
    }
    ctx.drop(pos2, prize(ctx.rng.pick(["prize-armor", "prize-weapon"])));
  }
  for (let i = room.l + 1;i < room.r; i++) {
    for (const y of [room.t + 1, room.b - 1]) {
      ctx.out.traps.push({ x: i, y, trap: TRAP_ORDER.indexOf("fire"), hidden: false });
    }
  }
  for (let j = room.t + 2;j < room.b - 1; j++) {
    for (const x of [room.l + 1, room.r - 1]) {
      ctx.out.traps.push({ x, y: j, trap: TRAP_ORDER.indexOf("fire"), hidden: false });
    }
  }
  for (const door of room.doors) {
    upgradeDoor(door, 3 /* UNLOCKED */);
    drawInside(ctx, room, door, 1, 1 /* FLOOR */);
  }
  let pos = randomCell(ctx, room, 1);
  let guard = 4096;
  while (ctx.heaps.has(pos) && guard-- > 0) {
    pos = randomCell(ctx, room, 1);
  }
  ctx.out.mobs.push({ pos, kind: "blacksmith" });
}
function decorateCaves(ctx, rooms, entranceRoom, entranceCell) {
  const W = ctx.width;
  const H = ctx.height;
  const rng = ctx.rng;
  for (const room of rooms) {
    if (room.type !== 1 /* STANDARD */)
      continue;
    if (roomW(room) <= 3 || roomH(room) <= 3)
      continue;
    const s = roomW(room) * roomH(room);
    const cornerWall = (cx, cy, nx1, ny1, nx2, ny2) => {
      if (ctx.get(nx1, ny1) === 0 /* WALL */ && ctx.get(nx2, ny2) === 0 /* WALL */) {
        ctx.set(cx, cy, 0 /* WALL */);
      }
    };
    if (rng.int(0, s) > 8) {
      cornerWall(room.l + 1, room.t + 1, room.l, room.t + 1, room.l + 1, room.t);
    }
    if (rng.int(0, s) > 8) {
      cornerWall(room.r - 1, room.t + 1, room.r, room.t + 1, room.r - 1, room.t);
    }
    if (rng.int(0, s) > 8) {
      cornerWall(room.l + 1, room.b - 1, room.l, room.b - 1, room.l + 1, room.b);
    }
    if (rng.int(0, s) > 8) {
      cornerWall(room.r - 1, room.b - 1, room.r, room.b - 1, room.r - 1, room.b);
    }
    for (const n of room.carvedTo) {
      if ((n.type === 1 /* STANDARD */ || n.type === 5 /* TUNNEL */) && rng.int(0, 3) === 0) {
        const door = sharedDoor(room, n);
        if (door)
          ctx.out.markers.emptyDeco.push(ctx.idx(door.x, door.y));
      }
    }
  }
  for (let i = W + 1;i < W * H - W; i++) {
    if (ctx.tiles[i] === 1 /* FLOOR */) {
      let n = 0;
      if (ctx.tiles[i + 1] === 0 /* WALL */)
        n++;
      if (ctx.tiles[i - 1] === 0 /* WALL */)
        n++;
      if (ctx.tiles[i + W] === 0 /* WALL */)
        n++;
      if (ctx.tiles[i - W] === 0 /* WALL */)
        n++;
      if (rng.int(0, 6) <= n) {
        ctx.out.markers.emptyDeco.push(i);
      }
    }
  }
  for (let i = 0;i < W * H; i++) {
    if (ctx.tiles[i] === 0 /* WALL */ && rng.int(0, 12) === 0) {
      ctx.out.markers.wallDeco.push(i);
    }
  }
  placeSign(ctx, entranceRoom, entranceCell);
  if (!ctx.bossNext) {
    for (const r of rooms) {
      if (r.type !== 1 /* STANDARD */)
        continue;
      for (const n of r.neighbours) {
        if (n.type !== 1 /* STANDARD */ || r.carvedTo.includes(n))
          continue;
        const w = intersectRooms(r, n);
        if (!w)
          continue;
        if (w.l === w.r && w.b - w.t >= 5) {
          for (let y = w.t + 2;y < w.b - 1; y++)
            ctx.set(w.l, y, 8 /* CHASM */);
        } else if (w.t === w.b && w.r - w.l >= 5) {
          for (let x = w.l + 2;x < w.r - 1; x++)
            ctx.set(x, w.t, 8 /* CHASM */);
        }
      }
    }
  }
}
function paintCavesBoss(ctx) {
  const W = ctx.width;
  const H = ctx.height;
  const rng = ctx.rng;
  const ROOM_LEFT = W / 2 - 2;
  const ROOM_RIGHT = W / 2 + 2;
  const ROOM_TOP = H / 2 - 2;
  const ROOM_BOTTOM = H / 2 + 2;
  let topMost = Number.MAX_SAFE_INTEGER;
  let exit = -1;
  for (let i = 0;i < 8; i++) {
    let left;
    let right;
    let top;
    let bottom;
    if (rng.int(0, 2) === 0) {
      left = rng.intRange(1, ROOM_LEFT - 3);
      right = ROOM_RIGHT + 3;
    } else {
      left = ROOM_LEFT - 3;
      right = rng.intRange(ROOM_RIGHT + 3, W - 1);
    }
    if (rng.int(0, 2) === 0) {
      top = rng.intRange(2, ROOM_TOP - 3);
      bottom = ROOM_BOTTOM + 3;
    } else {
      top = ROOM_LEFT - 3;
      bottom = rng.intRange(ROOM_TOP + 3, H - 1);
    }
    ctx.fillRect(left, top, right - left + 1, bottom - top + 1, 1 /* FLOOR */);
    if (top < topMost) {
      topMost = top;
      exit = rng.intRange(left, right) + (top - 1) * W;
    }
  }
  ctx.tiles[exit] = 5 /* EXIT_LOCKED */;
  for (let i = 0;i < W * H; i++) {
    if (ctx.tiles[i] === 1 /* FLOOR */ && rng.int(0, 6) === 0) {
      ctx.tiles[i] = 36 /* TRAP_INACTIVE */;
    }
  }
  ctx.fillRect(ROOM_LEFT - 1, ROOM_TOP - 1, ROOM_RIGHT - ROOM_LEFT + 3, ROOM_BOTTOM - ROOM_TOP + 3, 0 /* WALL */);
  ctx.fillRect(ROOM_LEFT, ROOM_TOP + 1, ROOM_RIGHT - ROOM_LEFT + 1, ROOM_BOTTOM - ROOM_TOP, 1 /* FLOOR */);
  ctx.fillRect(ROOM_LEFT, ROOM_TOP, ROOM_RIGHT - ROOM_LEFT + 1, 1, 20 /* TRAP_TOXIC */);
  for (let x = ROOM_LEFT;x <= ROOM_RIGHT; x++) {
    ctx.out.traps.push({ x, y: ROOM_TOP, trap: TRAP_ORDER.indexOf("toxic"), hidden: false });
  }
  const arenaDoor = rng.intRange(ROOM_LEFT, ROOM_RIGHT) + (ROOM_BOTTOM + 1) * W;
  ctx.tiles[arenaDoor] = 2 /* DOOR */;
  ctx.out.doors.push({
    x: arenaDoor % W,
    y: Math.floor(arenaDoor / W),
    type: 2 /* REGULAR */,
    tile: 2 /* DOOR */
  });
  const entrance = rng.intRange(ROOM_LEFT + 1, ROOM_RIGHT - 1) + rng.intRange(ROOM_TOP + 1, ROOM_BOTTOM - 1) * W;
  ctx.tiles[entrance] = 6 /* ENTRANCE */;
  const patch = generatePatch(rng, 0.45, 6, W, H);
  for (let i = 0;i < W * H; i++) {
    if (ctx.tiles[i] === 1 /* FLOOR */ && patch[i])
      ctx.tiles[i] = 9 /* WATER */;
  }
  decorateCavesBoss(ctx, entrance);
  return {
    entrance,
    exit,
    arenaDoor,
    arena: { l: ROOM_LEFT, t: ROOM_TOP, r: ROOM_RIGHT, b: ROOM_BOTTOM }
  };
}
function decorateCavesBoss(ctx, entrance) {
  const W = ctx.width;
  const H = ctx.height;
  const rng = ctx.rng;
  for (let i = W + 1;i < W * H - W; i++) {
    if (ctx.tiles[i] === 1 /* FLOOR */) {
      let n = 0;
      if (ctx.tiles[i + 1] === 0 /* WALL */)
        n++;
      if (ctx.tiles[i - 1] === 0 /* WALL */)
        n++;
      if (ctx.tiles[i + W] === 0 /* WALL */)
        n++;
      if (ctx.tiles[i - W] === 0 /* WALL */)
        n++;
      if (rng.int(0, 8) <= n) {
        ctx.out.markers.emptyDeco.push(i);
      }
    }
  }
  for (let i = 0;i < W * H; i++) {
    if (ctx.tiles[i] === 0 /* WALL */ && rng.int(0, 8) === 0) {
      ctx.out.markers.wallDeco.push(i);
    }
  }
  const ROOM_LEFT = W / 2 - 2;
  const ROOM_RIGHT = W / 2 + 2;
  const ROOM_TOP = H / 2 - 2;
  const ROOM_BOTTOM = H / 2 + 2;
  let sign = -1;
  let guard = 4096;
  do {
    sign = rng.intRange(ROOM_LEFT, ROOM_RIGHT) + rng.intRange(ROOM_TOP, ROOM_BOTTOM) * W;
  } while (sign === entrance && guard-- > 0);
  ctx.out.markers.signs.push(sign);
}

// src/dungeon/generator.ts
function isBossDepth(depth) {
  return depth % 5 === 0;
}
function shopOnLevel(depth) {
  return depth === 6 || depth === 11 || depth === 16;
}
function isPrisonDepth(depth) {
  return depth >= 6 && depth <= 10;
}
function isCavesDepth(depth) {
  return depth >= 11 && depth <= 14;
}
function findShopRoom(entrance) {
  for (const r of entrance.carvedTo) {
    if (r.carvedTo.length === 1 && roomW(r) >= 5 && roomH(r) >= 5)
      return r;
  }
  return null;
}
var W = 32;
var H = 32;
var questItem = (tag) => ({ tag, heap: "HEAP" });
function feelingName(f) {
  switch (f) {
    case "water" /* WATER */:
      return "water";
    case "grass" /* GRASS */:
      return "grass";
    case "chasm" /* CHASM */:
      return "chasm";
    default:
      return "none";
  }
}
function blocksSight(t) {
  return t === 0 /* WALL */ || t === 2 /* DOOR */ || t === 4 /* DOOR_SECRET */ || t === 3 /* DOOR_LOCKED */ || t === 37 /* BARRICADE */ || t === 17 /* BOOKSHELF */ || t === 15 /* STATUE */;
}
var PASSABLE_SPAWN = new Set([
  1 /* FLOOR */,
  11 /* WALKWAY */,
  10 /* GRASS */,
  39 /* HIGH_GRASS */,
  38 /* EMBERS */,
  9 /* WATER */,
  2 /* DOOR */,
  4 /* DOOR_SECRET */,
  6 /* ENTRANCE */,
  7 /* EXIT */
]);
function isDoorTile(tile) {
  return tile === 2 /* DOOR */ || tile === 4 /* DOOR_SECRET */ || tile === 3 /* DOOR_LOCKED */ || tile === 37 /* BARRICADE */ || tile === 17 /* BOOKSHELF */;
}
function souNeeded(rng, depth, scrolls) {
  const quota = [5, 3, 10, 6, 15, 9, 20, 12, 25, 13];
  for (let i = 0;i < quota.length; i += 2) {
    const qDepth = quota[i];
    if (depth <= qDepth) {
      const qNumber = quota[i + 1];
      return rng.float(0, 1) < (qNumber - scrolls) / (qDepth - depth + 1);
    }
  }
  return false;
}
function generateLevel(rng, depth, run) {
  const boss = isBossDepth(depth);
  const tengu = depth === 10;
  const dm300 = depth === 15;
  const queue = [];
  if (!boss) {
    queue.push(questItem("food"));
    if (depth % 5 === 1)
      queue.push(questItem("potion-of-strength"));
    if (depth % 5 === 3)
      queue.push(questItem("scroll-of-enchantment"));
    if (souNeeded(rng, depth, run.scrollsOfUpgrade)) {
      queue.push(questItem("scroll-of-upgrade"));
      run.scrollsOfUpgrade++;
    }
  }
  let feeling = "none" /* NONE */;
  if (!boss && depth > 1) {
    const r = rng.int(0, 10);
    if (r === 0) {
      if (!isBossDepth(depth + 1))
        feeling = "chasm" /* CHASM */;
    } else if (r === 1) {
      feeling = "water" /* WATER */;
    } else if (r === 2) {
      feeling = "grass" /* GRASS */;
    }
  }
  let rooms = [];
  let entranceRoom = null;
  let exitRoom = null;
  let anteroom = null;
  let ctx = null;
  let entranceCell = -1;
  let exitCell = -1;
  let cavesArenaDoor = -1;
  let cavesArena = null;
  let secretDoors = 0;
  let trapAttempts = 0;
  let trapsPlaced = 0;
  const pitNeeded = depth > 1 && run.weakFloor;
  if (dm300) {
    const c = new PainterCtx(rng, W, H, depth, "none", true, false);
    const built = paintCavesBoss(c);
    entranceCell = built.entrance;
    exitCell = built.exit;
    cavesArenaDoor = built.arenaDoor;
    cavesArena = built.arena;
    rooms = [];
    ctx = c;
  } else
    for (let attempt = 0;attempt < 200; attempt++) {
      const built = buildRooms(rng);
      if (!built)
        continue;
      const c = new PainterCtx(rng, W, H, depth, feelingName(feeling), boss, !boss && isBossDepth(depth + 1));
      c.out.spawnQueue.push(...queue);
      if (boss) {
        if (tengu) {
          const plan = planPrisonBossConnections(rng, built);
          if (!plan)
            continue;
          entranceRoom = plan.entrance;
          exitRoom = plan.exit;
          anteroom = plan.anteroom;
          const painted = paintRooms(c, built);
          entranceCell = painted.entrance;
          exitCell = painted.exit;
          if (entranceCell < 0 || exitCell < 0)
            continue;
          const arenaDoor = entranceDoor(exitRoom);
          if (arenaDoor && arenaDoor.y === exitRoom.t)
            continue;
          secretDoors = paintPrisonBossDoors(c, built, exitRoom, arenaDoor ?? null);
          paintWaterGrass(c, built, 0.45, 0.3);
          const traps = placePoisonTraps(c, built);
          trapAttempts = traps.attempts;
          trapsPlaced = traps.placed;
          decoratePrisonBoss(c, entranceRoom, entranceCell, exitRoom);
        } else {
          const plan = planBossConnections(rng, built);
          if (!plan)
            continue;
          entranceRoom = plan.entrance;
          exitRoom = plan.exit;
          const painted = paintRooms(c, built);
          entranceCell = painted.entrance;
          exitCell = painted.exit;
          if (entranceCell < 0 || exitCell < 0)
            continue;
          secretDoors = paintDoorTiles(c, built);
          paintWaterGrass(c, built, 0.5, 0.4);
          const traps = placeTraps(c, built);
          trapAttempts = traps.attempts;
          trapsPlaced = traps.placed;
          decorateBoss(c, exitRoom, exitCell);
          placeSign(c, entranceRoom, entranceCell);
        }
      } else {
        const plan = planConnections(rng, built, {
          exitMinSize: 4,
          exitType: 3 /* EXIT */,
          connectFirstPath: true,
          fillRandom: true
        });
        if (!plan)
          continue;
        if (shopOnLevel(depth)) {
          const shop = findShopRoom(plan.entrance);
          if (!shop)
            continue;
          shop.type = 7 /* SHOP */;
        }
        const assign = assignRoomTypes(rng, built, depth, {
          prevWeakFloor: pitNeeded,
          nextIsBoss: isBossDepth(depth + 1),
          tunnelsToPassages: isPrisonDepth(depth)
        });
        run.weakFloor = assign.weakFloor;
        if (isCavesDepth(depth) && depth > 11 && !run.blacksmithSpawned && rng.int(0, 15 - depth) === 0) {
          for (const r of built) {
            if (r.type === 1 /* STANDARD */ && roomW(r) > 4 && roomH(r) > 4) {
              r.type = 8 /* BLACKSMITH */;
              run.blacksmithSpawned = true;
              break;
            }
          }
        }
        entranceRoom = plan.entrance;
        exitRoom = plan.exit;
        if (feeling === "chasm" /* CHASM */)
          c.tiles.fill(8 /* CHASM */);
        const painted = paintRooms(c, built);
        entranceCell = painted.entrance;
        exitCell = painted.exit;
        if (entranceCell < 0 || exitCell < 0)
          continue;
        secretDoors = paintDoorTiles(c, built);
        const traps = placeTraps(c, built);
        trapAttempts = traps.attempts;
        trapsPlaced = traps.placed;
        if (isPrisonDepth(depth)) {
          paintWaterGrass(c, built, feeling === "water" /* WATER */ ? 0.65 : 0.45, feeling === "grass" /* GRASS */ ? 0.6 : 0.4, 4, 3);
          decoratePrison(c, entranceRoom, entranceCell);
        } else if (isCavesDepth(depth)) {
          paintWaterGrass(c, built, feeling === "water" /* WATER */ ? 0.6 : 0.45, feeling === "grass" /* GRASS */ ? 0.55 : 0.35, 6, 3);
          decorateCaves(c, built, entranceRoom, entranceCell);
        } else {
          paintWaterGrass(c, built);
          decorateSewers(c, entranceRoom, entranceCell);
        }
      }
      rooms = built;
      ctx = c;
      break;
    }
  if (!ctx || entranceCell < 0 || exitCell < 0) {
    throw new Error(`dungeon generation failed for depth ${depth}`);
  }
  if (!dm300 && (!entranceRoom || !exitRoom)) {
    throw new Error(`dungeon generation failed for depth ${depth}`);
  }
  const tiles = ctx.tiles;
  const mobs = [...ctx.out.mobs];
  const occupied = new Set([entranceCell]);
  for (const m of mobs)
    occupied.add(m.pos);
  const grid = new Grid(W, H);
  const visible = new Uint8Array(W * H);
  computeFov(grid, (x, y) => blocksSight(tiles[y * W + x]), entranceCell % W, Math.floor(entranceCell / W), 8, visible);
  const randomStandardRoom = () => {
    for (let i = 0;i < 10; i++) {
      const r = rng.pick(rooms);
      if (r.type === 1 /* STANDARD */)
        return r;
    }
    return null;
  };
  const randomRespawnCell = () => {
    for (let i = 0;i < 10; i++) {
      const room = randomStandardRoom();
      if (!room)
        continue;
      const cell = randomCell(ctx, room);
      if (!visible[cell] && !occupied.has(cell) && PASSABLE_SPAWN.has(tiles[cell])) {
        return cell;
      }
    }
    return -1;
  };
  if (boss) {
    if (!tengu && !dm300 && exitRoom)
      mobs.push({ pos: randomCell(ctx, exitRoom), kind: "boss" });
  } else {
    const nMobs = 2 + depth % 5 + rng.int(0, 3);
    for (let i = 0;i < nMobs; i++) {
      let pos = -1;
      for (let t = 0;t < 50 && pos === -1; t++)
        pos = randomRespawnCell();
      if (pos === -1)
        continue;
      occupied.add(pos);
      mobs.push({ pos, kind: "mob" });
    }
    if (!run.ghostSpawned && depth > 1 && depth < 5 && rng.int(0, 5 - depth) === 0) {
      let pos = -1;
      for (let t = 0;t < 50 && pos === -1; t++)
        pos = randomRespawnCell();
      if (pos !== -1) {
        occupied.add(pos);
        mobs.push({ pos, kind: "ghost" });
        run.ghostSpawned = true;
      }
    }
    if (!run.wandmakerSpawned && depth > 6 && depth < 10 && rng.int(0, 10 - depth) === 0) {
      for (let t = 0;t < 50; t++) {
        const pos = randomCell(ctx, entranceRoom);
        if (tiles[pos] === 6 /* ENTRANCE */)
          continue;
        if (ctx.out.markers.signs.includes(pos))
          continue;
        if (occupied.has(pos))
          continue;
        occupied.add(pos);
        mobs.push({ pos, kind: "wandmaker" });
        run.wandmakerSpawned = true;
        break;
      }
    }
  }
  const items = [...ctx.out.items];
  if (boss) {
    if (tengu && anteroom) {
      let keyPos = -1;
      for (let t = 0;t < 1000 && keyPos < 0; t++) {
        const p = randomCell(ctx, anteroom);
        if (PASSABLE_SPAWN.has(tiles[p]))
          keyPos = p;
      }
      if (keyPos < 0) {
        for (let y = anteroom.t + 1;y < anteroom.b && keyPos < 0; y++) {
          for (let x = anteroom.l + 1;x < anteroom.r && keyPos < 0; x++) {
            if (tiles[y * W + x] === 1 /* FLOOR */)
              keyPos = y * W + x;
          }
        }
      }
      if (keyPos >= 0)
        items.push({ pos: keyPos, heap: "CHEST", tag: "iron-key" });
    }
  } else {
    const randomDropCell = (unlockedOnly = false, walkableOnly = false) => {
      for (let guard = 0;guard < 1000; guard++) {
        const room = randomStandardRoom();
        if (!room)
          continue;
        if (unlockedOnly && room.doors.some((d) => d.type === 6 /* LOCKED */))
          continue;
        const pos = randomCell(ctx, room);
        const t = tiles[pos];
        if (!PASSABLE_SPAWN.has(t))
          continue;
        if (walkableOnly && t === 9 /* WATER */)
          continue;
        return pos;
      }
      throw new Error("randomDropCell failed: no standard room");
    };
    let nItems = 3;
    while (rng.float(0, 1) < 0.4)
      nItems++;
    for (let i = 0;i < nItems; i++) {
      let heap;
      switch (rng.int(0, 20)) {
        case 0:
          heap = "SKELETON";
          break;
        case 1:
        case 2:
        case 3:
        case 4:
          heap = "CHEST";
          break;
        case 5:
          heap = depth > 1 ? "MIMIC" : "CHEST";
          break;
        default:
          heap = "HEAP";
          break;
      }
      items.push({ pos: randomDropCell(false, true), heap, tag: "random" });
    }
    if (run.dewVialNeeded && depth < 5 && rng.int(0, 4 - depth) === 0) {
      ctx.out.spawnQueue.push(questItem("dew-vial"));
      run.dewVialNeeded = false;
    }
    for (const queued of ctx.out.spawnQueue) {
      let cell = randomDropCell(true, true);
      if (queued.tag === "scroll-of-upgrade") {
        let guard = 1000;
        while ((tiles[cell] === 22 /* TRAP_FIRE */ || tiles[cell] === 23 /* TRAP_FIRE_HIDDEN */) && guard-- > 0) {
          cell = randomDropCell(true, true);
        }
      }
      items.push({ pos: cell, heap: queued.heap, tag: queued.tag });
    }
  }
  const level = new Level(W, H);
  level.depth = depth;
  level.region = regionForDepth(depth);
  level.tiles = tiles;
  level.feeling = feeling;
  level.bossLevel = boss;
  level.sealed = false;
  level.secretDoors = secretDoors;
  level.stairsUp = entranceCell;
  level.stairsDown = exitCell;
  level.doors = ctx.out.doors.flatMap((d) => isDoorTile(d.tile) ? [ctx.idx(d.x, d.y)] : []);
  level.traps = ctx.out.traps.map((t) => ctx.idx(t.x, t.y));
  if (tengu && exitRoom) {
    level.bossArena = { l: exitRoom.l, t: exitRoom.t, r: exitRoom.r, b: exitRoom.b };
    const arenaDoor = entranceDoor(exitRoom);
    level.arenaDoorCell = arenaDoor ? ctx.idx(arenaDoor.x, arenaDoor.y) : -1;
  }
  if (dm300 && cavesArena) {
    level.bossArena = { ...cavesArena };
    level.arenaDoorCell = cavesArenaDoor;
  }
  return { level, rooms, markers: ctx.out.markers, items, mobs, trapAttempts, trapsPlaced };
}

// src/assets/sprites.ts
var ART_PX = 16;
var PALETTE = {
  ".": "transparent",
  k: "#2b2226",
  F: "#6e7484",
  f: "#5b6170",
  W: "#3d4354",
  w: "#565e78",
  H: "#ffffff",
  y: "#f2c14e",
  a: "#5d2d1b",
  b: "#842e12",
  h: "#97734b",
  i: "#877f74",
  j: "#4f4242",
  l: "#1365a7",
  m: "#525a2b",
  n: "#1778a6",
  p: "#4d6b3f",
  q: "#a0a7ac",
  r: "#0e83c3",
  t: "#b1884a",
  x: "#a69f7f",
  A: "#e8d3ae",
  C: "#e39b4f",
  E: "#a03413",
  I: "#f7bc78",
  J: "#c77a39",
  K: "#deb47b",
  L: "#578788",
  M: "#a5ab45",
  Q: "#488f2c",
  V: "#b75034",
  X: "#4f5267",
  Y: "#fdf6e3",
  Z: "#50933e",
  "0": "#d5c6b1",
  "1": "#855539",
  "2": "#e31c0a",
  "3": "#a48679",
  D: "#8a5a2b",
  o: "#e8862e",
  z: "#120e16"
};
var SPRITES = {
  hero: [
    "........JVt.....",
    "........JVVV....",
    ".qq.....31VVE...",
    ".qq....qqiaVb...",
    "..0X.iqqqqiEV...",
    "..0X.i0iqiijba..",
    "..3ijiqiiiij....",
    ".jm1jjihX1Xj....",
    "..kK1ixIxxLL....",
    "...1jX3KK3ij....",
    ".....jLXLLiXj...",
    "......LLLXpLj...",
    "......pmajx1....",
    ".....jLLLXj.....",
    ".....aak.j1a....",
    ".....aa..a1a...."
  ],
  hero_warrior: [
    "........JVt.....",
    "........JVVV....",
    ".qq.....31VVE...",
    ".qq....qqiaVb...",
    "..0X.iqqqqiEV...",
    "..0X.i0iqiijba..",
    "..3ijiqiiiij....",
    ".jm1jjihX1Xj....",
    "..kK1ixIxxLL....",
    "...1jX3KK3ij....",
    ".....jLXLLiXj...",
    "......LLLXpLj...",
    "......pmajx1....",
    ".....jLLLXj.....",
    ".....aak.j1a....",
    ".....aa..a1a...."
  ],
  floor0: [
    "FFFFFFFFFFFFFFFF",
    "FffFFFFFFFFfffZF",
    "FffFFFFFFFFFffFF",
    "FFFFFFFFFFFFFFFf",
    "FFFffFFFFFFFFFFf",
    "FFFffFFFFFFfffFF",
    "FFFFFFFFFFFFFFFF",
    "FFFFZFFFFFFFFFFF",
    "FFFFFFFFFFFFFFFF",
    "FFFFFFFFFFFFFFFF",
    "FFffFFFFFFFFFffF",
    "FFffFFFFFFFFFffF",
    "FFFFFFFFFFFFFFFF",
    "FffFFFFFFFffFFFF",
    "FffFFFFFFFffFpQF",
    "FFFFFFFFFFFFFFFF"
  ],
  floor1: [
    "FFFFFFFFFFFFFFFF",
    "FZfffFFFFFFFFffF",
    "FFffFFFFFFFFFffF",
    "fFFFFFFFFFFFFFFF",
    "fFFFFFFFFFFffFFF",
    "FFfffFFFFFFffFFF",
    "FFFFFFFFFFFFFFFF",
    "FFFFFFFFFFFZFFFF",
    "FFFFFFFFFFFFFFFF",
    "FFFFFFFFFFFFFFFF",
    "FffFFFFFFFFFffFF",
    "FffFFFFFFFFFffFF",
    "FFFFFFFFFFFFFFFF",
    "FFFFffFFFFFFFffF",
    "FQpFffFFFFFFFffF",
    "FFFFFFFFFFFFFFFF"
  ],
  wall: [
    "fwwwwwwwwwwwwwww",
    "pwwwwwwwffwwfwww",
    "wwwwwwffffwwZQww",
    "wwfQfwZfwwwwwwww",
    "wwwwwwwwwwwwwwww",
    "WwwwwwwwwwwwwwwW",
    "QpjWpWjWWppWpWWW",
    "WWmWWWQWWWpWWpWW",
    "WWWWWWpWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW"
  ],
  door: [
    "hiZQZQQQQQQZQZii",
    "phxpmmppmppmpmti",
    "QQp111111111jQQQ",
    "ZQp111a11111jQQQ",
    "p1aj11hJJJJ111hQ",
    "phjjjjJJJJJ111hp",
    "pmma1ttJtJJ11pmZ",
    "ppp1JttJtJj1mp1p",
    "pmp1JttJt1jjjphp",
    "phj1JJtJtJ1111hp",
    "p1jj11hJJJJ111hp",
    "m1iajjVJVVV11q1m",
    "m1Zm111V1111mi1j",
    "1jppmjj1jjjphL11",
    "1jQQQttt33pQhp11",
    "1jQQpt3htthQQp11"
  ],
  door_locked: [
    "MZiQQQQQQQQQQZii",
    "phxpmppppppmpmhL",
    "QQQj11111111jQQQ",
    "QQQ1a111111aapQQ",
    "Q11ja111111a111Q",
    "ph1jjjjjjjjj11hQ",
    "Qj1j111jj1111pmQ",
    "ppQ11h1XX1h11Q1p",
    "p1p11h1MJ1h11php",
    "phj11h1111h111hp",
    "p11jjjjjjjjj111p",
    "j1ijajjjjjjaax1m",
    "jQhpa1111V1amihj",
    "1jpZpjjjjjjQtiX1",
    "1jQQQh33t3hQmpj1",
    "j1QQZ333h3hZQQ11"
  ],
  door_secret: [
    "wwwwwwwwwwwwwwww",
    "pwwwwwwwwfwwwWww",
    "wwwwwwwfppwwQQWw",
    "wwfZffQfwwwwwwww",
    "wwwwwwwwwwwwwwww",
    "WwwwwwwwwwwwwwwW",
    "ppjWpkWWWpjWpWWW",
    "WWmWWkQWWmQWppWW",
    "WWWWWkpWWWWWWWWW",
    "WWWWWkWWWWWWWWWW",
    "WWWWWkWWWWWWWWWW",
    "WWWWWkWWWWWWWWWW",
    "WWWWWkWWWWWWWWWW",
    "WWWWWkWWWWWWWWWW",
    "WWWWWkWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW"
  ],
  water: [
    "lHrrrrrHrrrrrrrr",
    "HllrrrHHHrrllllr",
    "llllllrHrHlllrrr",
    "rrrrrrrrrrHrrrll",
    "rrrrrrrrrrHlllll",
    "llrrrrrrrrHlllll",
    "lrrrrrrrlrrlrlrr",
    "rllllrrrrllllrrr",
    "lllllllrrrrrrrrl",
    "rrrnllnrrrrrrrll",
    "rrrlllllllllrrrr",
    "lllllllHlllrrrrH",
    "llrrllrHrrrrrrrH",
    "lllrrrrrHrrrlrHl",
    "lllrlrrrHHlllHHl",
    "lllllrrrllHHHlll"
  ],
  grass: [
    "ZZQQfZffFffQQfff",
    "ppQQfpFFffQQQQFF",
    "ffQWffFfppQmQQff",
    "pQQfFFFffffffffQ",
    "QQQQFfFZZffFFfQQ",
    "QQQfQfZQQQQQfppQ",
    "ppfpQfQQQQQQZZQp",
    "QfZfffQQQpQQQQQQ",
    "QfpZZfpQZFppQQQQ",
    "ZZZQfZffFffQQfff",
    "ppQQfpFFFpQQQZFF",
    "ffQWffFfppQmQQfZ",
    "QQQfFFFffffffffQ",
    "QQQQffFfZffFFfQQ",
    "QQQfQffQQQQQfpQQ",
    "fpfZpfQQQQQQZfQp"
  ],
  chasm: [
    ".aakkkabbbbkabbb",
    ".bbkkkaaaaabbaak",
    ".bbbkkkkkkkbakka",
    ".bbakkkkkkkkkkab",
    ".akkkkkkkkkkkabb",
    ".kkkkkkkkkkkkaab",
    ".abkkkkkkkkkkkab",
    ".bbbkkkkkkkkkkka",
    ".bbkkkkkkkkkkkkk",
    ".baakkkkkkkkkkkb",
    ".bakkkkkkkkkkkkb",
    ".bkkkkkkkkkkkabb",
    ".bbkkkkkkkkkkkba",
    ".bbakbkkkkkabbba",
    ".aabbbkkkkkbbbbb",
    ".baabbbbbakabbbb"
  ],
  stairs_up: [
    "YYKYYYYYYYYYYKYY",
    "II3YYYYYYYYYYtII",
    "II3YYYYYYYYYYtII",
    "CC1KKKKIKKIIK1CC",
    "CCbEVVVVVVVVEbCC",
    "CCVIIIIIIIIIIVCC",
    "CCbJJJJJJJJJJbCC",
    "JJkbbbbbbbbbbkJJ",
    "JJVCCCCCCCCCCVJJ",
    "JJbVVJJJJJJJVbJJ",
    "VEabbEEEEEEbbaEV",
    "VEVJJJJJJJJJJVEV",
    "VEbEEEEEEEEEEbVV",
    "EbabbbbbbbbbbabE",
    "bbVVVVVVVVVVVVbb",
    "bbVVVVVVVVVVVVbb"
  ],
  stairs_down: [
    "CCEIIIIIIIIIIEJC",
    "CCkbbbbbbbbbbkCC",
    "CJbCIIIIIIIICbJC",
    "CJbCCCCCCCCCCbJC",
    "CJkbEEEEEEEEbkJC",
    "CJEIIIIIIIIIIEJC",
    "CJbJCCCCCCCCJbJC",
    "CJaEVVVVVVVVEaJC",
    "CJEIIIIIIIIIIEJC",
    "JVbJJJJJJJJJJbVJ",
    "VVabEbEbbEbEbaVJ",
    "JVbVVEbaabEVJbVJ",
    "EbEEkkkkkkkkVEbE",
    "baEbkkkkkkkkbEab",
    "VVJbkkkkkkkkkEVV",
    "VJVakkkkkkkkaVVJ"
  ],
  trap_revealed: [
    "bbbbbbbbbbbbbbbb",
    "Eb222222222222bE",
    "b2bbbE22222bbb2E",
    "b2b22E2222E22b2E",
    "b2aEEbEEEEbEEa2b",
    "b2E010iq33qi0E2E",
    "b2bxaijijjia3b2E",
    "b2bkkkkkkkkkkk2E",
    "b2bjkjk1aajkhb2E",
    "b2E0j0iq3iq10E2E",
    "b2bhbh111111hb2b",
    "E2b22b2222E22b2E",
    "b2b22E2222E22b2E",
    "b2bbbE22222bbb2E",
    "Eb222222222222bE",
    "bbbbbbbbbbbbbbbb"
  ],
  well: [
    "......bE........",
    ".....bbEbb......",
    "...bbbbEbbb.....",
    "..bbbbbabbbb....",
    "..bbbabbbabba...",
    "..bka1b1bbkab...",
    "..aa11aaah1b....",
    ".11bakkkkaab1...",
    ".1bakkkkkkkb1...",
    ".11akkkkkkk1h...",
    ".a11kkkkkka11...",
    ".khh1jkkk11hak..",
    ".aa1hhhh1hhaa...",
    "..aaaa1ha1aaa...",
    "..jaabaaaaaa....",
    "....aaaaaa......"
  ],
  chest: [
    "................",
    "...haaaaaa..1a..",
    ".1C1httttt1Ct11.",
    ".thhtttth1tt1a1.",
    ".C111111h1Chaaaa",
    "1t1hh111h1C1aaaa",
    "hJtthhh111t111aa",
    "j111kka1hh1aa11a",
    "1hhhtCthtth11aaa",
    "1h11JmJa111aaaaa",
    "mt111JJ111t1aam.",
    ".t111a1111Mmaam.",
    ".11111111MMmama.",
    ".a1hhh11ZZZmaa..",
    ".....aaaa1aa....",
    "................"
  ],
  mob_rat: [
    "................",
    ".1i.............",
    "j..i............",
    "..ih............",
    ".3i.............",
    "i3..Xii33X..33..",
    "h3.i33iKKijiiK..",
    ".3iiiiiK3ixxxi..",
    "..iiiiiiii1ixX..",
    ".jiiiiiiiih1i1..",
    ".iiijiiiXiiix3X.",
    "33j..jX3ijjii1..",
    ".j.....j33X.i1..",
    ".........1......",
    "................",
    "................"
  ],
  mob_gnoll: [
    "..m........m....",
    "..mZp....pZm....",
    "...pMpMMpZp.....",
    "...QZMMMMpQ.....",
    "...aQpZZ1Qa.....",
    "...pMhpmhMm.....",
    "...mpZZZppm111a.",
    "..Z1mppipmh1111.",
    ".ZMmhammpmh11i1a",
    "pMmaa1mZMph1h0ia",
    "ZMpjm11mpm111Xja",
    "pZm11ama1a11111a",
    "..amamZpaam1aaa.",
    "..mMmmmmmZMaaa..",
    "..jQm....mQ.....",
    "..mZm....mZm...."
  ],
  mob_crab: [
    "................",
    "................",
    ".b.1..1b.1b.E.a.",
    "VV.VbbjbbjabV.VE",
    "EVbVb.ba.a.bVbVE",
    "bVVEa.bk.a..EVVb",
    ".bba.VVVVVE.abb.",
    "...bEKCVVVVEb...",
    "...aVJEVVbVVb...",
    "..EbVVVVEVVVEba.",
    ".bbEbVVVVVVEbEb.",
    ".aEaVaVVVVEVbab.",
    "..bEa..bb...Eka.",
    "....a.......a...",
    "................",
    "................"
  ],
  mob_swarm: [
    "........1mm.....",
    ".......mmmja....",
    "......jja1maa...",
    "......jjaajjak..",
    "...1maaajaaaa...",
    "..1jm1kaaakkk...",
    ".m1mmjjkkkaakk..",
    "jajajajaaj11hm..",
    "aaaajjjajjmmj1m.",
    "aaaakkkj1jam1jaa",
    "kkkkkkkXjjjjmjaa",
    "kkkakkkjjjjjaaaa",
    "..ka...akaakkaaa",
    "........kkkakakk",
    "........k.kkakkk",
    "...........a...."
  ],
  mob_skeleton: [
    "......xqxi......",
    ".....0YYAAx.....",
    "....3AA0AA0.....",
    "....i0xjXxjj....",
    "....13xLxiLj....",
    "....ijji0xi.....",
    "..3hiiiiXjX.ijX.",
    "..X3iiiiiXiXXjj.",
    "aaiiijjxij.3j...",
    ".jiijajjj.......",
    "..jj11iX1.......",
    "...ajj1iii......",
    "...jjkXXiiii....",
    "...i3...j11ii...",
    "..ji....jXjjX...",
    "..jjj..........."
  ],
  mob_thief: [
    "................",
    "........LLXL....",
    "......XXXXXXX...",
    ".......XXXXXXX..",
    ".......jXXXjkkk.",
    "......jXXjakkkk.",
    ".....jkjjkmaaak.",
    "..kkXXXjjkkkkkk.",
    "kXXXjjjjjjkkkk..",
    "jXXjjjjjjjjkjjj.",
    "XXjjjjajjjjkjjjk",
    "XjkjjXjaa1ajjjkj",
    "jkkkXqjjXjjXXkjk",
    ".k..iXXXj.kjk..k",
    ".....kkk........",
    "................"
  ],
  mob_goo: [
    "................",
    "..k..kkkkk......",
    "...kkMMMZZkk.k..",
    "..kMKKMMZZZZk...",
    "..kMMZZMZZZQk...",
    ".kMMZhJZZQQJmk.k",
    ".kMMZCCJmQ1C1Zkk",
    "kMZZZVJJQQ1Jmk..",
    "QZZZZQmQZZQQQZk.",
    "mQZZZZZQmmpQZQk.",
    "mQQQQZZZQQZZQk..",
    "ZQQQZZZZZZQQQQk.",
    "kkQQZQQQQQQQQQkk",
    "..kZZQkkkkkZQk..",
    "..kkkk.....kk...",
    "................"
  ],
  shortsword: [
    ".............kij",
    "...........j0A0X",
    "..........j0Y0qj",
    ".........j0Y0qq.",
    "........j0Y0qqj.",
    ".......j0Y0qqj..",
    "......j0Y0qqj...",
    "..jChj0Y0qqj....",
    "..jtKh00qqj.....",
    "....hChqqj......",
    "...aaJC1j.......",
    "..aaaahC1.......",
    ".jaaaa.tC.......",
    "XYhaa..jj.......",
    "Xqqj............",
    ".XX............."
  ],
  dart: [
    "...............j",
    "..............0.",
    "............XX..",
    "...........h0X..",
    "..........hC1...",
    ".........hC1....",
    "........jt1.....",
    ".......jtj......",
    "......jtj.......",
    "...LLXhj........",
    "..LLL1X.........",
    ".LLL1LL.........",
    "XLXjLLL.........",
    "...XLX..........",
    "...XL...........",
    "...X............"
  ],
  potion_red: [
    "......1111......",
    "......1th1......",
    ".....Lihhin.....",
    ".....Lrrrrn.....",
    ".....jrhhrj.....",
    ".....Lrrrrn.....",
    "....Lq3VVhLr....",
    "...LxIIVVVVir...",
    "..XqIIIVVVVVLX..",
    "..LVKICVVVVCVn..",
    "..LVVVVVVVJAVn..",
    "..LVVJVVVVVVVn..",
    "..XLVVJVVVVELX..",
    "...nLVVVVVVLn...",
    "....nLVEEVLn....",
    ".....jllllj....."
  ],
  potion_strength: [
    "......j11j......",
    "......ahha......",
    ".....XLiiLX.....",
    ".....XqqiLX.....",
    ".....krLLrk.....",
    "......rLirk.....",
    "......qCCxk.....",
    "......xIAq......",
    "......xCCik.....",
    "......xJCik.....",
    "......xJJik.....",
    "......xCJik.....",
    "......xIJik.....",
    "......xJJik.....",
    "......qJJL......",
    "......XXXX......"
  ],
  ration: [
    "......11........",
    "...11tKCtxh.....",
    "...KAAKtKKCaaZm.",
    "...3A0AA0t1mmm..",
    "....htCCthZjpZ..",
    "....111h111Zm...",
    "...11111111m....",
    "..xAh1b111tC1...",
    ".xAAt1t1K1KAC1..",
    "hAA01tKxtxhAKta.",
    "hAAxtAAA0A10KCa.",
    "hAAt3AAAAAhtKCa.",
    "1AA1KAAAAAthCCa.",
    ".hK1KAAAKKthC1..",
    "..h1tCCCCC1h1...",
    "....111111a....."
  ],
  scroll: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "13h1..aab...hhh.",
    "KAAAA0EEbE3AAAt1",
    "KAAAAxEEbV3AAAt1",
    "KAAKKtEbEtKAAKt1",
    "tCCCCtbEEtCCCCt1",
    "111a..abb...111.",
    "................",
    "................",
    "................",
    "................",
    "................"
  ],
  scroll_upgrade: [
    "................",
    "................",
    "................",
    "......yy........",
    ".....kyyk.......",
    "....kyyyyk......",
    "..kkkkyykkkk....",
    ".k00ttkyyktt00k.",
    "k000ttyyktt0000k",
    "k000ttyyktt0000k",
    "k00ttkyyktt0000k",
    ".k00ttkyyktt00k.",
    "..kkkkyykkkk....",
    "......yy........",
    "......kk........",
    "................"
  ],
  armor_cloth: [
    "................",
    "...jjja...jj1j..",
    ".1KKxtj111ahttha",
    "jhxKKhh1aa1thtKj",
    "jjhth13x3hxxh1hj",
    "kjj1jxKKh1xxKjj.",
    ".kjkhxtKhj3ttj..",
    "..j13KtKxhKxK1..",
    "..1h3KtK1mh3hX..",
    "..jhhthth1h1hj..",
    "..ahtKtKxhKt3j..",
    "..k11hhxma11Xk..",
    "...hhKhxt1thij..",
    "...j1hhth111X...",
    ".....jjjjjjz....",
    "................"
  ],
  gold: [
    "................",
    "................",
    "................",
    "......1JJ.......",
    "......hJJb......",
    "....1yoaVoD.....",
    "...hCDDyhDJoa...",
    "..hDDayyDDDDDD..",
    "tyoDCybDDDDJak..",
    "bbaDytbyytJoDJyD",
    ".DyombDDDbamDab.",
    ".DJD..JyJ..CoD..",
    "......DJD.......",
    "................",
    "................",
    "................"
  ],
  dewdrop: [
    "................",
    "................",
    "................",
    "................",
    "......11........",
    ".....1rr1.......",
    ".....rHHr.......",
    ".....rHrr.......",
    "......rrr.......",
    ".......r........",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................"
  ],
  seed: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "......bb........",
    ".....bYYb.......",
    ".....bYYb.......",
    "......bb........",
    ".......b........",
    "................",
    "................",
    "................",
    "................",
    "................"
  ],
  key_iron: [
    "................",
    "...XXj..........",
    ".qijjXj.........",
    ".qX..XX.........",
    "XX...XX.........",
    "jX..XXk.........",
    ".XXXXXXk........",
    ".kjjkkXX........",
    "......kXX.......",
    ".......kXX...X..",
    "........kXX.jX..",
    ".........kXiXXXj",
    "..........kXXXj.",
    "...........kXik.",
    "............kj..",
    "................"
  ],
  key_gold: [
    "................",
    "...YYj..........",
    ".qiyyYj.........",
    ".qY..YY.........",
    "YY...YY.........",
    "jY..YYk.........",
    ".YYYYYYk........",
    ".kjjkkYY........",
    "......kYY.......",
    ".......kYY...Y..",
    "........kYY.jY..",
    ".........kYiYYYj",
    "..........kYYYj.",
    "...........kYik.",
    "............kj..",
    "................"
  ],
  key_skeleton: [
    "................",
    ".1m11D..........",
    "D3111aD.........",
    "ahh3.11.........",
    "D13.XDD.........",
    "a13Xha1.........",
    "ma1D1hD.........",
    ".jmj1at1........",
    "......atD.......",
    ".......jtD...h..",
    "........jtD.mDa.",
    ".........aDtJjDD",
    "..........ktJta.",
    "............hh..",
    ".............j..",
    "................"
  ]
};
var REGION_TINTS = {
  sewers: {
    F: "#5da02e",
    f: "#4b7e2a",
    W: "#6e4c2c",
    w: "#74b53a"
  },
  prison: {
    F: "#6a7488",
    f: "#565e72",
    W: "#424a5e",
    w: "#5c6680"
  },
  caves: {
    F: "#6b5a48",
    f: "#57493a",
    W: "#453a2e",
    w: "#5f5142"
  },
  city: {
    F: "#9aa0ae",
    f: "#848a98",
    W: "#6e7488",
    w: "#8b91a3"
  },
  halls: {
    F: "#4a3f4a",
    f: "#3a3138",
    W: "#2e2430",
    w: "#4a3a44"
  }
};

// src/assets/original_sprites.ts
var ORIGINAL_SPRITES = {
  hero: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8AgICAAICAgACAgIAAAAAAAL45DP++OQz/vjkM/5cxDf8AAAAAgICAAAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wCXMQ3/lzEN/745DP/ceTf/3Hk3/9x5N//ceTf/lzEN/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wB1Kw7/rWk8/8RwOv/ceTf/3Hk3/9x5N//ceTf/3Hk3/8RwOv+XMQ3/AAAAAAAAAAAAAAAAAAAAAP///wD///8AAAAAAHUrDv/EcDr/3LSX///av///2r///9q////av/++f1n/lzEN/wAAAAAAAAAAAAAAAAAAAAD///8A////AHUrDv+taTz/uJd4/7iXeP8AAAD/uJd4/7iXeP8AAAD/hVk4/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AICAgACFWTj/rWk8/7iXeP/ctJf/uJd4/9y0l//ctJf/uJd4/75/Wf+AgIAAAAAAAAAAAAAAAAAAAAAAAP///wCAgIAAgICAAHUrDv+taTz/3LSX/9x5N//ceTf/3Hk3/9x5N/++f1n/gICAAAAAAAAAAAAAAAAAAAAAAAD///8AgICAAICAgAB1Kw7/rWk8/61pPP+XMQ3/lzEN/5cxDf+XMQ3/dSsO/4CAgAAAAAAAAAAAAAAAAAAAAAAA////AP///wCekob/ycG5//vy5//78uf/faPG/wBUpv/ctJf/AEaM/2tjW/////8AAAAAAAAAAAAAAAAAAAAAAP///wA9aJr/AFSm/wBUpv+ln5j/ycG5//vy5/+vwtP/AFSm/6/C0/9rY1v/////AAAAAAAAAAAAAAAAAAAAAAD///8AABNN/9y0l/++f1n/pZ+Y/8nBuf/78uf/+/Ln/32jxv/Jwbn/ABNN/////wAAAAAAAAAAAAAAAAAAAAAA////AP///wCFWTj/a2Nb/8nBuf/Jwbn/ycG5/8nBuf/Jwbn/ycG5/4VZOP////8AAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AJ6Shv/Jwbn/a2Nb/2tjW//35tH/ycG5/2tjW/////8A////AAAAAAAAAAAAAAAAAAAAAAD///8A////AJ6Shv+ln5j/a2Nb/////wD///8AnpKG/8nBuf+ekob/////AP///wAAAAAAAAAAAAAAAAAAAAAA////AP///wCFWTj/hVk4/4VZOP////8A////AIVZOP+FWTj/hVk4/////wD///8AAAAAAAAAAAAAAAAAAAAAAA==" },
  hero_warrior: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8AgICAAICAgACAgIAAAAAAAL45DP++OQz/vjkM/5cxDf8AAAAAgICAAAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wCXMQ3/lzEN/745DP/ceTf/3Hk3/9x5N//ceTf/lzEN/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wB1Kw7/rWk8/8RwOv/ceTf/3Hk3/9x5N//ceTf/3Hk3/8RwOv+XMQ3/AAAAAAAAAAAAAAAAAAAAAP///wD///8AAAAAAHUrDv/EcDr/3LSX///av///2r///9q////av/++f1n/lzEN/wAAAAAAAAAAAAAAAAAAAAD///8A////AHUrDv+taTz/uJd4/7iXeP8AAAD/uJd4/7iXeP8AAAD/hVk4/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AICAgACFWTj/rWk8/7iXeP/ctJf/uJd4/9y0l//ctJf/uJd4/75/Wf+AgIAAAAAAAAAAAAAAAAAAAAAAAP///wCAgIAAgICAAHUrDv+taTz/3LSX/9x5N//ceTf/3Hk3/9x5N/++f1n/gICAAAAAAAAAAAAAAAAAAAAAAAD///8AgICAAICAgAB1Kw7/rWk8/61pPP+XMQ3/lzEN/5cxDf+XMQ3/dSsO/4CAgAAAAAAAAAAAAAAAAAAAAAAA////AP///wCekob/ycG5//vy5//78uf/faPG/wBUpv/ctJf/AEaM/2tjW/////8AAAAAAAAAAAAAAAAAAAAAAP///wA9aJr/AFSm/wBUpv+ln5j/ycG5//vy5/+vwtP/AFSm/6/C0/9rY1v/////AAAAAAAAAAAAAAAAAAAAAAD///8AABNN/9y0l/++f1n/pZ+Y/8nBuf/78uf/+/Ln/32jxv/Jwbn/ABNN/////wAAAAAAAAAAAAAAAAAAAAAA////AP///wCFWTj/a2Nb/8nBuf/Jwbn/ycG5/8nBuf/Jwbn/ycG5/4VZOP////8AAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AJ6Shv/Jwbn/a2Nb/2tjW//35tH/ycG5/2tjW/////8A////AAAAAAAAAAAAAAAAAAAAAAD///8A////AJ6Shv+ln5j/a2Nb/////wD///8AnpKG/8nBuf+ekob/////AP///wAAAAAAAAAAAAAAAAAAAAAA////AP///wCFWTj/hVk4/4VZOP////8A////AIVZOP+FWTj/hVk4/////wD///8AAAAAAAAAAAAAAAAAAAAAAA==" },
  mob_rat: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AUjwm/1I8Jv8AAAAAUjwm/1I8Jv9SPCb/Ujwm/wAAAAD///8AgICAAICAgAD///8A////AP///wD///8A////AFI8Jv/MfoL/Ujwm/5F8Yv+RfGL/kXxi/5F8Yv9SPCb/AAAAAICAgACAgIAA////AP///wD///8A////AP///wAAAAAAUjwm/3NjT/9zY0///2dM/5F8Yv//Z0z/Ujwm/wAAAACAgIAAgICAAP///wD///8A////AP///wD///8AAAAAAFI8Jv9zY0//c2NP/3NjT/9zY0//kXxi/5F8Yv9SPCb/gICAAICAgAD///8A////AP///wD///8A////AFI8Jv+RfGL/c2NP/3NjT/9zY0//c2NP/3NjT/9zY0//Ujwm/4CAgACAgIAA////AP///wD///8A////AP///wBSPCb/kXxi/5F8Yv9zY0//VUg5/xwUDf8cFA3/HBQN/85PVf+AgIAAgICAAP///wD///8A////AP///wBSPCb/kXxi/3NjT/9zY0//c2NP/3NjT/9VSDn/HBQN/wAAAAAAAAAAgICAAICAgAD///8A////AP///wD///8AUjwm/3NjT/9zY0//c2NP/3NjT/+IQTb/c2NP/4hBNv8AAAAAAAAAAICAgACAgIAA////AP///wD///8A////ADQmGP9zY0//c2NP/1I8Jv9SPCb/kXxi/3NjT/+RfGL/Ujwm/wAAAACAgIAAgICAAP///wD///8A////AP///wAcFA3/VUg5/3NjT/9zY0//c2NP/1I8Jv9zY0//c2NP/1I8Jv8AAAAAgICAAICAgAD///8A////AP///wD///8AHBQN/1VIOf9VSDn/c2NP/3NjT/80Jhj/c2NP/1VIOf80Jhj/AAAAAICAgACAgIAA////APWYnf/1mJ3/5Y6T/8x+gv8cFA3/HBQN/xwUDf+jPkL/zk9V/xwUDf8cFA3/zk9V/wAAAACAgIAAgICAAA==" },
  mob_gnoll: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AP///wAkDQH/AAAAAP///wD///8AJA0B/wAAAAD///8A////AAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wD///8AJA0B/0AWA/+bWBz/m1gc/5tYHP+bWBz/AAAAAP///wAAAAAAAAAAAAAAAAAAAAAA////AP///wD///8AXCAE/4BLGv/HllT/x5ZU/8eWVP/HllT/x5ZU/5tYHP8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AJtYHP/HllT/x5ZU/8eWVP/HllT/x5ZU/8eWVP+bWBz/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wBhLgf/x5ZU/51sKv8AAAD/nWwq/51sKv8AAAD/YS4H/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wD///8AYS4H/51sKv+unYb/gnRc/66dhv+unYb/QjUh/yQNAf8kDQH/AAAAAAAAAAAAAAAAAAAAAP///wD///8A////AGEuB/+dbCr/rp2G/66dhv+unYb/rp2G/66dhv+unYb/d2FG/wAAAAAAAAAAAAAAAAAAAAD///8A////AP///wBhLgf/nWwq/4J0XP+unYb/d2FG/3dhRv93YUb/d2FG/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wCbWBz/x5ZU//fGhP/3xoT/3c64/93OuP+unYb/rp2G/2EuB/8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wCbWBz/x5ZU/66dhv+CdFz/rp2G/93OuP/dzrj/3c64/93OuP9hLgf/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8Am1gc/4BLGv9AFgP/gnRc/66dhv/dzrj/3c64/93OuP+unYb/JA0B/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AAAAAAAkDQH/JA0B/66dhv/dzrj/3c64/66dhv+unYb/rp2G/yQNAf8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wAAAAAA////AGEuB//HllT/YS4H/2EuB/9hLgf/x5ZU/2EuB/8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AAAAAABhLgf/JA0B/wAAAAAAAAAAAAAAAGEuB/9AFgP/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wAAAAAAAAAAACQNAf8kDQH/AAAAAAAAAAAAAAAAJA0B/yQNAf8AAAAAAAAAAAAAAAAAAAAAAAAAAA==" },
  mob_crab: { w: 16, h: 16, rgba: "////AICAgACAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAP///wCAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAICAgAD///8AgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAA////AP///wD/sqP/AAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wCAgIAAgICAAP///wD/sqP/9X5z/wAAAAD///8A////AP///wD///8A////AP///wD/sqP//7Kj//+yo/8AAAAAgICAAICAgAD///8A/7Kj/+tSSv8AAAAA61JK/wAAAAD///8A////AP///wD///8AAAAAAPV+c//1kYn/61JK/4CAgACAgIAA////AP+yo//rUkr/AAAAAOtSSv8AAAAA////AP///wD///8A61JK/wAAAAAAAAAA61JK/5c1L/+AgIAAgICAAP///wD1fnP/9ZGJ/+tSSv+XNS//AAAAAP///wD///8A////AAAAAADrUkr/lzUv//WRif+XNS//gICAAICAgAD///8AAAAAAOtSSv/EdG7/AAAAAAAAAAD///8A////AP///wAAAAAAAAAAAAAAAADrUkr/lzUv/4CAgACAgIAA////AAAAAAAAAAAA61JK/8R0bv8AAAAA/7Kj//+yo///sqP//7Kj/wAAAAD/1cz/lzUv/wAAAACAgIAAgICAAP///wD///8AAAAAAAAAAAD/sqP//7Kj///VzP/1kYn/9ZGJ//WRif//sqP//7Kj/wAAAAAAAAAAgICAAICAgAD///8A////AP///wDrUkr/9ZGJ//WRif/1kYn/AAAA//WRif8AAAD/9ZGJ//WRif/rUkr/AAAAAICAgACAgIAA////AP///wD///8Al1Iv/8SRbf/1ton/9baJ//W2if/1ton/9baJ//W2if/EkW3/l1Iv/wAAAACAgIAAgICAAP///wD///8A/7Kj//WRif+XUi//l1Iv/5dSL/+XUi//l1Iv/5dSL/+XUi//l1Iv//WRif/rUkr/gICAAICAgAD///8A////AOtSSv/EdG7/AAAAAJc1L//EdG7/AAAAAAAAAADEdG7/lzUv/wAAAADEdG7/61JK/4CAgACAgIAA////AP///wDrUkr/AAAAAAAAAACXNS//AAAAAAAAAAAAAAAAAAAAAJc1L/8AAAAAAAAAAOtSSv+AgIAAgICAAA==" },
  mob_swarm: { w: 16, h: 16, rgba: "////AP///wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wAAAAAAtLnlOpHo0UPC0ehD19P2OgAAAAAAAAAAAAAAAMG07Tqvt/BDiO37OgAAAAAAAAAAAAAAAP///wD///8AjfvXOsPr9U2O+O5NwOv4Tbbu6E3prLlQAAAAALTlqzrer7RjxL+qY831603P7co6AAAAAAAAAAD///8A////ANHk9EPryvVNsOXbTbny8k2ym4J6/3Fc//9xXP/4jIeQ/3Fc//9xXP/okqV6oMLdQwAAAAAAAAAA////AP///wDh6PBD7rnuTcrN0U2Atp96fh8U/7NZR///v7L//3Fc/7NZR///v7L//3Fc/92+oloAAAAAAAAAAP///wD///8AyunTOsrb9U2WybJ6aP+Y/34fFP+zWUf/s1lH//9xXP+zWUf/s1lH//9xXP/5r4lQAAAAAAAAAAD///8A////AAAAAACD2b9QQ6Ni/2KZdv9imXb/fh8U/34fFP8TExP/fh8U/34fFP/Dj25mAAAAAAAAAAAAAAAA////AP///wAAAAAAAAAAABMTE/9imXb/ExMT/2KZdv9imXb/Jlw3/xMTE/8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////ABMTE/8AAAAAJlw3/xMTE/8mXDf/Jlw3/////wATExP/////AP///wD///8A////AP///wD///8A////AP///wATExP/AAAAABMTE/8AAAAAgICAABMTE/////8A////ABMTE/////8A////AP///wD///8A////AP///wD///8A////AP///wATExP/ExMTAP///wD///8A////AP///wATExP/////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAAAzAAAAMwAAADMAAAAzAAAAMwAAADMAAAAzAAAAAP///wD///8A////AA==" },
  mob_skeleton: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wD///8Azs7O/87Ozv/Ozs7/zs7O/87Ozv/Ozs7/AAAAAP///wAAAAAAAAAAAAAAAAAAAAAA////AP///wD///8Azs7O/+Xl5f/l5eX/5eXl/+Xl5f/l5eX/5eXl/87Ozv////8AAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AKOjo//l5eX/s7Oz/7Ozs/+zs7P/s7Oz/7Ozs/9+fn7/////AAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wCjo6P/5eXl/+Xl5f8AAAD/5eXl/+Xl5f8AAAD/zs7O/////wAAAAAAAAAAAAAAAAAAAAAA////AP///wCAgIAAgICAAH5+fv/l5eX/5eXl/+Xl5f+zs7P/5eXl/87Ozv+AgIAAAAAAAAAAAAAAAAAAAAAAAP///wD///8AgICAAICAgACAgIAAfn5+/6Ojo//Ozs7/zs7O/6Ojo/+AgIAAgICAAAAAAAAAAAAAAAAAAAAAAAD///8A////AICAgACAgIAAgICAAICAgAB+fn7/gICAAICAgAB+fn7/gICAAICAgAAAAAAAAAAAAAAAAAAAAAAA////AP///wCAgIAAzs7O/87Ozv/l5eX/5eXl/+Xl5f/l5eX/zs7O/wAAAACAgIAAAAAAAAAAAAAAAAAAAAAAAP///wD///8Azs7O/wAAAAAAAAAAs7Oz/8zMzP/MzMz/zMzM/wAAAAB+fn7/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AKOjo//Ozs7/AAAAAAAAAACAgIAAfn5+/wAAAAB+fn7/fn5+/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wB+fn7/o6Oj/87Ozv/Ozs7/zs7O/87Ozv/Ozs7/zs7O/35+fv8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8AAAAAAAAAAACjo6P/AAAAAAAAAAAAAAAAzs7O/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AAAAAADOzs7/AAAAAAAAAAAAAAAAAAAAAM7Ozv8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wCjo6P/o6Oj/wAAAAAAAAAAgICAAICAgACjo6P/o6Oj/wAAAACAgIAAAAAAAAAAAAAAAAAAAAAAAA==" },
  mob_thief: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wD///8A////AApfEv8KXxL/Cl8S/wpfEv8KXxL/BjoN/wY6Df8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AApfEv8znEP/KHo6/wY6Df8GOg3/BjoN/wY6Df8GOg3/BjoN/wAAAAAAAAAAAAAAAAAAAAD///8A////AApfEv8znEP/KHo6/wY6Df91aF7/dWhe/3VoXv91aF7/ZVZL/wY6Df8AAAAAAAAAAAAAAAAAAAAA////AP///wAKXxL/KHo6/wY6Df95Zlb//////3lmVv95Zlb//////3lmVv8GOg3/AAAAAAAAAAAAAAAAAAAAAP///wD///8ABjoN/wY6Df+Ic2D/o4p4/4hzYP+jinj/iHNg/4hzYP+jinj/BjoN/wAAAAAAAAAAAAAAAAAAAAD///8A////AAY6Df8GOg3/l4Br/7Wahv+1mob/tZqG/5eAa/+1mob/tZqG/wY6Df8AAAAAAAAAAAAAAAAAAAAA////AP///wAAAAAABycO/wY6Df+XgGv/tZqG/7Wahv+1mob/tZqG/wY6Df8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8ACl8S/yh6Ov8oejr/BjoN/wcnDv8HJw7/BycO/wY6Df8GOg3/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8ACl8S/yh6Ov8oejr/KHo6/yh6Ov8oejr/KmQ8/wcnDv8oejr/BjoN/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AApfEv8GOg3/Cl8S/7Wahv///////////yh6Ov8HJw7/KHo6/wY6Df8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wAGOg3/KHo6/wcnDv+XgGv/KHo6/yh6Ov8oejr/BjoN/yh6Ov8GOg3/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8ABjoN/yh6Ov8qZDz/KmQ8/yh6Ov8oejr/KHo6/wY6Df8oejr/BjoN/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AAcnDv8HJw7/BycO/wcnDv8HJw7/BycO/wY6Df8GOg3/BjoN/wY6Df8AAAAAAAAAAAAAAAAAAAAAAAAAAA==" },
  mob_goo: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAGBgb/BgYG/wYGBv8GBgb/AAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AAYGBv8GBgb/JiYm/yYmJv8mJib/JiYm/wYGBv8GBgb/AAAAAP///wD///8A////AP///wD///8A////AAYGBv8mJib/gICA/4CAgP+AgID/gICA/yYmJv8mJib/JiYm/wYGBv8AAAAA////AP///wD///8A////AP///wAGBgb/gICA/4CAgP+AgID/gICA/4CAgP+AgID/JiYm/yYmJv8GBgb/AAAAAP///wD///8A////AP///wD///8ABgYG/4CAgP+AgID/gICA/4CAgP+AgID/JiYm/yYmJv8mJib/BgYG/wAAAAD///8A////AP///wD///8ABgYG/yYmJv8mJib/gICA/4CAgP+AgID/JiYm/yYmJv8mJib/JiYm/yYmJv8AAAD/////AP///wD///8A////AAYGBv8mJib/JiYm/yYmJv8mJib/JiYm/yYmJv8mJib/JiYm/yYmJv8mJib/AAAA/////wD///8A////AP///wAGBgb/JiYm/yYmJv8mJib/JiYm/yYmJv8mJib/JiYm/yYmJv8mJib/JiYm/wAAAP////8A////AP///wAAAAD/JiYm/yYmJv8mJib/JiYm/yYmJv8mJib/JiYm/yYmJv8mJib/JiYm/yYmJv8AAAD/////AP///wD///8AAAAA/wAAAP8mJib/JiYm/yYmJv8mJib/JiYm/yYmJv8mJib/JiYm/yYmJv8AAAD/AAAA/////wD///8A////AAAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP////8A////AP///wAAAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/////AP///wD///8AAAAAAAAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/w==" },
  mob_shaman: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AP///wAXDgb/AAAAAP///wD///8AFw4G/wAAAAD///8A////AAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wD///8AFw4G/ykZCv+3gjH/t4Ix/7eCMf+3gjH/nWwq/51sKv8AAAAAAAAAAAAAAAAAAAAA////AP///wD///8AOiMP/2ZQM/+qlnH/q0kg/8pINv/KSDb/0Yhb/7lAMP+GEAn/AAAAAAAAAAAAAAAAAAAAAP///wD///8A////AHFYMv+qlnH/qpZx/6AUC/8AAAD/AAAA/8pINv8AAAD/AAAA/wAAAAAAAAAAAAAAAAAAAAD///8A////AP///wBALhT/qpZx/4BsR/+rSSD/ykg2/8pINv/RiFv/uUAw/4YQCf8AAAAAAAAAAAAAAAAAAAAA////AP///wD///8AQC4U/4BsR/+unYb/t4Ix/9i2cP/YtnD/0Yhb/61zSv+dbCr/AAAAAAAAAAAAAAAAAAAAAP///wD///8A////AEAuFP+AbEf/rp2G/7eCMf/YtnD/0Yhb/wAAAP8AAAD/dTQV/wAAAAAAAAAAAAAAAAAAAAD///8A////AP///wBALhT/gGxH/4J0XP+unYb/t4Ix/7eCMf+rSSD/dTQV/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wBxWDL/qpZx/9rGof/axqH/3c64/93OuP+unYb/rp2G/0AuFP8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wBxWDL/qpZx/66dhv+CdFz/rp2G/93OuP/dzrj/3c64/93OuP9ALhT/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8AcVgy/2ZQM/8pGQr/gnRc/66dhv/dzrj/3c64/93OuP+unYb/Fw4G/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AAAAAAAXDgb/Fw4G/66dhv/dzrj/3c64/66dhv+unYb/rp2G/xcOBv8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wAAAAAA////AEAuFP+qlnH/QC4U/0AuFP9ALhT/qpZx/0AuFP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AAAAAABALhT/Fw4G/wAAAAAAAAAAAAAAAEAuFP8pGQr/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wAAAAAAAAAAABcOBv8XDgb/AAAAAAAAAAAAAAAAFw4G/xcOBv8AAAAAAAAAAAAAAAAAAAAAAAAAAA==" },
  mob_bat: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAAAAGhoa/xoaGv8zAAgAMwAIADMACAAzAAgAAAAA/zMACAAzAAgAAAAA/zMACAAzAAgAMwAIABoaGv8aGhr/AAAAABoaGgAAAAD/Ghoa/xoaGv8zAAgAMwAIAAAAAP8zAAgAMwAIAAAAAP8zAAgAGhoa/xoaGv8AAAD/MwAIAAAAAAAaGhoAMwAI/zMACP8AAAD/Ghoa/zMACAAAAAD/Ghoa/xoaGv8AAAD/Ghoa/wAAAP8zAAj/MwAI/zMACAAAAAAA////ADMACAAzAAj/MwAI/wAAAP8aGhr/AAAA//8zM/8AAAD//zMz/wAAAP8zAAj/MwAI/zMACAAzAAgAAAAAAP///wAzAAgAMwAI/zMACP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8zAAj/MwAI/zMACP8zAAgAMwAIAAAAAAD///8AMwAIADMACAAzAAj/MwAI/wAAAP8AAAD/AAAA/wAAAP8AAAD/MwAI/zMACP8zAAgAMwAIADMACAAAAAAA////ADMACAAzAAgAMwAI/zMACAAAAAD/AAAA/wAAAP8AAAD/AAAA/zMACAAzAAj/MwAIADMACAAzAAgAAAAAAP///wAzAAgAMwAIADMACAAzAAgAMwAIAAAAAP8AAAD/AAAA/zMACAAzAAgAMwAIADMACAAzAAgAMwAIAAAAAAD///8AMwAIADMACAAzAAgAMwAIADMACAAzAAgAMwAIADMACAAzAAgAMwAIADMACAAzAAgAMwAIADMACAAAAAAA////ADMACAAzAAgAMwAIADMACAAzAAgAMwAIADMACAAzAAgAMwAIADMACAAzAAgAMwAIADMACAAzAAgAAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAAAA////AP///wD///8A////AAAAADMAAAAzAAAAMwAAADMAAAAzAAAAMwAAADP///8A////AP///wD///8AAAAAAA==" },
  mob_brute: { w: 16, h: 16, rgba: "////AP///wD///8A////AFJSUv9SUlL/UlJS/1JSUv8wMDD/FRUV/wAAAAD///8AAAAAAAAAAAAAAAAAAAAAAP///wD///8A////ABUVFf9vb2//kZGR/5GRkf9vb2//b29v/0pKSv8VFRX/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wAVFRX/b29v/5GRkf+RkZH/b29v/29vb/9KSkr/FRUV/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wD///8AFRUV/29vb/+RkZH/kZGR/29vb/9vb2//SkpK/xUVFf8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////ABUVFf9vb2//ei8Z/wAAAP96Lxn/ei8Z/wAAAP86CQL/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wAVFRX/b29v/66dhv+CdFz/rp2G/66dhv9CNSH/IAUB/yAFAf8AAAAAAAAAAAAAAAAAAAAA////AP///wD///8AFRUV/5ZLKP+unYb/rp2G/66dhv+unYb/rp2G/66dhv93YUb/AAAAAAAAAAAAAAAAAAAAAP///wD///8A////AFgWBv+WSyj/gnRc/66dhv93YUb/d2FG/3dhRv93YUb/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AI40Gf++c1D/66F+/+uhfv/dzrj/3c64/66dhv+unYb/WBYG/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AI40Gf++c1D/rp2G/4J0XP+unYb/3c64/93OuP/dzrj/3c64/1gWBv8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wCONBn/ei8Z/zoJAv+CdFz/rp2G/93OuP/dzrj/3c64/66dhv8gBQH/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8AAAAAACAFAf8gBQH/rp2G/93OuP/dzrj/3c64/93OuP+unYb/IAUB/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AAAAAAD///8AWxMF/66dhv/dzrj/3c64/66dhv+unYb/WBYG/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wAAAAAA////AFsTBf++c1D/WBYG/1gWBv9YFgb/vnNQ/1gWBv8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AAAAAABYFgb/IAUB/wAAAAAAAAAAAAAAAFgWBv86CQL/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wAAAAAAAAAAACAFAf8gBQH/AAAAAAAAAAAAAAAAIAUB/yAFAf8AAAAAAAAAAAAAAAAAAAAAAAAAAA==" },
  mob_tengu: { w: 16, h: 16, rgba: "////AP///wD///8A////AAsJCP8LCQj/CwkI/wsJCP8LCQj/AAAAAP///wD///8A////AICAgAAAAAAAAAAAAP///wD///8A////AAsJCP82Ly3/wszM/9rm5v/a5ub/wszM/5Sjo/8AAAAA////AP///wCAgIAAAAAAAAAAAAD///8A////AP///wALCQj/Ni8t/9rm5v8AAAD/AAAA/wAAAP8AAAD/AAAAAP///wD///8AgICAAAAAAAAAAAAA////AP///wD///8ACwkI/yYjIv/a5ub/2ubm/9rm5v8AAAD/lKOj/wAAAAD///8A////AICAgAAAAAAAAAAAAP///wD///8A////AAsJCP8mIyL/2ubm/9rm5v/a5ub/AAAA/5Sjo/8AAAAA////AP///wCAgIAAAAAAAAAAAAD///8A////AP///wALCQj/JiMi/yYjIv/a5ub/2ubm/8LMzP+Uo6P/AAAAAP///wD///8AgICAAAAAAAAAAAAA////AP///wDPDQL/5jkX/zYvLf8mIyL/JiMi/yYjIv8mIyL/5jkX/88NAv8AAAAA////AICAgAAAAAAAAAAAAP///wALCQj/Ni8t/zYvLf82Ly3/Ni8t/7Wahv+1mob/5jkX/7M7JP82Ly3/CwkI/wAAAACAgIAAAAAAAAAAAAD///8AAAAAAAYFBf8GBQX/BgUF/wYFBf+ZiHr/mYh6/+Y5F/+zOyT/BgUF/zYvLf+1mob/tZqG/wAAAAAAAAAA////AAAAAAAAAAAAAAAAAH4OBf/mORf/5jkX/+Y5F/+zOyT/fg4F/wAAAAAGBQX/mYh6/5mIev8AAAAAAAAAAP///wAAAAAAAAAAAAAAAAB+DgX/fg4F/34OBf9+DgX/fg4F/34OBf8AAAAAAAAAAAAAAACAgIAAAAAAAAAAAAD///8A////AP///wALCQj/Ni8t/yYjIv/mORf/5jkX/7M7JP82Ly3/CwkI/wAAAAAAAAAAgICAAAAAAAAAAAAA////AP///wALCQj/Ni8t/yYjIv8GBQX/5jkX/+Y5F/+zOyT/JiMi/zYvLf8LCQj/AAAAAICAgAAAAAAAAAAAAP///wD///8Azw0C/7M7JP8GBQX/AAAAAOY5F//mORf/szsk/wYFBf+zOyT/zw0C/wAAAACAgIAAAAAAAAAAAAD///8A////AM8NAv9+DgX/AAAAAAAAAAAAAAAA////AP///wAAAAAAfg4F/88NAv8AAAAAgICAAAAAAAAAAAAA////AAsJCP8LCQj/CwkI/wAAAAAAAAAA////AP///wD///8AAAAAAAsJCP8LCQj/CwkI/4CAgAAAAAAAAAAAAA==" },
  mob_albino: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wB+fn7/fn5+/wAAAAB+fn7/fn5+/35+fv9+fn7/AAAAAP///wCBgYEAgYGBAIGBgQD///8A////AP///wD///8Afn5+/+N/g/9+fn7/0tLS/9LS0v/S0tL/0tLS/35+fv8AAAAAgYGBAIGBgQCBgYEA////AP///wD///8A////AAAAAAB+fn7/tLS0/7S0tP//Z0n/0tLS//9nSf9+fn7/AAAAAIGBgQCBgYEAgYGBAP///wD///8A////AP///wAAAAAAfn5+/7S0tP+0tLT/tLS0/7S0tP/S0tL/0tLS/35+fv+BgYEAgYGBAIGBgQD///8A////AP///wD///8Afn5+/9LS0v+0tLT/tLS0/7S0tP+0tLT/tLS0/7S0tP9+fn7/gYGBAIGBgQCBgYEA////AP///wD///8A////AH5+fv/S0tL/0tLS/7S0tP+EhIT/Tk5O/05OTv9OTk7/mlRY/4GBgQCBgYEAgYGBAP///wD///8A////AH5+fv/S0tL/tLS0/7S0tP+0tLT/tLS0/4SEhP9OTk7/AAAAAAAAAACBgYEAgYGBAIGBgQD///8A////AP///wB+fn7/tLS0/7S0tP+0tLT/tLS0/3xMRP+0tLT/fExE/wAAAAAAAAAAgYGBAIGBgQCBgYEA////AP///wD///8Aa2tr/7S0tP+0tLT/fn5+/35+fv/S0tL/tLS0/9LS0v9+fn7/AAAAAIGBgQCBgYEAgYGBAP///wD///8A////AE5OTv+EhIT/tLS0/7S0tP+0tLT/fn5+/7S0tP+0tLT/fn5+/wAAAACBgYEAgYGBAIGBgQD///8A////AP///wBOTk7/hISE/4SEhP+0tLT/tLS0/2tra/+0tLT/hISE/2tra/8AAAAAgYGBAIGBgQCBgYEA/5mf//+Zn//+j5X/43+D/05OTv9OTk7/Tk5O/4lLTf+aVFj/Tk5O/05OTv+aVFj/AAAAAIGBgQCBgYEAgYGBAA==" },
  mob_bandit: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wD///8A////AF8KTf9fCk3/XwpN/18KTf9fCk3/OgYq/zoGKv8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AF8KTf+cM4z/eiho/zoGKv86Bir/OgYq/zoGKv86Bir/OgYq/wAAAAAAAAAAAAAAAAAAAAD///8A////AF8KTf+cM4z/eiho/zoGKv91aF7/dWhe/3VoXv91aF7/ZVZL/zoGKv8AAAAAAAAAAAAAAAAAAAAA////AP///wBfCk3/eiho/zoGKv95Zlb//////3lmVv95Zlb//////3lmVv86Bir/AAAAAAAAAAAAAAAAAAAAAP///wD///8AOgYq/zoGKv+Ic2D/o4p4/4hzYP+jinj/iHNg/4hzYP+jinj/OgYq/wAAAAAAAAAAAAAAAAAAAAD///8A////ADoGKv86Bir/l4Br/7Wahv+1mob/tZqG/5eAa/+1mob/tZqG/zoGKv8AAAAAAAAAAAAAAAAAAAAA////AP///wAAAAAAJwca/zoGKv+XgGv/tZqG/7Wahv+1mob/tZqG/zoGKv8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8AXwpN/3ooaP96KGj/OgYq/ycHGv8nBxr/Jwca/zoGKv86Bir/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8AXwpN/3ooaP96KGj/eiho/3ooaP96KGj/ZCpS/ycHGv96KGj/OgYq/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AF8KTf86Bir/XwpN/7Wahv///////////3ooaP8nBxr/eiho/zoGKv8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wA6Bir/eiho/ycHGv+XgGv/eiho/3ooaP96KGj/OgYq/3ooaP86Bir/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8AOgYq/3ooaP9kKlL/ZCpS/3ooaP96KGj/eiho/zoGKv96KGj/OgYq/wAAAAAAAAAAAAAAAAAAAAAAAAAA////ACcHGv8nBxr/Jwca/ycHGv8nBxr/Jwca/zoGKv86Bir/OgYq/zoGKv8AAAAAAAAAAAAAAAAAAAAAAAAAAA==" },
  mob_shielded: { w: 16, h: 16, rgba: "////AP///wD///8A////AFFRUf9RUVH/UVFR/1FRUf8sLCz/DQ0N/wAAAAD///8AAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AA0NDf9wcHD/kpKS/5KSkv9wcHD/cHBw/0lJSf8NDQ3/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wANDQ3/cHBw/5KSkv+SkpL/cHBw/3BwcP9JSUn/DQ0N/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wD///8ADQ0N/3BwcP+SkpL/kpKS/3BwcP9wcHD/SUlJ/w0NDf8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AA0NDf9wcHD/jSsQ/wAAAP+NKxD/jSsQ/wAAAP9BBAH/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wANDQ3/cHBw/7aehv+IdVr/tp6G/7aehv9FMhr/IAIA/yACAP8AAAAAAAAAAAAAAAAAAAAA////AP///wD///8ADQ0N/6tKIf+2nob/tp6G/7aehv+2nob/tp6G/7aehv+AYUP/AAAAAAAAAAAAAAAAAAAAAP///wD///8A////AGYOAv+rSiH/iHVa/7aehv+AYUP/gGFD/4BhQ/+AYUP/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AKUxEP/VdE3//6J9//+iff/jz7j/48+4/5KSkv9wcHD/DQ0N/w0NDf8AAAAAAAAAAAAAAAAAAAAA////AKUxEP/VdE3/tp6G/4h1Wv+2nob/48+4/+PPuP+SkpL/cHBw/0lJSf8NDQ3/AAAAAAAAAAAAAAAAAAAAAP///wClMRD/jSsQ/0EEAf+IdVr/tp6G/+PPuP/jz7j/UVFR/3BwcP9JSUn/DQ0N/wAAAAAAAAAAAAAAAAAAAAD///8AAAAAACACAP8gAgD/tp6G/+PPuP/jz7j/48+4/1FRUf9wcHD/SUlJ/w0NDf8AAAAAAAAAAAAAAAAAAAAA////AAAAAAD///8AagsC/7aehv/jz7j/48+4/7aehv+2nob/LCws/w0NDf8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wAAAAAA////AGoLAv/VdE3/Zg4C/2YOAv9mDgL/1XRN/2YOAv8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AAAAAABmDgL/IAIA/wAAAAAAAAAAAAAAAGYOAv9BBAH/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wAAAAAAAAAAACACAP8gAgD/AAAAAAAAAAAAAAAAIAIA/yACAP8AAAAAAAAAAAAAAAAAAAAAAAAAAA==" },
  mob_shopkeeper: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wD///8Aw4Jm//+5mP//uZj//7mY//+5mP/Dgmb/AAAAAP///wD///8A////AAAAAAAAAAAA////AP///wD///8AKQ4A/9+2of//2cX//9nF///Zxf//2cX//9nF/8OCZv8AAAAA////AP///wAAAAAAAAAAAP///wD///8A////ACkOAP99SQD/37ah///Zxf//2cX//9nF///Zxf/Dgmb/AAAAAP///wD///8AAAAAAAAAAAD///8A////AP///wApDgD/fUkA/7+chf8AAAD/v5yF/7+chf8AAAD/j19F/wAAAAD///8A////AAAAAAAAAAAA////AP///wCPX0X/v5yF/31JAP/ftqH/v5yF/9+2of/ftqH/v5yF/8OCZv8AAAAA////AP///wAAAAAAAAAAAP///wD///8AAAAAAI9fRf9mPAD/37ah/31JAP99SQD/fUkA/31JAP/Dgmb/AAAAAP///wD///8AAAAAAAAAAAD///8A////AAAAAACPX0X/ZjwA/2Y8AP9mPAD/37ah/9+2of8pDgD/AAAAAAAAAAD///8A////AAAAAAAAAAAA////ANHo6P8KCgn/MzMw/xoaGP8aGhj/ztnZ/87Z2f/O2dn/ztnZ/wMDAv/R6Oj/AAAAAP///wAAAAAAAAAAANHo6P/O2dn/ztnZ/wAAAP8aGhj/GhoY/xoaGP/n8/P/5/Pz/xoaGP8AAAD/ztnZ/9Ho6P8AAAAAAAAAAAAAAACmubn/37ah/9+2of8AAAD/AAAA/xoaGP8aGhj/5/Pz/+fz8/8aGhj/AAAA/6a5uf+mubn/w4Jm/wAAAAAAAAAAAAAAAI9fRf8ARVn/AEVZ/wAAAP8AAAD/AAAA/wBYcv8AWHL/AAAA/wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADFC/wBYcv8AWHL/ADFC/wAxQv8AMUL/AEVZ/wBYcv8AMUL/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8AAAAAAABBWf8AWHL/ADFC/wAAAAAAAAAAAAAAAAAxQv8AWHL/ADFC/wAAAAAAAAAA////AAAAAAAAAAAA////AP///wAAAAD/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAAAP8AAAAA////AP///wAAAAAAAAAAAA==" },
  mob_ghost: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAAAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAAAAAAA////AP///wD///8A////AP///2b///9m////Zv///2b///9m////Zv///wD///8A////AP///wAAAAAAAAAAAP///wD///8A////AP///2b///9m////Zv////////////////////////9m////AP///wD///8AAAAAAAAAAAD///8A////AP///wD///9m////Zv////8AAAD///////////8AAAD/////Zv///wD///8A////AAAAAAAAAAAA////AP///wD///8A////Zv///2b//////////////////////////////2b///8A////AP///wAAAAAAAAAAAP///wD///8A////AP///2b///9m//////////8AAAD//////////2b///8A////AP///wD///8AAAAAAAAAAAD///9m////Zv///2b///9m////Zv///2b//////////////2b///9m////Zv///2b///9m////ZgAAAAAAAAAA////Zv///wD///9m////Zv///2b///9m////Zv///2b///9m////Zv///2b///9m////AP///2YAAAAAAAAAAP///wD///8A////Zv///wD///9m////Zv///2b///9m////Zv///2b///8A////Zv///wD///8AAAAAAAAAAAD///8A////AP///wD///8A////AP///2b///9m////Zv///2b///8A////AP///wD///8A////AAAAAAAAAAAA////AP///wD///8A////AP///2b///9m////Zv///wD///8A////AP///wD///8A////AP///wAAAAAAAAAAAP///wD///8A////AP///2b///9m////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAAAAAAAD///8A////AP///wD///9m////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAAAAAAA////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAAAAAAAAAA==" },
  mob_wandmaker: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AGxsbP8AAAAAvn9Z//+6j///uo///7qP//+6j/++f1n/bGxs/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wBsbGz/bGxs/9y0l///2r///9q////av///2r///9q//75/Wf8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8ATU1N/6ampv+mpqb/3LSX/7+/v/+/v7//v7+//7+/v/++f1n/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AAAAAABNTU3/uJd4/7iXeP8AAAD/uJd4/7iXeP8AAAD/hVk4/wAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wCFWTj/uJd4/7iXeP/ctJf/3LSX/9y0l/+4l3j/3LSX/75/Wf8AAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8AAAAAAIVZOP+4l3j/3LSX/4yMjP+MjIz/jIyM/4yMjP++f1n/AAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AAAAAACAgIAAhVk4/7iXeP/ctJf/3LSX/9y0l/++f1n/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////AP///wD///8Aow8P/34FBf+zJCT/v1km///////l5eX/pk0h/1wBAf+AgIAAAAAAAAAAAAAAAAAAAAAAAP///wD///8Aow8P/7MkJP+zJCT/mQ8P/79ZJv/l5eX/5eXl/79ZJv9cAQH/gICAAAAAAAAAAAAAAAAAAAAAAAD///8A////AH4FBf/ctJf/vn9Z/5kPD/+/WSb//8CH///Ah/+/WSb/XAEB/4CAgAAAAAAAAAAAAAAAAAAAAAAA////AP///wD///8AhVk4/1wBAf+zJCT/v1km/6Z8Uv+mfFL/v1km/4VZOP+AgIAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AP///wB+BQX/fgUF/48fBv80HAz/jGhF/48fBv////8AgICAAAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wDOzs7/zMzM/6Ojo/8AAAAAzs7O/+Xl5f/Ozs7/////AICAgAAAAAAAAAAAAAAAAAAAAAAA////AP///wD///8ANBwM/zQcDP80HAz/AAAAADQcDP80HAz/NBwM/////wCAgIAAAAAAAAAAAAAAAAAAAAAAAA==" },
  mob_fetidrat: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AUjwm/1I8Jv8AAAAAUjwm/1I8Jv9SPCb/Ujwm/wAAAAD///8AgICAAICAgAD///8A////AP///wD///8A////AFI8Jv/MfoL/Ujwm/5F8Yv+RfGL/kXxi/5F8Yv9SPCb/AAAAAICAgACAgIAA////AP///wD///8A////AP///wAAAAAAUjwm/3NjT/9zY0///2dM/5F8Yv//Z0z/Ujwm/wAAAACAgIAAgICAAP///wD///8A////AP///wD///8AAAAAAFI8Jv9zY0//c2NP/3NjT/9zY0//kXxi/5F8Yv9SPCb/gICAAICAgAD///8A////AP///wD///8A////AFI8Jv+RfGL/c2NP/3NjT/9zY0//c2NP/3NjT/9zY0//Ujwm/4CAgACAgIAA////AP///wD///8A////AP///wBSPCb/kXxi/5F8Yv9zY0//VUg5/xwUDf8cFA3/HBQN/85PVf+AgIAAgICAAP///wD///8A////AP///wBSPCb/kXxi/3NjT/9zY0//c2NP/3NjT/9VSDn/HBQN/wAAAAAAAAAAgICAAICAgAD///8A////AP///wD///8AUjwm/3NjT/9zY0//c2NP/3NjT/+IQTb/c2NP/4hBNv8AAAAAAAAAAICAgACAgIAA////AP///wD///8A////ADQmGP9zY0//c2NP/1I8Jv9SPCb/kXxi/3NjT/+RfGL/Ujwm/wAAAACAgIAAgICAAP///wD///8A////AP///wAcFA3/VUg5/3NjT/9zY0//c2NP/1I8Jv9zY0//c2NP/1I8Jv8AAAAAgICAAICAgAD///8A////AP///wD///8AHBQN/1VIOf9VSDn/c2NP/3NjT/80Jhj/c2NP/1VIOf80Jhj/AAAAAICAgACAgIAA////APWYnf/1mJ3/5Y6T/8x+gv8cFA3/HBQN/xwUDf+jPkL/zk9V/xwUDf8cFA3/zk9V/wAAAACAgIAAgICAAA==" },
  mob_curse: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAAAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAAAAAAA////AP///wD///8A////AAAAAIAAAACAAAAAgAAAAIAAAACAAAAAgP///wD///8A////AP///wAAAAAAAAAAAP///wD///8A////AAAAAIAAAACAAAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAAAP///wD///8AAAAAAAAAAAD///8A////AP///wAAAACAAAAAgAAAAP//////AAAA/wAAAP//////AAAA/wAAAAD///8A////AAAAAAAAAAAA////AP///wD///8AAAAAgAAAAIAAAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAAA////AP///wAAAAAAAAAAAP///wD///8A////AAAAAIAAAACAAAAAgAAAAP8AAAD/AAAA/wAAAP////8AAAAAAP///wD///8AAAAAAAAAAAAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAA/wAAAP8AAAD/AAAAgAAAAIAAAACAAAAAgAAAAAAAAAAAAAAAgP///wAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAgP///wAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAACAAAAAgAAAAIAAAAAAAAAAAP///wAAAAAAAAAAAAAAAAAAAAAA////AP///wAAAAAAAAAAAAAAAIAAAACAAAAAgAAAAAAAAAAA////AP///wD///8AAAAAAP///wAAAAAAAAAAAP///wD///8AAAAAAAAAAIAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8AAAAAAAAAAAD///8A////AP///wAAAACAAAAAAAAAAAAAAAAAAAAAAP///wD///8AAAAAAAAAAAD///8A////AAAAAAAAAAAA////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAAAAAAAAAA==" },
  rose: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbsOnH/7Dpx/+w6cf8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGbsOnH/shNH/7ITR/+yE0f/shNH/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmshNH/7ITR//sOnH/7Dpx/+w6cf/sOnH/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZrITR//sOnH/shNH/7ITR/+yE0f/7Dpx/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGayE0f/shNH/7ITR/+yE0f/shNH/7ITR/8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wAAAABmAAAAZrITR/+yE0f/shNH/7ITR/9GWQD/hX0A/4V9AP8AAABmhX0AAP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmZmYA/2ZmAP8AAABmAAAAZoV9AAD///8A////AP///wD///8A////AP///wC5ADcAshNHALITRwAAAABmZmYA/wAAAGYAAABmhX0A/wAAAGaFfQAA////AP///wD///8A////AP///wD///8A////AP///wC5ADcAAAAAZgAAAGYAAABmAAAAZoV9AP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmhX0A/wAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AZmYAAGZmAABmZgAAAAAAZgAAAGaFfQD/hX0A/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGZmZgD/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AhnwAAIV9AAAAAABmAAAAZgAAAGaGfAAA////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wCGfAAAhnwAAGZmAABmZgAAhnwAAA==" },
  skull: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGb//fL///3y///98v///fL///3y/wAAAGYAAABmAAAAAP///wD///8A////AAAAAGYAAABmAAAAZv/98v///fL/5+PP/+fjz//n48//5+PP/+fjz//n48//AAAAZgAAAGb///8AAAAAZgAAAGYAAABm//3y///98v/n48//trGi/4J+c/+CfnP/trGi/+fjz//n48//5+PP/7axov8AAABmAAAAZgAAAGb//fL///3y/+fjz//n48//5+PP/4J+c/+CfnP/gn5z/4J+c//n48//5+PP/+fjz/+2saL/AAAAZgAAAGb//fL/5+PP/+fjz/+2saL/trGi/7axov+2saL/trGi/4J+c/+CfnP/5+PP/7axov+2saL/trGi/wAAAGYAAABm//3y/+fjz/8AAABmAAAAZgAAAGYAAABmAAAAZraxov/n48//5+PP/7axov+2saL/AAAAZgAAAGYAAABmAAAAZgAAAGbn48//AAAAZgAAAGYAAABm////AAAAAGYAAABm5+PP/7axov+2saL/AAAAZgAAAGa2saIA////AP///wAAAABmAAAAZgAAAGbn48//AAAAZgAAAGYAAABmtrGi/7axov+2saL/AAAAZgAAAGb///8AtrGiAAAAAAD///8A////AP///wAAAABmtrGi/7axov+2saL/trGi/7axov8AAABmAAAAZgAAAGYAAAAAAAAAAP///wAAAAAA////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  dust: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZuvr6//r6+v/0NDQ/9DQ0P8AAABmlZWV/wAAAGb///8A////AP///wD///8A////AP///wAAAABmAAAAZuvr6//r6+v/0NDQ/9DQ0P+xsbH/sbGx/wAAAGYAAABm////AP///wD///8A////AP///wD///8AAAAAZtDQ0P/r6+v/0NDQ/7Gxsf+xsbH/sbGx/7Gxsf+VlZX/AAAAZv///wD///8A////AP///wD///8AAAAAZgAAAGbQ0ND/0NDQ/9DQ0P+xsbH/lZWV/7Gxsf+xsbH/lZWV/wAAAGb///8A////AP///wD///8A////AAAAAGaxsbH/0NDQ/9DQ0P+xsbH/0NDQ/5WVlf+VlZX/lZWV/3Z2dv8AAABm////AP///wD///8A////AP///wAAAABmAAAAZtDQ0P/Q0ND/sbGx/7Gxsf+VlZX/lZWV/5WVlf+VlZX/AAAAZgAAAGb///8A////AP///wD///8A////AAAAAGYAAABmsbGx/7Gxsf+VlZX/lZWV/3Z2dv+VlZX/dnZ2/3Z2dv8AAABm////AP///wD///8A////AP///wD///8AAAAAZgAAAGaxsbH/lZWV/5WVlf92dnb/AAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGZ2dnb/AAAAZgAAAGZ2dnYAdnZ2AHZ2dgD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  phantom: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbKysrCysrKwgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGbKysrCcaGWowAAAGYAAABm////AAAAAGYAAABmAAAAZv///wD///8A////AP///wAAAABmAAAAZsrKysLKysrCysrKwsrKysLKysrCAAAAZgAAAGYAAABmysrKwgAAAGb///8A////AP///wAAAABmAAAAZsrKysJxoZaj/////3GhlqMAAABmcaGWo8rKysIAAABmysrKwoGBo6MAAABm////AP///wD///8AAAAAZsrKysJxoZajAAAAZgAAAGYAAABmAAAAZgAAAGZxoZajysrKwsrKysIAAABmAAAAZv///wD///8A////AAAAAGYAAABmysrKwsrKysIAAABmAAAAZgAAAGaBgaOjysrKwgAAAGZxoZajysrKwgAAAGb///8A////AP///wD///8AAAAAZgAAAGYAAABmysrKwsrKysLKysrCysrKwgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmysrKwgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  seed_rotberry: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AMDAwAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABm25BT/9uQU//bkFP/AAAAZgAAAGYwMDAAMDAwAP///wD///8A////AP///wD///8AAAAAZgAAAGbbkFP/25BT/9uQU//bkFP/25BT/9uQU/8AAABmbFlIADAwMAD///8A////AP///wD///8A////AAAAAGbbkFP/25BT/+4AHf/bkFP/7gAd/+4AHf/bkFP/AAAAZmxZSAAAAAAAAAAAAP///wD///8A////AAAAAGYAAABm25BT/+4AHf/uAB3/7gAd/+4AHf/uAB3/7gAd/wAAAGZsWUgA////AAAAAAD///8A////AP///wAAAABm25BT/+4AHf/uAB3/7gAd/+4AHf/uAB3/7gAd/wAAAGYAAABmbFlIAP///wD///8A////AP///wD///8AAAAAZu4AHf+VITr/7gAd/5UhOv/uAB3/lSE6/5UhOv8AAABm7gAdAGxZSAD///8A////AP///wD///8A////AAAAAGaVITr/lSE6/5UhOv+VITr/lSE6/5UhOv8AAABmAAAAZv///wBsWUgA////AP///wD///8A////AP///wAAAABmAAAAZpUhOv+VITr/lSE6/wAAAGYAAABmAAAAZv///wD///8AbFlIAP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AGxZSAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wBsWUgA////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wCihnAAbFlIAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AooZwAGxZSAD///8A////AA==" },
  shortsword: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/////sc3N/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/////sc3N/4GBgf8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/////sc3N/4GBgf8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/////sc3N/4GBgf8AAABmAAAAZoGBgQD///8A////AP///wD///8A////AP///wDbtQMAAAAAZgAAAGb/////sc3N/4GBgf8AAABmAAAAZoGBgQD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb/////sc3N/4GBgf8AAABmAAAAZoGBgQAAAAAA////AP///wD///8A////AP///wAAAABm27UD/6+RAP//////sc3N/4GBgf8AAABmAAAAZoGBgQD///8AAAAAAP///wD///8A////AP///wD///8AAAAAZgAAAGaEeRX/r5EA/4GBgf8AAABmAAAAZoGBgQD///8A////AAAAAAD///8A////AP///wD///8AAAAAZgAAAGbbtQP/r5EA/4R5Ff+EeRX/AAAAZoGBgQD///8A////AP///wAAAAAA////AP///wD///8A////AAAAAGbbtQP/r5EA/5CDAP8AAABmhHkV/wAAAGb///8A27UDAP///wD///8AAAAAAP///wD///8A////AP///wAAAABmr5EA/5CDAP8AAABmAAAAZgAAAGYAAABmkIMAANu1AwD///8AAAAAAAAAAAD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZpCDAACEeRUAhHkVAJCDAADbtQMA////AP///wD///8A////AP///wD///8A////AP///wCvkQAAr5EAAJCDAAD///8A////AJCDAACQgwAA////AP///wD///8A////AP///wD///8A////AA==" },
  dart: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmtLS0/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABm////////////////tLS0/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaampr/tLS0/7S0tP8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaampr/gYGB/2ZmZv+0tLT/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaampr/gYGB/2ZmZv8AAABmtLS0/wAAAGb///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGaampr/gYGB/2ZmZv8AAABmAAAAZgAAAGYAAABm////AP///wD///8A////AAAAAGYAAABm//////////+ampr/gYGB/2ZmZv8AAABmAAAAZv///wC0tLQAtLS0AP///wD///8A////AAAAAGYAAABm//////////+ampr/gYGB/2ZmZv8AAABmAAAAZv///wD///8A////AP///wD///8A////AAAAAGYAAABm//////////+ampr/gYGB/2ZmZv+0tLT/AAAAZv///wD///8A////AP///wD///8A////AP///wAAAABm//////////+ampr/gYGB/2ZmZv+0tLT/tLS0/wAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZmZmZv+0tLT/tLS0/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGa0tLT/tLS0/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmtLS0/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  armor_cloth: { w: 16, h: 16, rgba: "AAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAAAA////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8AAAAAAP///wAAAABmAAAAZv//////////AFOq/2ZmZv9mZmb/ZmZm/wBTqv//////zc26/wAAAGYAAABm////AAAAAAAAAABmAAAAZv///////////////3y12v8AU6r/ZmZm/wBTqv98tdr////////////Nzbr/AAAAZgAAAGYAAAAAAAAAZgBTqv98tdr/////////////////AFOq/2ZmZv8AU6r/////////////////fLXa/wA2df8AAABmAAAAAAAAAGYAAABmAFOq/3y12v/Nzbr//////3y12v8AU6r/fLXa///////Nzbr/fLXa/wA2df8AAABmAAAAZgAAAAD///8AAAAAZgAAAGYANnX/zc26////////////AFOq////////////zc26/wA2df8AAABmAAAAZv///wAAAAAA////AP///wAAAABmAAAAZs3Nuv///////////////////////////83Nuv8AAABmAAAAZgA2dQD///8AAAAAAP///wD///8A////AAAAAGbNzbr//////////////////////83Nuv/Nzbr/AAAAZgA2dQD///8A////AAAAAAD///8A////AP///wAAAABm////////////////////////////////zc26/wAAAGb///8A////AP///wAAAAAA////AP///wD///8AAAAAZv//////////////////////////zc26/83Nuv8AAABm////AP///wD///8AAAAAAP///wD///8A////AAAAAGb////////////////Nzbr/zc26/83Nuv/Nzbr/AAAAZv///wD///8A////AAAAAAD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGb///8A////AP///wAAAAAA////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  potion_red: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmmmIz/7V9T/8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRsLCw0dC/s//Yx7r/29vb0dvb29EAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNGaYjP/tX1P/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRAAAAZgAAAGbb29vRAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABm29vb0QAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABmAAAAZgAAAGbb29vRAAAAZgAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0QAAAGYAAABmAAAAZgAAAGYAAABmAAAAZtvb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZrCwsNHSABn/0gAZ//8AJv//ACb///////8AJv/b29vRAAAAZv///wD///8A////AP///wD///8A////AAAAAGawsLDR0gAZ/9IAGf//ACb//wAm////////ACb/29vb0QAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0dIAGf/SABn//wAm//8AJv//ACb//wAm/9vb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZgAAAGawsLDR0gAZ/9IAGf//ACb//wAm/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNHFxcXRxcXF0dvb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  potion_strength: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmmmIz/7V9T/8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRsLCw0dC/s//Yx7r/29vb0dvb29EAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNGaYjP/tX1P/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRAAAAZgAAAGbb29vRAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABm29vb0QAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABmAAAAZgAAAGbb29vRAAAAZgAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0QAAAGYAAABmAAAAZgAAAGYAAABmAAAAZtvb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZrCwsNGVdgD/lXYA/9msAP/ZrAD//////9msAP/b29vRAAAAZv///wD///8A////AP///wD///8A////AAAAAGawsLDRlXYA/5V2AP/ZrAD/2awA///////ZrAD/29vb0QAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0ZV2AP+VdgD/2awA/9msAP/ZrAD/2awA/9vb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZgAAAGawsLDRlXYA/5V2AP/ZrAD/2awA/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNHFxcXRxcXF0dvb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  ration: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AM7OzgAAAABmAAAAZgAAAGa6tKX/zs7O/87Ozv/Ozs7/zs7O/7q0pf8AAABmAAAAZgAAAGbOzs4A////AP///wAAAABmAAAAZs7Ozv+6tKX/hmlS/4ZpUv+6tKX/urSl/4ZpUv+GaVL/urSl/87Ozv8AAABmAAAAZv///wAAAABmAAAAZs7Ozv/Ozs7/zs7O/87Ozv+6tKX/hmlS/4ZpUv+6tKX/zs7O/87Ozv/Ozs7/zs7O/wAAAGYAAABmAAAAZrq0pf/Ozs7/zs7O/87Ozv+GaVL/hmlS/7q0pf+6tKX/hmlS/4ZpUv+6tKX/zs7O/7q0pf+6tKX/AAAAZgAAAGa6tKX/urSl/87Ozv+GaVL/urSl/87Ozv/Ozs7/zs7O/87Ozv+6tKX/hmlS/7q0pf+mmn7/ppp+/wAAAGYAAABmurSl/7q0pf+GaVL/ppp+/7q0pf/Ozs7/zs7O/87Ozv/Ozs7/urSl/5F/WP+GaVL/ppp+/6aafv8AAABmAAAAZqaafv+6tKX/hmlS/7q0pf+6tKX/urSl/7q0pf+6tKX/urSl/6aafv+mmn7/hmlS/6aafv+Rf1j/AAAAZgAAAGYAAABmppp+/4ZpUv+6tKX/urSl/7q0pf+6tKX/urSl/7q0pf+mmn7/ppp+/4ZpUv+Rf1j/AAAAZgAAAGb///8AAAAAZgAAAGaGaVL/ppp+/7q0pf+6tKX/urSl/7q0pf+mmn7/ppp+/5F/WP+GaVL/AAAAZgAAAGb///8A////AM7OzgAAAABmAAAAZgAAAGammn7/ppp+/6aafv+mmn7/kX9Y/5F/WP8AAABmAAAAZgAAAGaRf1gA////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  scroll: { w: 16, h: 16, rgba: "AAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wAAAAAA////AAAAAGYAAABmzc29////6////+v////r////6////+v////r////6////+v/zc29/wAAAGb///8AAAAAAP///wAAAABmr6KF/9vKpv/byqb/28qm/9vKpv/byqb/28qm/9vKpv/byqb/r6KF/wAAAGYAAABm////AAAAAAD///8AAAAAZqOXf//KvZ//yr2f/3hoRv/KvZ//yr2f/3hoRv/KvZ//yr2f/6OXf/8AAABm////AP///wAAAAAA////AAAAAGajl3//yr2f/8q9n/94aEb/yr2f/8q9n/94aEb/yr2f/8q9n/+jl3//AAAAZv///wD///8AAAAAAP///wAAAABmo5d//8q9n//KvZ//eGhG/7qrg/94aEb/oIxj/8q9n//KvZ//o5d//wAAAGb///8A////AAAAAAD///8AAAAAZqOXf//KvZ//yr2f/3hoRv94aEb/oIxj/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wAAAAAA////AAAAAGajl3//yr2f/8q9n/94aEb/yr2f/8q9n//KvZ//yr2f/8q9n/+jl3//AAAAZv///wD///8AAAAAAP///wAAAABmo5d//8q9n//KvZ//eGhG/8q9n//KvZ//yr2f/8q9n//KvZ//o5d//wAAAGb///8A////AAAAAGYAAABmAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wAAAABmkodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/8q9n/+jl3//AAAAZv///wD///8AAAAAZpKHa/+2qYf/tqmH/7aph/+2qYf/tqmH/7aph/+2qYf/tqmH/5KHa//byqb/r6KF/wAAAGb///8A////AAAAAGYAAABmgnZa/6OTcv+jk3L/o5Ny/6OTcv+jk3L/o5Ny/6OTcv+jk3L/gnZa/wAAAGYAAABm////AP///wAAAAAAAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8AAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  scroll_upgrade: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AAAAAGYAAABmzc29////6////+v////r////6////+v////r////6////+v/zc29/wAAAGb///8A////AP///wAAAABmr6KF/9vKpv/byqb/28qm/9vKpv/byqb/28qm/9vKpv/byqb/r6KF/wAAAGYAAABm////AP///wD///8AAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/3hoRv/KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n/+gjGP/yr2f/8q9n/94aEb/yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//eGhG/3hoRv+6q4P/eGhG/8q9n//KvZ//o5d//wAAAGb///8A////AP///wD///8AAAAAZqOXf//KvZ//yr2f/3hoRv+6q4P/eGhG/3hoRv/KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n/94aEb/yr2f/8q9n/+gjGP/yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//eGhG/8q9n//KvZ//yr2f/8q9n//KvZ//o5d//wAAAGb///8A////AAAAAGYAAABmAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wAAAABmkodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/8q9n/+jl3//AAAAZv///wD///8AAAAAZpKHa/+2qYf/tqmH/7aph/+2qYf/tqmH/7aph/+2qYf/tqmH/5KHa//byqb/r6KF/wAAAGb///8A////AAAAAGYAAABmgnZa/6OTcv+jk3L/o5Ny/6OTcv+jk3L/o5Ny/6OTcv+jk3L/gnZa/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  gold: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv/HAP//xwD//8cA/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZv/HAP/dnTH/3Z0x/92dMf//xwD/AAAAZgAAAGb///8A////AP///wD///8AAAAAZgAAAGb/xwD//8cA///HAP/dnTH//8cA///HAP//xwD/3Z0x///HAP8AAABm////AP///wD///8AAAAAZgAAAGb/xwD/3Z0x/92dMf//xwD//8cA///HAP//xwD//8cA///HAP//xwD/AAAAZv///wD///8A////AAAAAGb/xwD/3Z0x///HAP//xwD//8cA///0ef//xwD//8cA///HAP//9Hn//8cA/wAAAGb///8A////AP///wAAAABm/8cA///HAP//xwD//8cA/92dMf//xwD///R5///0ef//9Hn//8cA/92dMf8AAABmAAAAZv///wD///8AAAAAZv/HAP//9Hn//8cA///HAP//xwD//8cA///HAP//xwD//8cA/92dMf/dnTH//8cA/wAAAGYAAABm////AAAAAGYAAABm/8cA///0ef//9Hn///R5///HAP/dnTH/3Z0x/92dMf//xwD//8cA/92dMf//xwD/AAAAZv///wD///8AAAAAZgAAAGb/xwD//8cA///HAP8AAABm/8cA///HAP//xwD//8cA///HAP//xwD//8cA/wAAAGb///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv/HAP//9Hn//8cA///HAP//xwD///R5///HAP8AAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm/8cA///0ef//9Hn///R5///HAP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/xwD//8cA///HAP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  key_iron: { w: 16, h: 16, rgba: "////AN2YAADdmAAA3ZgAAN2YAADdmAAA3ZgAAN2YAADdmAAA3ZgAAN2YAADdmAAA3ZgAAN2YAADdmAAA3ZgAAP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGby8vL/1NTU/9TU1P/U1NT/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGby8vL/1NTU/3Nzc/9zc3P/1NTU/9TU1P8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABm1NTU/3Nzc/8AAABmAAAAZtTU1P9zc3P/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZtTU1P9zc3P/AAAAZgAAAGby8vL/c3Nz/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGbU1NT/1NTU/9TU1P/y8vL/1NTU/3Nzc/8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZnNzc//U1NT/1NTU/3Nzc/8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm1NTU/3Nzc/8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wDU1NQAAAAAZtTU1P9zc3P/AAAAZnNzcwD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A1NTUAAAAAGbU1NT/c3Nz/wAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////ANTU1AAAAABm1NTU/3Nzc//U1NT/1NTU/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wDU1NQAAAAAZtTU1P9zc3P/1NTU/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A1NTUAAAAAGbU1NT/c3Nz/9TU1P/U1NT/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  key_skeleton: { w: 16, h: 16, rgba: "AAAAALS0tADm5uYA5ubmAObm5gDm5uYA////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wAAAAAA////AP///wD///8AAAAAZgAAAGb/89n///PZ///z2f//89n/AAAAZgAAAGb///8A////AP///wD///8AAAAAAP///wD///8A////AAAAAGb/89n/6tvD/+rbw//q28P/6tvD/9HDrv8AAABm////AP///wD///8A////AAAAAAD///8A////AP///wAAAABm//PZ/wAAAP+OhHX/joR1/wAAAP/Rw67/AAAAZv///wD///8A////AP///wAAAAAA////AP///wD///8AAAAAZv/z2f91bWD/uKyZ/7ismf91bWD/0cOu/wAAAGb///8A////AP///wD///8AAAAAAP///wD///8A////AAAAAGYAAABm//PZ/9HDrv/Rw67/0cOu/wAAAGb///8A////AP///wD///8A////AAAAAAD///8A////AP///wD///8AAAAAZurbw/+4rET/dGwd/9HDrv8AAABm3ZgAAP///wD///8A////AP///wAAAAAA////AP///wD///8A////AAAAAGYAAABmuKxE/3RsHf8AAABmAAAAZt2YAAD///8A////AP///wD///8AAAAAAP///wD///8A////AP///wC4rEQAAAAAZrisRP90bB3/AAAAZtHDrgDdmAAA////AP///wD///8A////AAAAAAD///8A////AP///wD///8AuKxEAAAAAGa4rET/dGwd/wAAAGYAAABmAAAAZv///wD///8A////AP///wAAAAAA////AP///wD///8A////ALisRAAAAABmuKxE/3RsHf+4rET/uKxE/wAAAGb///8A////AP///wD///8AAAAAAP///wD///8A////AP///wC4rEQAAAAAZrisRP90bB3/uKxE/wAAAGYAAABm////AP///wD///8A////AAAAAAD///8A////AP///wD///8AuKxEAAAAAGa4rET/dGwd/7isRP+4rET/AAAAZv///wD///8A////AP///wAAAAAA////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8AAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  weapon_quarterstaff: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaampr/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaampr/iYmJ/2NjY/8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGameTD/k2ok/2NjY/8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGameTD/k2ok/2tKEP8AAABmAAAAZm4QAAD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGameTD/k2ok/2tKEP8AAABmAAAAZgMAAAADAAAA////AP///wD///8A////AP///wD///8AAAAAZgAAAGameTD/k2ok/2tKEP8AAABmAAAAZm4QAAADAAAA////AP///wD///8A////AP///wD///8AAAAAZgAAAGameTD/k2ok/2tKEP8AAABmAAAAZgMAAAADAAAA////AP///wD///8A////AP///wD///8AAAAAZgAAAGameTD/k2ok/2tKEP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGameTD/k2ok/2tKEP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGameTD/k2ok/2tKEP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGameTD/k2ok/2tKEP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaampr/k2ok/2tKEP8AAABmAAAAZomJiQCJiYkAiYmJAImJiQCJiYkAiYmJAImJiQCJiYkA////AAAAAGaampr/iYmJ/2NjY/8AAABmAAAAZomJiQCJiYkAiYmJAImJiQCJiYkAiYmJAImJiQCJiYkAiYmJAP///wAAAABmAAAAZmNjY/8AAABmAAAAZomJiQCJiYkAiYmJAImJiQCJiYkAiYmJAImJiQCJiYkAiYmJAImJiQD///8AAAAAAAAAAGYAAABmAAAAZgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==" },
  weapon_mace: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABm6qRKAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZs3Nzf+ampr/AAAAZgAAAGabZR4A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZs3Nzf+ampr/ZmZm/0xMTP8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaampr/ZmZm/0xMTP9MTEz/AAAAZptlHgD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaampr/ZmZm/0xMTP9MTEz/AAAAZgAAAGabZR4A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbqpEr/0ZA7/0xMTP8AAABmAAAAZgAAAGZMTEwA////AP///wD///8A////AP///wD///8AAAAAZgAAAGbqpEr/0ZA7/5tlHv8AAABmAAAAZkxMTABMTEwA////AP///wD///8A////AP///wD///8AAAAAZgAAAGbqpEr/0ZA7/5tlHv8AAABmAAAAZkxMTACbZR4A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbqpEr/0ZA7/5tlHv8AAABmAAAAZptlHgD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbqpEr/0ZA7/5tlHv8AAABmAAAAZptlHgD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaampr/0ZA7/5tlHv8AAABmAAAAZptlHgD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaampr/ZmZm/0xMTP8AAABmAAAAZptlHgD///8A////AP///wD///8A////AP///wD///8A////AAAAAGaampr/ZmZm/0xMTP8AAABmAAAAZptlHgD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZkxMTP8AAABmAAAAZkxMTAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAAAAAAGYAAABmAAAAZkxMTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==" },
  weapon_sword: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/////zc3N/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/////zc3N/4GBgf8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/////zc3N/4GBgf8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/////zc3N/4GBgf8AAABmAAAAZoGBgQD///8A////AP///wAAAABmAAAAZgAAAGb///8AAAAAZgAAAGb/////zc3N/4GBgf8AAABmAAAAZoGBgQD///8A////AP///wAAAABmAAAAZv+rU/8AAABmAAAAZgAAAGb/////zc3N/4GBgf8AAABmAAAAZoGBgQD///8A////AP///wD///8AAAAAZueMPv/njD7/AAAAZgAAAGb/////zc3N/4GBgf8AAABmAAAAZoGBgQAAAAAA////AP///wD///8A////AAAAAGYAAABm0Xwy/+eMPv//////zc3N/4GBgf8AAABmAAAAZoGBgQD///8AAAAAAP///wD///8A////AP///wD///8AAAAAZgAAAGbRfDL/54w+/4GBgf8AAABmAAAAZoGBgQD///8A////AAAAAAD///8A////AP///wD///8AAAAAZgAAAGaTk5P/eHh4/9F8Mv/njD7/AAAAZgAAAGYAAABm////AP///wAAAAAA////AP///wD///8A////AAAAAGaTk5P/eHh4/2dnZ/8AAABm0Xwy//+rU///q1P/AAAAZv///wD///8AAAAAAP///wD///8A////AAAAAAAAAABmeHh4/2dnZ/8AAABmAAAAZgAAAGbRfDL/AAAAZgAAAGb///8AAAAAAAAAAAD///8A////AP///wAAAAAAAAAAZgAAAGYAAABmAAAAZmZmZgAAAABmAAAAZgAAAGbQj1sAAAAAAAAAAAAAAAAA////AP///wD///8A////AAAAAABxcXEAZmZmAGZmZgCjk3IA////AKdzRwCnc0cAo5NyAAAAAAAAAAAA////AP///wD///8A////AA==" },
  weapon_longsword: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/////zc3N/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/////zc3N/4GBgf8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/////zc3N/4GBgf8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/////zc3N/4GBgf8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/////zc3N/4GBgf8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/////zc3N/4GBgf8AAABmAAAAZv///wD///8A////AP///wAAAABmAAAAZgAAAGb///8AAAAAZgAAAGb/////zc3N/4GBgf8AAABmAAAAZv///wD///8A////AP///wD///8AAAAAZrZNOv8AAABmAAAAZgAAAGb/////zc3N/4GBgf8AAABmAAAAZv///wD///8A////AP///wD///8A////AAAAAGalQzL/tk06/wAAAGb/////zc3N/4GBgf8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZqVDMv+2TTr/zc3N/4GBgf8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmpUMy/6VDMv8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmx0Uu/wAAAGaTOyr/pUMy/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmx0Uu/wAAAGYAAABmAAAAZpM7Kv+TOyr/AAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmx0Uu/wAAAGYAAABm////AAAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  weapon_battle_axe: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm////////////////AAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm/////8/Pz//Pz8//AAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AAAAAGYAAABm/////7CwsP+wsLD/sLCw/wAAAGb/////z8/P/wAAAGb///8A////AP///wD///8A////AP///wAAAABm/////7CwsP+wsLD/sLCw/7CwsP/btQP/n5+f/5+fn/8AAABmAAAAZgAAAGb///8A////AP///wD///8AAAAAZv/////Pz8//z8/P/8/Pz//btQP/wp0A/5CDAP8AAABmAAAAZs/Pz/8AAABm////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGbbtQP/wp0A/5CDAP+fn5//sLCw/7CwsP+wsLD/AAAAZv///wD///8A////AP///wD///8AAAAAZgAAAGbbtQP/wp0A/5CDAP+fn5//sLCw/7CwsP+wsLD/sLCw/wAAAGb///8A////AP///wD///8AAAAAZgAAAGbbtQP/wp0A/5CDAP8AAABmz8/P/8/Pz//Pz8//n5+f/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGbbtQP/wp0A/5CDAP8AAABmAAAAZs/Pz//Pz8//n5+f/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGZ+fn7/wp0A/5CDAP8AAABmAAAAZgAAAGafn5//n5+f/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGZ+fn7/ZWVl/1JSUv8AAABmAAAAZv///wAAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AAAAAGbbtQP/wp0A/1JSUv8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmwp0A/5CDAP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  weapon_war_hammer: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm9uqH/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm9uqH//i7E//26of/AAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm9uqH//i7E//MmET/+LsT//bqh//YZwD/AAAAZgAAAGYAAAAA////AP///wD///8A////AP///wAAAABm9uqH//i7E//MmET/+LsT/8yYRP/4uxP/9uqH/5YYA/8AAABmAAAAAP///wD///8A////AP///wD///8AAAAAZgAAAGbMmET/+LsT//bqh//4uxP/zJhE//i7E//26of/AAAAZgAAAGb///8A////AP///wD///8A////AP///wAAAABmAAAAZsyYRP/4uxP/9uqH//i7E//MmET/+LsT//bqh/8AAABmAAAAZv///wD///8A////AP///wD///8AAAAAZgAAAGbYZwD/zJhE//i7E//26of/+LsT/8yYRP/4uxP/9uqH/wAAAGb///8A////AP///wD///8AAAAAZgAAAGbYZwD/uD8A/5YYA//MmET/+LsT//bqh//4uxP/zJhE/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGbYZwD/uD8A/5YYA/8AAABmAAAAZsyYRP/4uxP/zJhE/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGb26of/uD8A/5YYA/8AAABmAAAAZgAAAGYAAABmzJhE/wAAAGYAAABm3Z0xAP///wD///8AAAAAZgAAAGb26of/+LsT/8yYRP8AAABmAAAAZv///wD///8AAAAAZgAAAGYAAABm3Z0xAP///wD///8A////AAAAAGbYZwD/uD8A/8yYRP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmuD8A/5YYA/8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  weapon_spear: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm/////wAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm/////4GBgf8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm/////4GBgf8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm/6tT//8AAP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm/6tT/9F8Mv//AAD/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm/6tT/9F8Mv8AAABmsxkZ/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm/6tT/9F8Mv8AAABmAAAAZrMZGf8AAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm/6tT/9F8Mv8AAABmAAAAZv///wAAAABmAAAAZv///wD///8A////AP///wD///8A////AAAAAGYAAABm/6tT/9F8Mv8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm/6tT/9F8Mv8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm/6tT/9F8Mv8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm/6tT/9F8Mv8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm/6tT/9F8Mv8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABm/6tT/9F8Mv8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  weapon_glaive: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmrcXT/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmrcXT/2Ggr/8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmrcXT/2Ggr/9slp3/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZq3F0/8AAABmrcXT/2Ggr/9slp3/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGatxdP/YaCv/2Ggr/8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm2GcA//8AAP9slp3/bJad/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm2GcA/5YYA///AAD/AAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm2GcA/5YYA/8AAABmsxkZ/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm2GcA/5YYA/8AAABmAAAAZrMZGf8AAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm2GcA/5YYA/8AAABmAAAAZv///wAAAABmAAAAZv///wD///8A////AP///wD///8A////AAAAAGYAAABm2GcA/5YYA/8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm2GcA/5YYA/8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm2GcA/5YYA/8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABm2GcA/5YYA/8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  armor_leather: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wAAAABmAAAAZrV9T/+NWS3/mWhB/wAAAGYAAABmtX1P/41ZLf+1fU//AAAAZgAAAGb///8A////AP///wAAAABmAAAAZrV9T/+1fU//jVkt/5loQf+ZaEH/mWhB/5loQf+NWS3/tX1P/7V9T/8AAABmAAAAZv///wD///8AAAAAZploQf+NWS3/tX1P/7V9T/+NWS3/jVkt/41ZLf+NWS3/tX1P/7V9T/+NWS3/mWhB/wAAAGb///8A////AAAAAGYAAABmZDMV/4dHHf+1fU//tX1P/7V9T/+ZaEH/tX1P/7V9T/+HRx3/ZDMV/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGYAAABmtX1P/7V9T/+ZaEH/tX1P/7V9T/+HRx3/AAAAZgAAAGYAAABm////AP///wD///8A////AP///wAAAAAAAAAAZrV9T/+1fU//tX1P/5loQf+1fU//h0cd/wAAAGYAAAAAmWhBAP///wD///8A////AP///wD///8A////AAAAAGa1fU//tX1P/5loQf+1fU//jVkt/4dHHf8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmYEAm/2BAJv//xwD//8cA/2BAJv8sFAb/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZrV9T/+NWS3/h0cd/4dHHf+HRx3/h0cd/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGa1fU//tX1P/7V9T/+1fU//jVkt/4dHHf8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmZDMV/2QzFf9kMxX/ZDMV/2QzFf9kMxX/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  armor_mail: { w: 16, h: 16, rgba: "mpqaAJqamgBMTEwATExMAJqamgCampoAmpqaAJqamgCampoAmpqaAJqamgCampoAmpqaAJqamgCampoAmpqaAJqamgCampoAmpqaAJqamgCampoAmpqaAJqamgCampoAmpqaAJqamgCampoAmpqaAJqamgCampoAmpqaAJqamgCampoAmpqaAP///wAAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AJqamgCampoAmpqaAJqamgAAAABmAAAAZszMzP+zs7P/zMzM/wAAAGYAAABms7Oz/8zMzP+zs7P/AAAAZgAAAGaampoAmpqaAJqamgAAAABmAAAAZszMzP+zs7P/w8PD/6Wlpf/MzMz/s7Oz/8PDw/+lpaX/zMzM/7Ozs/8AAABmAAAAZpqamgCampoAAAAAZsPDw/+lpaX/w8PD/6Wlpf/Dw8P/paWl/8PDw/+lpaX/w8PD/6Wlpf/Dw8P/paWl/wAAAGaampoAmpqaAAAAAGYAAABmhpag/2Z1fv+vr6//paWl/8PDw/+lpaX/w8PD/4WFhf+GlqD/ZnV+/wAAAGYAAABmmpqaAJqamgCampoAAAAAZgAAAGYAAABmpaWl/8PDw/+lpaX/w8PD/4WFhf9+jpj/AAAAZgAAAGYAAABmmpqaAJqamgCampoAmpqaAP///wAAM2QAAAAAZsPDw/+lpaX/w8PD/6Wlpf+vr6//WGhy/wAAAGYAM2QAmpqaAJqamgCampoAmpqaAJqamgD///8A////AAAAAGaVlZX/w8PD/6Wlpf/Dw8P/hYWF/36OmP8AAABm////AP///wCampoAmpqaAJqamgCampoA////AP///wAAAABmuLi4/6Wlpf/Dw8P/paWl/6+vr/9YaHL/AAAAZv///wD///8AmpqaAJqamgCampoAmpqaAP///wD///8AAAAAZpWVlf/Dw8P/paWl/8PDw/9mdX7/fo6Y/wAAAGb///8A////AJqamgCampoAmpqaAJqamgD///8A////AAAAAGa4uLj/fo6Y/5iosf9+jpj/hpag/1hocv8AAABm////AP///wCampoAmpqaAP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  armor_scale: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZgAAAGb///8A////AAAAAGbn47f/cGtE/+fjt//n47f/AAAAZgAAAGYAAABmAAAAZt3Wjv/d1o7/cGtE/93Wjv8AAABm////AP///wAAAABmwbt8/3BrRP/Bu3z/cGtE/8G7fP+IVTH/h0cd/8G7fP9wa0T/wbt8/3BrRP/Bu3z/AAAAZv///wD///8AAAAAZgAAAGanoFT/cGtE/93Wjv/Bu3z/p6BU/93Wjv/Bu3z/3daO/3BrRP+noFT/AAAAZgAAAGb///8A////AP///wAAAABmAAAAZgAAAGZwa0T/cGtE/3BrRP9wa0T/cGtE/3BrRP8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AKegVAAAAABm5+O3/8G7fP+IVTH/h0cd/8G7fP/d1o7/AAAAZnBrRACnoFQA////AP///wD///8A////AP///wD///8AAAAAZufjt//Bu3z/p6BU/93Wjv/Bu3z/3daO/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGZwa0T/cGtE/3BrRP9wa0T/cGtE/3BrRP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABm5+O3/8G7fP+IVTH/h0cd/8G7fP/d1o7/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZufjt//Bu3z/p6BU/93Wjv/Bu3z/3daO/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A5+O3AOfjtwD///8A3daOAN3WjgD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  armor_plate: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmjqmj/wAAAGYAAABmjqmj/wAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8AAAAAZuK45//iuOf/yq7W//Dw8P/N4df/zeHX//Dw8P+ehbL/yq7W/8qu1v8AAABm////AP///wD///8A////AAAAAGbKrtb/yq7W/83h1//w8PD/8PDw//Dw8P/w8PD/zeHX/56Fsv+ehbL/AAAAZv///wD///8A////AP///wAAAABmAAAAZp6Fsv/N4df/zeHX/83h1//N4df/zeHX/67Evf+ehbL/AAAAZgAAAGb///8A////AP///wD///8A////AAAAAGYAAABmjqmj/46po//N4df/zeHX/46po/9ObW3/AAAAZgAAAGaehbIA////AP///wD///8A////AP///wD///8AAAAAZk5tbf+OqaP/jqmj/46po/9vi4j/Tm1t/wAAAGayMNEA////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmTm1t/05tbf9ObW3/Tm1t/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmjqmj/83h1//N4df/zeHX/67Evf9ObW3/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZp6Fsv+OqaP/jqmj/46po/9vi4j/c1uN/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmc1uN/3Nbjf9zW43/c1uN/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmsjDRAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  ankh: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAAAA////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv/1yP//9cj///XI///jV/8AAABmAAAAZv///wD///8A////APR7AAD///8A////AP///wD///8AAAAAZv/1yP/0ewD/9HsA//R7AP//41f/9HsA/wAAAGb///8A////AP///wD/41cA////AP///wD///8A////AAAAAGb/9cj/9HsA/wAAAGYAAABm/+NX//R7AP8AAABm////AP///wD///8A/+NXAP///wD///8A////AP///wAAAABm//XI//R7AP8AAABmAAAAZv/jV//0ewD/AAAAZv///wD///8A////AP/jVwD///8A////AP///wD///8AAAAAZv/1yP/0ewD/AAAAZgAAAGb/41f/9HsA/wAAAGb///8A////AP///wD/9cgA////AP///wD///8A////AAAAAGYAAABm/+NX///1yP//41f/9HsA/wAAAGYAAABm////AP///wD///8A/+NXAP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb/9cj/9HsA/wAAAGYAAABmAAAAZgAAAGb///8A////AP/jVwD///8A////AP///wAAAABm//XI///1yP//9cj///XI///jV///9cj///XI///jV/8AAABm////AP///wD/41cA////AP///wD///8AAAAAZv/jV//0ewD/9HsA///jV//0ewD/9HsA//R7AP/0ewD/AAAAZv///wD///8A9HsAAP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb/9cj/9HsA/wAAAGYAAABmAAAAZgAAAGb///8A////APR7AAD///8A////AP///wD///8A/+NXAPR7AAAAAABm//XI//R7AP8AAABm9HsAAPR7AAD0ewAA////AP///wDLUgAA////AP///wD///8A////AP/jVwD/41cAAAAAZv/1yP/0ewD/AAAAZv/jVwD/41cA////AP///wD///8A9HsAAP///wD///8A////AP///wD/41cA/+NXAAAAAGb/9cj/9HsA/wAAAGb/41cA/+NXAP///wD///8A////APR7AAD///8A////AP///wD///8A/+NXAP/jVwAAAABm/+NX//R7AP8AAABm/+NXAP/jVwD///8A////AP///wD0ewAA////APR7AACPFwQAjxcEAI8XBACPFwQAAAAAZgAAAGYAAABmAAAAZo8XBACPFwQAjxcEAI8XBACPFwQA9HsAAA==" },
  seed_pouch: { w: 16, h: 16, rgba: "7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAAAAAGYAAABmAAAAZgAAAGbs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAAAAAGYAAABmALu8/wC7vP8AAABmAAAAZuzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7AAAAABmAAAAZgAAAGYAAABmAIaG/wCGhv8ARk7/AEZO/wAAAGbs7OwA7OzsAOzs7ADs7OwA7OzsAAAAAGYAAABmAAAAZgC7vP8Au7z/AAAA/wARHP8ARk7/AEZO/wBGTv8AAABm7OzsAOzs7ADs7OwA7OzsAAAAAGYAAABmALu8/wC7vP8Ahob/AIaG/wCGhv8AAAD/AAAAZgAAAGYAAABmAAAAZuzs7ADs7OwA7OzsAAAAAGYAAABmALu8/wCGhv8Ahob/AIaG/wCGhv8Ahob/AIaG/wAAAGYAAABmAF1gAOzs7ADs7OwA7OzsAOzs7AAAAABmALu8/wCGhv8Ahob/AIaG/wCGhv8Ahob/AIaG/wCGhv8Ahob/AAAAZgBdYADs7OwA7OzsAOzs7AAAAABmAAAAZgC7vP8Ahob/AIaG///XPP8ARk7/AIaG/wCGhv8Ahob/AEZO/wAAAGYAAABm7OzsAOzs7ADs7OwAAAAAZgC7vP8Ahob/AIaG///XPP//xwD//50A/wCGhv8Ahob/AIaG/wBGTv8ARk7/AAAAZuzs7ADs7OwA7OzsAAAAAGYAu7z/AIaG/wCGhv8ARk7//50A/wBGTv8Ahob/AIaG/wCGhv8ARk7/AEZO/wAAAGbs7OwA7OzsAOzs7AAAAABmAIaG/wCGhv8Ahob/AIaG/wCGhv8Ahob/AIaG/wCGhv8ARk7/AEZO/wBGTv8AAABm7OzsAOzs7ADs7OwAAAAAZgBGTv8Ahob/AIaG/wCGhv8Ahob/AIaG/wBGTv8ARk7/AEZO/wBGTv8ARk7/AAAAZuzs7ADs7OwA7OzsAAAAAGYAAABmAEZO/wBGTv8ARk7/AEZO/wBGTv8ARk7/AEZO/wBGTv8ARk7/AAAAZgAAAGbs7OwA7OzsAOzs7ADs7OwAAAAAZgAAAGYAAABmAEZO/wBGTv8ARk7/AEZO/wBGTv8AAABmAAAAZgAAAGYAXWAA7OzsAOzs7ADs7OwA7OzsAOzs7AAARk4AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZuzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7AAARk4AAEZOAABGTgAARk4AAEZOAABGTgDs7OwA7OzsAOzs7ADs7OwA7OzsAA==" },
  torch: { w: 16, h: 16, rgba: "7OzsAOzs7AD///8A////AAAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AOzs7ADs7OwA////AAAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wDs7OwA7OzsAP///wAAAABm/1QA/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A7OzsAOzs7AAAAABmAAAAZv9UAP//VAD/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AOzs7ADs7OwAAAAAZv9UAP//niH//8lG//9UAP8AAABm////AP///wD///8A////AP///wD///8A////AP///wDs7OwA////AAAAAGb/VAD//+Zb///mW///VAD/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABm/1QA///JRv///////1QA/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/VAD//1QA/5NqJP+meTD/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGZrShD/k2ok/6Z5MP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP9UAAAAAABmAAAAZmtKEP+TaiT/pnkw/wAAAGYAAABm////AP///wD///8A////AOzs7AD///8A////AP///wD///8A//nlAAAAAGYAAABma0oQ/5NqJP+meTD/AAAAZgAAAGb///8A////AP///wDs7OwA7OzsAP///wD///8A////AP///wD///8AAAAAZgAAAGZrShD/k2ok/6Z5MP8AAABmAAAAZv///wD///8A7OzsAOzs7AD///8A////AP///wD///8A////AP///wAAAABmAAAAZmtKEP+TaiT/pnkw/wAAAGameTAA////AOzs7ADs7OwA////AP///wD///8A////AP///wD///8A////AAAAAGYAAABma0oQ/5NqJP8AAABm////AP///wDs7OwA7OzsAP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZmtKEAD///8A7OzsAOzs7AD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8Aa0oQAGtKEAD///8A////AA==" },
  scroll_holder: { w: 16, h: 16, rgba: "AAAAAP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAD///8AAAAAZgAAAGb/xwD//8cA/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAAAAAAAAZgAAAGb/nQD/vJ+G/86uk///xwD/AAAAZgAAAGbWdEgA1nRIANZ0SADWdEgA1nRIAP///wD///8AAAAAZgAAAGb/nQD/vJ+G/6GIc//OrpP//8cA/8J4Wv8AAABmAAAAZtZ0SADWdEgA1nRIANZ0SAD///8A////AAAAAGb/nQD/vJ+G/6GIc//OrpP//50A/7JaP//CeFr/wnha/wAAAGYAAABm1nRIANZ0SADWdEgA////AP///wAAAABm5nEA/86uk//OrpP//50A/7JaP/+yWj//slo//8J4Wv/CeFr/AAAAZgAAAGbWdEgA1nRIAP///wD///8AAAAAZgAAAGbmcQD//50A/5hRPf+yWj///8cA/7JaP/+yWj//wnha/8J4Wv8AAABmAAAAZtZ0SAD///8A////AAAAAAAAAABmAAAAZk8wJv+YUT3/mFE9/7JaP///nQD/slo//7JaP//CeFr/wnha/wAAAGYAAABm////AP///wAAAAAA////AAAAAGYAAABmTzAm/5hRPf+YUT3/slo////HAP+yWj//slo//8J4Wv/CeFr/AAAAZgAAAGb///8AAAAAAP///wByQzAAAAAAZgAAAGZPMCb/mFE9/5hRPf+yWj///50A/7JaP/+yWj//wnha/8J4Wv8AAABmAAAAZgAAAAD///8AckMwAHJDMAAAAABmAAAAZk8wJv+YUT3/mFE9/7JaP///nQD/slo//7JaP//CeFr//8cA/wAAAGYAAAAA////AHJDMAByQzAAckMwAAAAAGYAAABmTzAm/5hRPf+YUT3/slo//7JaP/+yWj//slo////HAP8AAABmAAAAAP///wByQzAAckMwAHJDMAByQzAAAAAAZgAAAGZPMCb/mFE9/5hRPf+yWj//slo///+dAP8AAABmAAAAZgAAAAD///8AckMwAHJDMAByQzAAckMwAHJDMAAAAABmAAAAZk8wJv+YUT3/mFE9//+dAP8AAABmAAAAZv/HAAAAAAAA////AHJDMAByQzAAckMwAHJDMAByQzAAckMwAAAAAGYAAABm5nEA//+dAP8AAABmAAAAZv+dAAD/nQAAAAAAAP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AA==" },
  wand_holster: { w: 16, h: 16, rgba: "////AP///wD///8AAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGZdcKn/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZl1wqf9dcKn/ZTud/11wqf8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZmU7nf9lO53/ZTud/2U7nf9lO53/XXCp/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmXzBo/2U7nf+pr9D/ZTud/2U7nf9dcKn/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGZfMGj/ZTud//////9lO53/ZTud/11wqf8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZl8waP9lO53/hnew/2U7nf9dcKn/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmXzBo/2U7nf+xzc3/ZTud/11wqf8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGZfMGj/ZTud/6mv0P9lO53/XXCp/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZl8waP9lO53/2////2U7nf9dcKn/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmXzBo/2U7nf9lO53/ZTud/11wqf8AAABmAAAAZgAAAAD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGZfMGj/ZTud/2U7nf9lO53/ZTud/wAAAGYAAAAA////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZl8waP9lO53/ZTud/18waP8AAABmAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmXzBo/2U7nf9fMGj/AAAAZgAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGZfMGj/AAAAZgAAAGYAAAAA////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGb///8AAAAAAA==" },
  overpriced_ration: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGa6tKX/zs7O/87Ozv/Ozs7/zs7O/7q0pf8AAABmAAAAZgAAAGb///8A////AP///wAAAABmAAAAZs7Ozv+6tKX/hmlS/4ZpUv+6tKX/urSl/4ZpUv+GaVL/urSl/87Ozv8AAABmAAAAZv///wD///8AAAAAZs7Ozv/Ozs7/zs7O/87Ozv+6tKX/hmlS/4ZpUv+6tKX/zs7O/87Ozv/Ozs7/zs7O/wAAAGb///8A////AAAAAGbOzs7/zs7O/87Ozv+GaVL/hmlS/7q0pf+6tKX/hmlS/4ZpUv+6tKX/zs7O/7q0pf8AAABm////AP///wAAAABmurSl/87Ozv+GaVL/urSl/87Ozv/Ozs7/zs7O/87Ozv+6tKX/hmlS/7q0pf+mmn7/AAAAZv///wD///8AAAAAZqaafv+GaVL/urSl/7q0pf+6tKX/urSl/7q0pf+6tKX/ppp+/6aafv+GaVL/kX9Y/wAAAGb///8A////AAAAAGammn7/hmlS/7q0pf+6tKX/urSl/7q0pf+6tKX/urSl/6aafv+mmn7/hmlS/5F/WP8AAABm////AP///wAAAABmAAAAZoZpUv+mmn7/urSl/7q0pf+6tKX/urSl/6aafv+mmn7/kX9Y/4ZpUv8AAABmAAAAZv///wD///8A////AAAAAGYAAABmAAAAZqaafv+mmn7/ppp+/6aafv+Rf1j/kX9Y/wAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  weightstone: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8ATExMAAAAAGYAAABmTExM/0xMTP9MTEz/AAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmTExM/0xMTP9MTEz/TExM/0xMTP9MTEz/AAAAZgAAAGb///8A////AP///wD///8A////AAAAAGYAAABmTExM/0xMTP8wMDD/MDAw/zAwMP8wMDD/TExM/0xMTP8AAABmAAAAZv///wD///8A////AP///wAAAABmTExM/0xMTP8wMDD/MDAw/zAwMP8wMDD/MDAw/zAwMP8wMDD/MDAw/wAAAGYAAABm////AP///wAAAABmAAAAZkxMTP8wMDD/MDAw/41ZLf+NWS3/jVkt/zAwMP8wMDD/MDAw/zAwMP8AAAD/AAAAZv///wD///8AAAAAZkxMTP8wMDD/MDAw/zAwMP+NWS3/MDAw/41ZLf8wMDD/MDAw/zAwMP8wMDD/AAAA/wAAAGb///8A////AAAAAGZMTEz/MDAw/zAwMP8wMDD/jVkt/41ZLf+NWS3/MDAw/zAwMP8wMDD/AAAA/wAAAP8AAABm////AP///wAAAABmTExM/zAwMP8wMDD/MDAw/zAwMP8wMDD/MDAw/zAwMP8wMDD/AAAA/wAAAP8AAABmAAAAZv///wD///8AAAAAZgAAAGYAAAD/MDAw/zAwMP8wMDD/MDAw/wAAAP8AAAD/AAAA/wAAAP8AAABmAAAAZgAAAAD///8A////AP///wAAAABmAAAAZgAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAGYAAABmAAAAZgAAAAD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  chest: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm3ZgA/2QzFf+HRx3/h0cd/4dHHf9kMxX/3ZgA/92YAP9kMxX/h0cd/4dHHf+HRx3/ZDMV/92YAP8AAABmAAAAZv/re/9kMxX/jVkt/41ZLf+NWS3/ZDMV///re///63v/ZDMV/41ZLf+NWS3/jVkt/2QzFf//63v/AAAAZgAAAGb/+Nf/ZDMV/7V9T/+1fU//tX1P/2QzFf//+Nf///jX/2QzFf+1fU//tX1P/7V9T/9kMxX///jX/wAAAGYAAABm//jX/2QzFf+1fU//tX1P/7V9T/9kMxX///jX///41/9kMxX/tX1P/7V9T/+1fU//ZDMV///41/8AAABmAAAAZv/re/9kMxX/jVkt/41ZLf+NWS3/ZDMV///re///63v/ZDMV/41ZLf+NWS3/jVkt/2QzFf//63v/AAAAZgAAAGbdmAD/ZDMV/4dHHf+HRx3/h0cd/2QzFf/dmAD/3ZgA/2QzFf+HRx3/h0cd/4dHHf9kMxX/3ZgA/wAAAGYAAABm3ZgA/2QzFf9kMxX/ZDMV/2QzFf9kMxX/3ZgA/92YAP9kMxX/ZDMV/2QzFf9kMxX/ZDMV/92YAP8AAABmAAAAZt2YAP/dmAD/3ZgA/92YAP/dmAD///jX///41///+Nf///jX/92YAP/dmAD/3ZgA/92YAP/dmAD/AAAAZgAAAGandAD/p3QA/6d0AP+ndAD/p3QA///re/+ndAD/p3QA///re/+ndAD/p3QA/6d0AP+ndAD/p3QA/wAAAGYAAABm3ZgA/2QzFf9kMxX/ZDMV/2QzFf/dmAD/3ZgA/92YAP/dmAD/ZDMV/2QzFf9kMxX/ZDMV/92YAP8AAABmAAAAZt2YAP9kMxX/h0cd/4dHHf9kMxX/ZDMV/2QzFf9kMxX/ZDMV/2QzFf+HRx3/h0cd/2QzFf/dmAD/AAAAZgAAAGbdmAD/ZDMV/2QzFf9kMxX/ZDMV/2QzFf9kMxX/ZDMV/2QzFf9kMxX/ZDMV/2QzFf9kMxX/3ZgA/wAAAGYAAABm3ZgA/92YAP/dmAD/3ZgA/92YAP/dmAD/3ZgA/92YAP/dmAD/3ZgA/92YAP/dmAD/3ZgA/92YAP8AAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZg==" },
  chest_locked: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm3ZgA/1wTE/9+Gxv/fhsb/34bG/9cExP/3ZgA/92YAP9cExP/fhsb/34bG/9+Gxv/XBMT/92YAP8AAABmAAAAZv/re/9cExP/hDEq/4QxKv+EMSr/XBMT///re///63v/XBMT/4QxKv+EMSr/hDEq/1wTE///63v/AAAAZgAAAGb/+Nf/XBMT/6tOR/+rTkf/q05H/1wTE///+Nf///jX/1wTE/+rTkf/q05H/6tOR/9cExP///jX/wAAAGYAAABm//jX/1wTE/+rTkf/q05H/6tOR/9cExP///jX///41/9cExP/q05H/6tOR/+rTkf/XBMT///41/8AAABmAAAAZv/re/9cExP/hDEq/4QxKv+EMSr/XBMT///re///63v/XBMT/4QxKv+EMSr/hDEq/1wTE///63v/AAAAZgAAAGbdmAD/XBMT/34bG/9+Gxv///jX///41///+Nf///jX///41///+Nf/fhsb/34bG/9cExP/3ZgA/wAAAGYAAABm3ZgA/1wTE/9cExP/XBMT///41//dmAD/3ZgA/92YAP/dmAD//+t7/1wTE/9cExP/XBMT/92YAP8AAABmAAAAZt2YAP/dmAD/3ZgA/92YAP//63v/3ZgA/ygYAP8oGAD/3ZgA///re//dmAD/3ZgA/92YAP/dmAD/AAAAZgAAAGandAD/p3QA/6d0AP+ndAD//+t7/92YAP8oGAD/KBgA/92YAP//63v/p3QA/6d0AP+ndAD/p3QA/wAAAGYAAABm3ZgA/1wTE/9cExP/XBMT///re//dmAD/3ZgA/92YAP/dmAD/3ZgA/1wTE/9cExP/XBMT/92YAP8AAABmAAAAZt2YAP9cExP/fhsb/34bG//dmAD/3ZgA/92YAP/dmAD/3ZgA/92YAP9+Gxv/fhsb/1wTE//dmAD/AAAAZgAAAGbdmAD/XBMT/1wTE/9cExP/XBMT/1wTE/9cExP/XBMT/1wTE/9cExP/XBMT/1wTE/9cExP/3ZgA/wAAAGYAAABm3ZgA/92YAP/dmAD/3ZgA/92YAP/dmAD/3ZgA/92YAP/dmAD/3ZgA/92YAP/dmAD/3ZgA/92YAP8AAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZg==" },
  tomb: { w: 16, h: 16, rgba: "////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8AAAAAZgAAAGbNzc3/zc3N/83Nzf/Nzc3/zc3N/83Nzf/Nzc3/zc3N/wAAAGYAAABm////AP///wDOzs4AAAAAZgAAAGbNzc3/zc3N/83Nzf/Nzc3/zc3N/83Nzf/Nzc3/zc3N/83Nzf/Nzc3/AAAAZgAAAGb///8Azs7OAAAAAGa0tLT/zc3N/83Nzf/Nzc3/zc3N/83Nzf/Nzc3/zc3N/83Nzf/Nzc3/zc3N/7S0tP8AAABm////AM7OzgAAAABmtLS0/83Nzf+ampr/mpqa/5qamv+ampr/mpqa/5qamv+ampr/mpqa/83Nzf+0tLT/AAAAZv///wDOzs4AAAAAZrS0tP+ampr/mpqa/5qamv+ampr/mpqa/5qamv+ampr/mpqa/5qamv+ampr/tLS0/wAAAGb///8Azs7OAAAAAGaampr/mpqa/5qamv+ampr/mpqa/5qamv+ampr/mpqa/5qamv+ampr/mpqa/5qamv8AAABm////AM7OzgAAAABmmpqa/5qamv9mZmb/ZmZm/5qamv9mZmb/gICA/2ZmZv+ampr/ZmZm/5qamv+ampr/AAAAZv///wDOzs4AAAAAZpqamv+ampr/gICA/2ZmZv9mZmb/mpqa/4CAgP9mZmb/ZmZm/5qamv+ampr/mpqa/wAAAGb///8Azs7OAAAAAGaampr/mpqa/5qamv+ampr/mpqa/5qamv+ampr/mpqa/5qamv+ampr/mpqa/5CQkP8AAABm////AM7OzgAAAABmmpqa/5qamv9mZmb/gICA/5qamv9mZmb/ZmZm/4CAgP9mZmb/mpqa/5qamv+QkJD/AAAAZv///wDOzs4AAAAAZpqamv+ampr/ZmZm/5qamv9mZmb/ZmZm/5qamv9mZmb/ZmZm/2ZmZv+ampr/kJCQ/wAAAGb///8Azs7OAAAAAGaQkJD/mpqa/5qamv+ampr/mpqa/5qamv+ampr/mpqa/5qamv+ampr/mpqa/5qamv8AAABm////AM7OzgAAAABmkJCQ/5qamv+ampr/mpqa/5qamv+ampr/mpqa/5qamv+ampr/mpqa/5qamv+QkJD/AAAAZv///wDOzs4AAAAAM5CQkH+QkJB/mpqaf5qamn+ampp/mpqaf5qamn+ampp/mpqaf5qamn+QkJB/kJCQfwAAADP///8Azs7OAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  bones: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZs/Pz//Pz8//z8/P/8/Pz//Pz8//z8/P/wAAAGYAAABm////AP///wD///8A////AP///wD///8AAAAAZs/Pz//m5ub/5ubm/+bm5v/m5ub/5ubm/+bm5v/Pz8//AAAAZv///wD///8A////AP///wD///8A////AAAAAGalpaX/5ubm/7S0tP+0tLT/tLS0/7S0tP+0tLT/f39//wAAAGb///8A////AP///wD///8A////AP///wAAAABmpaWl/+bm5v/m5ub/AAAA/+bm5v/m5ub/AAAA/8/Pz/8AAABm////AP///wD///8A////AP///wD///8AAAAAZgAAAGZ/f3//5ubm/+bm5v/m5ub/tLS0/+bm5v/Pz8//AAAAZv///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZn9/f//Nzc3/5ubm/+bm5v+lpaX/AAAAZgAAAGb///8A////AP///wAAAABmAAAAZs/Pz//Pz8//z8/P/wAAAGZ/f3//f39//6Wlpf+lpaX/f39//wAAAGYAAABmAAAAZv///wD///8AAAAAZs/Pz/+lpaX/AAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmz8/P/wAAAGYAAABm////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmz8/P/8/Pz//Pz8//z8/P/6Wlpf+lpaX/AAAAZv///wAAAAAAAAAAAAAAAAAAAABmz8/P/8/Pz//Pz8//z8/P/6Wlpf8AAABmAAAAZgAAAGYAAABmAAAAZgAAAGb///8AAAAAAP///wD///8AAAAAZn9/f/+lpaX/AAAAZgAAAGYAAABmAAAAZn9/f//Pz8//z8/P/wAAAGYAAABm////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAAAAAAAAAAAAAGYAAABmAAAAZqWlpf+lpaX/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  floor0: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv9GRUH/U1JO/1NSTv9MS0f/NTQx/0xLR/9TUk7/TEtH/0ZFQf81NDH/U1JO/1NSTv9MS0f/U1JO/09OSv81NDH/T05K/1NSTv9PTkr/U1JO/zU0Mf9PTkr/U1JO/0xLR/9PTkr/NTQx/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/1NSTv9PTkr/U1JO/09OSv81NDH/TEtH/0xLR/9TUk7/TEtH/zU0Mf9GRUH/U1JO/1NSTv87Ojb/Ozo2/zU0Mf9TUk7/T05K/1NSTv9PTkr/Ozo2/zs6Nv81NDH/Ozo2/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/TEtH/1NSTv9TUk7/U1JO/zU0Mf9GRUH/U1JO/1NSTv9TUk7/RkVB/zs6Nv9PTkr/T05K/1NSTv9PTkr/Ozo2/1NSTv9TUk7/U1JO/1NSTv87Ojb/T05K/1NSTv9PTkr/U1JO/0xLR/81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv9GRUH/U1JO/09OSv9GRUH/Ozo2/09OSv9PTkr/U1JO/1NSTv9TUk7/Ozo2/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9PTkr/U1JO/09OSv9TUk7/T05K/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/0xLR/9TUk7/T05K/0ZFQf81NDH/U1JO/1NSTv9PTkr/T05K/1NSTv87Ojb/T05K/09OSv87Ojb/U1JO/1NSTv9PTkr/U1JO/1NSTv9PTkr/Ozo2/0xLR/9TUk7/T05K/0xLR/9GRUH/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/T05K/09OSv9PTkr/TEtH/zs6Nv81NDH/Ozo2/zs6Nv81NDH/NTQx/zU0Mf9TUk7/U1JO/zU0Mf81NDH/NTQx/zs6Nv87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9MS0f/TEtH/zs6Nv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  floor1: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv9GRUH/U1JO/1NSTv9MS0f/NTQx/0xLR/9TUk7/TEtH/0ZFQf81NDH/U1JO/1NSTv9MS0f/U1JO/09OSv81NDH/T05K/1NSTv9PTkr/aW4v/11iI/9obC3/U1JO/0xLR/9PTkr/NTQx/2luL/9PTkr/U1JO/0xLR/9MS0f/XWIj/1NSTv9PTkr/U1JO/2hsLf9dYiP/Zmss/2ZrLP9TUk7/TEtH/zU0Mf9kaCr/aW4v/1NSTv87Ojb/Ozo2/zU0Mf9TUk7/T05K/2luL/9obC3/YGQl/2BkJf9dYiP/Ozo2/zU0Mf9gZCX/YGQl/zs6Nv87Ojb/U1JO/0xLR/87Ojb/TEtH/2luL/9pbi//aW4v/11iI/9kaCr/U1JO/1NSTv9pbi//ZGgq/2BkJf9obC3/T05K/1NSTv9PTkr/Ozo2/1NSTv9pbi//aW4v/2luL/9gZCX/T05K/1NSTv9PTkr/aW4v/2ZrLP9dYiP/aW4v/09OSv9TUk7/RkVB/zs6Nv9GRUH/U1JO/2hsLf9kaCr/YGQl/2hsLf9obC3/U1JO/1NSTv9pbi//YGQl/2RoKv9PTkr/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/XWIj/11iI/9obC3/aW4v/2hsLf9TUk7/T05K/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/0xLR/9TUk7/T05K/0ZFQf81NDH/aW4v/2luL/9obC3/T05K/1NSTv87Ojb/T05K/09OSv87Ojb/U1JO/1NSTv9PTkr/aW4v/1NSTv9PTkr/Ozo2/0xLR/9TUk7/T05K/0xLR/9GRUH/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/aGwt/2hsLf9obC3/TEtH/zs6Nv81NDH/Ozo2/2BkJf81NDH/NTQx/zU0Mf9TUk7/U1JO/zU0Mf81NDH/XWIj/2BkJf9gZCX/YGQl/zs6Nv87Ojb/NTQx/zU0Mf9MS0f/TEtH/zs6Nv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9kaCr/aGwt/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  wall: { w: 16, h: 16, rgba: "1NTU/93d3f+Zsqf/v7+//6urq/+/v7//q6ur/2FhYf+/v7//3d3d/564rP+euKz/mbKn/4ymmv+rq6v/VFRU/9TU1P/U1NT/1NTU/9TU1P+/v7//v7+//7+/v/9hYWH/1NTU/93d3f/U1NT/v7+//93d3f+Mppr/v7+//1RUVP+/v7//v7+//7+/v/+rq6v/v7+//7+/v/+rq6v/VFRU/7+/v//U1NT/v7+//6urq/+rq6v/v7+//6urq/9UVFT/YWFh/1RUVP9UVFT/VFRU/2FhYf9UVFT/YWFh/1RUVP9UVFT/YWFh/1RUVP9UVFT/VFRU/2FhYf9UVFT/YWFh/7+/v/+Zsqf/q6ur/2FhYf+Mppr/nris/5myp//U1NT/3d3d/7+/v/+/v7//YWFh/7+/v//d3d3/1NTU/9TU1P/U1NT/3d3d/7+/v/9hYWH/v7+//9TU1P+/v7//3d3d/93d3f+/v7//1NTU/1RUVP/U1NT/1NTU/9TU1P/U1NT/v7+//7+/v/+rq6v/VFRU/6urq//U1NT/1NTU/6urq/+rq6v/v7+//6urq/9hYWH/q6ur/9TU1P+/v7//q6ur/2FhYf9UVFT/YWFh/2FhYf9hYWH/YWFh/2FhYf9hYWH/YWFh/2FhYf9UVFT/YWFh/1RUVP9UVFT/YWFh/1RUVP+euKz/mbKn/564rP+Zsqf/nris/7+/v/+/v7//v7+//2FhYf+/v7//mbKn/564rP+euKz/v7+//1RUVP+/v7//v7+//4ymmv/U1NT/1NTU/9TU1P/U1NT/v7+//7+/v/9UVFT/1NTU/7+/v/+Zsqf/v7+//7+/v/9hYWH/v7+//93d3f+/v7//v7+//6urq/+/v7//q6ur/6urq/+rq6v/YWFh/6urq/+/v7//q6ur/7+/v/+rq6v/VFRU/6urq/9hYWH/YWFh/2FhYf9UVFT/YWFh/2FhYf9UVFT/YWFh/2FhYf9hYWH/VFRU/1RUVP9UVFT/VFRU/1RUVP9UVFT/3d3d/93d3f+/v7//q6ur/1RUVP+Mppr/mbKn/93d3f/U1NT/v7+//5myp/+Amo7/VFRU/4ymmv/d3d3/3d3d/7+/v/+/v7//v7+//9TU1P9hYWH/3d3d/9TU1P/d3d3/v7+//7+/v//U1NT/1NTU/2FhYf+Mppr/3d3d/7+/v//U1NT/q6ur/7+/v/+rq6v/VFRU/6urq//d3d3/v7+//7+/v/+rq6v/q6ur/6urq/9UVFT/v7+//93d3f+/v7//YWFh/1RUVP9hYWH/YWFh/1RUVP9UVFT/YWFh/2FhYf9UVFT/YWFh/1RUVP9hYWH/VFRU/2FhYf9hYWH/YWFh/w==" },
  door: { w: 16, h: 16, rgba: "1NTU/93d3f+Zsqf/v7+//6urq/+/v7//q6ur/2FhYf+/v7//3d3d/564rP+euKz/mbKn/4ymmv+rq6v/VFRU/9TU1P/U1NT/OCsr/zMmJv8uISH/Kx4e/yQXF/8sHx//LiEh/zAjI/8xJCT/MyYm/zQnJ/80Jyf/v7+//1RUVP+/v7//v7+//zQnJ/+IYiz/ckgf/1I1GP90Thj/WzEI/04xFP93URv/bkQb/1c6Hf9ySB//JRgY/6urq/9UVFT/YWFh/1RUVP81KCj/glwm/3FHHv8uISH/OSws/zAjI/80Jyf/LSAg/zcqKv9ZPB//d00k/y8iIv9UVFT/YWFh/7+/v/+Zsqf/MiUl/y0gIP9sQhn/LiEh/wAAAP8AAAD/AAAA/wAAAP8tICD/X0Il/29FHP8vIiL/1NTU/9TU1P/U1NT/1q2F/yYZGf8zJib/akAX/zIlJf8AAAD/AAAA/wAAAP8AAAD/NCcn/1E0F/9vRRz/MSQk/9TU1P/U1NT/v7+//8Sbc/8yJSX/OCsr/3NJIP8wIyP/LB8f/zIlJf8sHx//PC8v/zYpKf9bPiH/YDYN/ygbG/+/v7//q6ur/2FhYf9UVFT/MSQk/35YIv97USj/TjEU/3xWIP9nPRT/WDse/3VPGf+CWC//X0Il/2tBGP8xJCT/YWFh/1RUVP+euKz/mbKn/zAjI/99VyH/dkwj/1c6Hf9sRhD/cUce/1g7Hv9+WCL/YzkQ/zQnJ/8rHh7/Nikp/4RbMv/Em3P/v7+//4ymmv83Kir/elQe/2xCGf9ZPB//gFok/3NJIP9YOx7/iWMt/3JIH/83Kir/LB8f/zQnJ/+MYzr/v7+//93d3f/Em3P/JRgY/yseHv9oPhX/WDse/3tVH/93TST/TTAT/3JMFv9zSSD/VDca/2k/Fv81KCj/hFsy/6urq/9hYWH/jGM6/zcqKv8uISH/ZjwT/1c6Hf9+WCL/cUce/1k8H/93URv/ZDoR/1I1GP90SiH/LSAg/1RUVP9UVFT/3d3d/9athf89MDD/NCcn/2tBGP9UNxr/cUsV/3VLIv9TNhn/dE4Y/2xCGf9YOx7/bkQb/ycaGv/d3d3/3d3d/7+/v/+/v7//Nyoq/49pM/91SyL/Wz4h/3ROGP94TiX/Vzod/3VPGf92TCP/YkUo/3FHHv8qHR3/3d3d/7+/v//U1NT/q6ur/yseHv+GYCr/cUce/1I1GP91Txn/Zz0U/0wvEv97VR//cEYd/1I1GP9tQxr/MCMj/93d3f+/v7//YWFh/1RUVP84Kyv/MyYm/y4hIf8rHh7/JBcX/ywfH/8uISH/MCMj/zEkJP8zJib/NCcn/zQnJ/9hYWH/YWFh/w==" },
  door_locked: { w: 16, h: 16, rgba: "1NTU/93d3f+Zsqf/v7+//6urq/+/v7//q6ur/2FhYf+/v7//3d3d/564rP+euKz/mbKn/4ymmv+rq6v/VFRU/9TU1P/U1NT/OCsr/zMmJv8uISH/Kx4e/yQXF/8sHx//LiEh/zAjI/8xJCT/MyYm/zQnJ/80Jyf/v7+//1RUVP+/v7//v7+//zQnJ/+IYiz/ckgf/1I1GP90Thj/WzEI/04xFP93URv/bkQb/1c6Hf9ySB//JRgY/6urq/9UVFT/YWFh/1RUVP81KCj/glwm/3FHHv8uISH/OSws/zAjI/80Jyf/LSAg/zcqKv9ZPB//d00k/y8iIv9UVFT/YWFh/7+/v/+Zsqf/MiUl/y0gIP9sQhn/IBcX/wAAAP8AAAD/AAAA/wAAAP8fFhb/X0Il/29FHP8vIiL/1NTU/9TU1P/U1NT/1q2F/yYZGf8zJib/Si0Q/yMaGv+gl4L/mpF8/5iOef99dHD/JBsb/zkkEP9vRRz/MSQk/9TU1P/U1NT/v7+//8Sbc/8yJSX/OCsr/1AzFv+Zj3r/e3Ju/1lQWP9eVF3/e3Ju/3tybv9AKxf/YDYN/ygbG/+/v7//q6ur/2FhYf9UVFT/MSQk/1g9GP9WORz/e3Ju/11TXP9IKw7/PSkV/3pxbf9fVV7/Qi4a/0stEf8xJCT/YWFh/1RUVP+euKz/mbKn/zAjI/9XPRf/mZB7/5qRfP+akXz/n5aB/5SKdv+WjHj/mpF8/5+Wgf8eFRX/Nikp/4RbMv/Em3P/v7+//4ymmv83Kir/VTsV/5yTfv9iW1j/fXRw/351cf+Bd3T/e3Ju/2ZeW/9hV2D/HxYW/zQnJ/+MYzr/v7+//93d3f/Em3P/JRgY/x4VFf+Yjnn/fnVx/351cf8NBAD/DQQA/3xzb/95cGz/YFZf/0ksD/81KCj/hFsy/6urq/9hYWH/jGM6/zcqKv8gFxf/mpF8/3lwbP+Ad3P/DgUB/w0EAP9/dnL/fHNv/1pRWf9RNBf/LSAg/1RUVP9UVFT/3d3d/9athf89MDD/JBsb/5uSff9hWlb/fHNv/4B3c/97cm7/fnVx/2VeWv9eVF3/TS8T/ycaGv/d3d3/3d3d/7+/v/+/v7//Nyoq/2RJJP9lXGX/X1Ve/1xSW/9dU1z/XFJb/19VXv9VTFT/X1Ve/08yFf8qHR3/3d3d/7+/v//U1NT/q6ur/yseHv9eQx3/TzIV/zklEf9SNxH/SCsO/zUhDf9WOxb/TjEU/zklEf9MLxL/MCMj/93d3f+/v7//YWFh/1RUVP84Kyv/MyYm/y4hIf8rHh7/JBcX/ywfH/8uISH/MCMj/zEkJP8zJib/NCcn/zQnJ/9hYWH/YWFh/w==" },
  door_secret: { w: 16, h: 16, rgba: "1NTU/93d3f+Zsqf/v7+//6urq/+/v7//q6ur/2FhYf+/v7//3d3d/564rP+euKz/mbKn/4ymmv+rq6v/VFRU/9TU1P/U1NT/1NTU/9TU1P+/v7//v7+//7+/v/9hYWH/1NTU/93d3f/U1NT/v7+//93d3f+Mppr/v7+//1RUVP+/v7//v7+//7+/v/+rq6v/v7+//7+/v/+rq6v/VFRU/7+/v//U1NT/v7+//6urq/+rq6v/v7+//6urq/9UVFT/YWFh/1RUVP9UVFT/VFRU/2FhYf9UVFT/YWFh/1RUVP9UVFT/YWFh/1RUVP9UVFT/VFRU/2FhYf9UVFT/YWFh/7+/v/+Zsqf/q6ur/2FhYf+Mppr/nris/5myp//U1NT/3d3d/7+/v/+/v7//YWFh/7+/v//d3d3/1NTU/9TU1P/U1NT/3d3d/7+/v/9hYWH/v7+//9TU1P+/v7//3d3d/93d3f+/v7//1NTU/1RUVP/U1NT/1NTU/9TU1P/U1NT/v7+//7+/v/+rq6v/VFRU/6urq//U1NT/1NTU/6urq/+rq6v/v7+//6urq/9hYWH/q6ur/9TU1P+/v7//q6ur/2FhYf9UVFT/YWFh/2FhYf9hYWH/YWFh/2FhYf9hYWH/YWFh/2FhYf9UVFT/YWFh/1RUVP9UVFT/YWFh/1RUVP+euKz/mbKn/564rP+Zsqf/nris/7+/v/+/v7//v7+//2FhYf+/v7//mbKn/564rP+euKz/v7+//1RUVP+/v7//v7+//4ymmv/U1NT/1NTU/9TU1P/U1NT/v7+//7+/v/9UVFT/1NTU/7+/v/+Zsqf/v7+//7+/v/9hYWH/v7+//93d3f+/v7//v7+//6urq/+/v7//q6ur/6urq/+rq6v/YWFh/6urq/+/v7//q6ur/7+/v/+rq6v/VFRU/6urq/9hYWH/YWFh/2FhYf9UVFT/YWFh/2FhYf9UVFT/YWFh/2FhYf9hYWH/VFRU/1RUVP9UVFT/VFRU/1RUVP9UVFT/3d3d/93d3f+/v7//q6ur/1RUVP+Mppr/mbKn/93d3f/U1NT/v7+//5myp/+Amo7/VFRU/4ymmv/d3d3/3d3d/7+/v/+/v7//v7+//9TU1P9hYWH/3d3d/9TU1P/d3d3/v7+//7+/v//U1NT/1NTU/2FhYf+Mppr/3d3d/7+/v//U1NT/q6ur/7+/v/+rq6v/VFRU/6urq//d3d3/v7+//7+/v/+rq6v/q6ur/6urq/9UVFT/v7+//93d3f+/v7//YWFh/1RUVP9hYWH/YWFh/1RUVP9UVFT/YWFh/2FhYf9UVFT/YWFh/1RUVP9hYWH/VFRU/2FhYf9hYWH/YWFh/w==" },
  stairs_up: { w: 16, h: 16, rgba: "QUFB/0FBQf87Ozv/Ozs7/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/0FBQf+Ghob/hoaG/0FBQf81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9BQUH/f39//4aGhv87Ozv/QUFB/0FBQf9BQUH/Ozs7/0xLR/9TUk7/TEtH/0ZFQf81NDH/U1JO/1NSTv9MS0f/QUFB/39/f/9/f3//Ozs7/4aGhv9/f3//hoaG/zs7O/9PTkr/U1JO/0xLR/9PTkr/NTQx/1NSTv9PTkr/U1JO/zs7O/+Ghob/f39//0FBQf9/f3//hoaG/39/f/87Ozv/QUFB/zs7O/9BQUH/QUFB/zU0Mf9GRUH/U1JO/1NSTv9BQUH/hoaG/39/f/9BQUH/f39//4aGhv9/f3//QUFB/4aGhv9/f3//hoaG/zs7O/87Ojb/Ozo2/zs6Nv87Ojb/QUFB/4aGhv+Ghob/Ozs7/4aGhv+Ghob/hoaG/zs7O/9/f3//hoaG/4aGhv9BQUH/Ozs7/0FBQf9BQUH/Ozs7/ysrK/8rKyv/Kysr/ysrK/+Ghob/hoaG/4aGhv9BQUH/f39//4aGhv9/f3//QUFB/39/f/9/f3//hoaG/zs7O/8rKyv/Ojo6/0pKSv8rKyv/hoaG/39/f/9/f3//QUFB/39/f/9/f3//hoaG/0FBQf+Ghob/hoaG/39/f/87Ozv/Hh4e/zo6Ov9KSkr/Kysr/ysrK/8rKyv/Kysr/x4eHv9/f3//hoaG/39/f/9BQUH/f39//39/f/+Ghob/Ozs7/ysrK/86Ojr/Ojo6/zo6Ov9KSkr/Ojo6/zo6Ov8rKyv/hoaG/4aGhv9/f3//Ozs7/4aGhv+Ghob/f39//zs7O/8rKyv/Ojo6/zo6Ov86Ojr/Ojo6/zo6Ov86Ojr/Kysr/ysrK/8rKyv/Hh4e/x4eHv9/f3//f39//39/f/87Ozv/Kysr/zo6Ov86Ojr/Ojo6/zo6Ov86Ojr/Ojo6/zo6Ov86Ojr/Ojo6/zo6Ov8eHh7/f39//39/f/+Ghob/QUFB/x4eHv8rKyv/Kysr/zo6Ov86Ojr/Ojo6/zo6Ov86Ojr/Kysr/ysrK/86Ojr/Hh4e/x4eHv8eHh7/Kysr/x4eHv8eHh7/Kysr/zo6Ov8rKyv/Kysr/zo6Ov86Ojr/Kysr/ysrK/8rKyv/Kysr/zo6Ov8rKyv/Ojo6/zo6Ov8eHh7/Hh4e/x4eHv8eHh7/Hh4e/x4eHv8eHh7/Hh4e/x4eHv8eHh7/Hh4e/x4eHv8eHh7/Hh4e/x4eHv8eHh7/Hh4e/w==" },
  stairs_down: { w: 16, h: 16, rgba: "XV1d/1ZWVv9PT0//T09P/09PT/9PT0//T09P/1ZWVv9WVlb/VlZW/1ZWVv9WVlb/VlZW/1ZWVv9WVlb/T09P/1ZWVv+MjIz/jIyM/5OTk/+MjIz/g4OD/4ODg/+MjIz/jIyM/5OTk/+MjIz/g4OD/5OTk/+Dg4P/g4OD/09PT/8zMzP/QkJC/09PT/9CQkL/T09P/0JCQv9PT0//QkJC/09PT/9CQkL/MzMz/0JCQv9CQkL/T09P/4yMjP9PT0//VlZW/09PT/9PT0//T09P/1ZWVv8zMzP/QkJC/zMzM/8zMzP/QkJC/zMzM/8zMzP/MzMz/0JCQv+MjIz/VlZW/09PT/+Tk5P/g4OD/4yMjP9PT0//MzMz/zMzM/8zMzP/MzMz/yAgIP8zMzP/MzMz/zMzM/8zMzP/jIyM/1ZWVv9WVlb/k5OT/4ODg/+MjIz/T09P/0JCQv9CQkL/T09P/09PT/8gICD/MzMz/yAgIP8zMzP/MzMz/5OTk/9WVlb/VlZW/5OTk/+MjIz/g4OD/1ZWVv9wcHD/cHBw/3BwcP9CQkL/ICAg/yAgIP8gICD/ICAg/yAgIP+Tk5P/T09P/1ZWVv+MjIz/k5OT/5OTk/9WVlb/cHBw/4ODg/9wcHD/QkJC/0JCQv8zMzP/QkJC/zMzM/8gICD/k5OT/09PT/9dXV3/g4OD/4yMjP+MjIz/VlZW/3BwcP9wcHD/cHBw/0JCQv9dXV3/XV1d/3BwcP9CQkL/ICAg/4ODg/9PT0//T09P/4ODg/+MjIz/jIyM/1ZWVv9wcHD/cHBw/3BwcP9CQkL/cHBw/1ZWVv9wcHD/MzMz/zMzM/+MjIz/T09P/11dXf+MjIz/jIyM/4ODg/9WVlb/cHBw/3BwcP9wcHD/QkJC/11dXf9dXV3/XV1d/0JCQv9WVlb/g4OD/09PT/9dXV3/k5OT/5OTk/+Dg4P/VlZW/3BwcP9wcHD/g4OD/09PT/9dXV3/XV1d/1ZWVv8zMzP/QkJC/4ODg/9PT0//XV1d/4yMjP+MjIz/g4OD/09PT/9wcHD/cHBw/3BwcP9CQkL/XV1d/3BwcP9WVlb/MzMz/0JCQv+MjIz/VlZW/09PT/9PT0//T09P/1ZWVv9WVlb/T09P/09PT/9PT0//QkJC/zMzM/9CQkL/MzMz/0JCQv8zMzP/k5OT/09PT/9WVlb/g4OD/5OTk/+Dg4P/g4OD/4yMjP+Tk5P/jIyM/4ODg/+Dg4P/g4OD/5OTk/+MjIz/k5OT/5OTk/9PT0//VlZW/09PT/9WVlb/VlZW/09PT/9PT0//VlZW/11dXf9PT0//VlZW/09PT/9WVlb/T09P/1ZWVv9WVlb/VlZW/w==" },
  embers: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/0JCPv9TUk7/Ozo2/zs6Nv8AAAD/AAAA/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv9NBQj/ngsP/wAAAP9MS0f/NTQx/0xLR/9TUk7/PTw5/wAAAP81NDH/U1JO/1NSTv9MS0f/U1JO/z8+O/8AAAD/AAAA/wAAAP8/Pjv/U1JO/zU0Mf9PTkr/U1JO/0xLR/9PTkr/NTQx/0JCPv8gHx7/U1JO/wAAAP8AAAD/AAAA/wAAAP8gHx7/U1JO/09OSv81NDH/AAAA/wAAAP9TUk7/TEtH/zU0Mf9GRUH/U1JO/1NSTv87Ojb/AAAA/wAAAP8AAAD/T05K/1NSTv9PTkr/Ly4r/54LD/9NBQj/Ozo2/zU0Mf87Ojb/GBcW/zs6Nv87Ojb/U1JO/0xLR/8vLiv/PTw5/1NSTv8AAAD/AAAA/wAAAP8AAAD/AAAA/1NSTv9TUk7/HBwa/wAAAP8AAAD/T05K/0JCPv9PTkr/Ozo2/1NSTv9TUk7/U1JO/0JCPv8AAAD/Pz47/1NSTv9PTkr/U1JO/0xLR/8AAAD/AAAA/z8+O/9TUk7/RkVB/zs6Nv9GRUH/U1JO/z8+O/9GRUH/Ozo2/09OSv8AAAD/ISEf/1NSTv9TUk7/Ozo2/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9PTkr/TQUI/24ICv9CQj7/T05K/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/54LD/8AAAD/T05K/0ZFQf81NDH/U1JO/1NSTv8AAAD/T05K/1NSTv87Ojb/T05K/09OSv8AAAD/ISEf/1NSTv9PTkr/ISEf/1NSTv9PTkr/Ozo2/0xLR/9TUk7/T05K/0xLR/9GRUH/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/T05K/09OSv9PTkr/TEtH/zs6Nv81NDH/Ozo2/zs6Nv8AAAD/Kion/zU0Mf9TUk7/U1JO/zU0Mf81NDH/NTQx/zs6Nv87Ojb/Ozo2/zs6Nv8YFxb/AAAA/zU0Mf8AAAD/AAAA/wAAAP81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv8cHBr/T05K/1NSTv9TUk7/T05K/wAAAP81NDH/T05K/0JCPv8AAAD/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  grass: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9Idjz/T05K/0xLR/9TUk7/T05K/zs6Nv9GRUH/U1JO/1NSTv9MS0f/NTQx/0xLR/9TUk7/TEtH/0ZFQf81NDH/U1JO/1NSTv9MS0f/U1JO/09OSv81NDH/T05K/1NSTv9PTkr/SHY8/1mZSv9PTkr/U1JO/0xLR/9PTkr/NTQx/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/1mZSv88Ozj/U1JO/09OSv9Idjz/WZlK/0h2PP9TUk7/TEtH/zU0Mf9GRUH/U1JO/1NSTv87Ojb/Ozo2/zU0Mf9TUk7/T05K/1NSTv88Ozj/SHY8/0h2PP8oKCX/Ozo2/zU0Mf9ZmUr/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/TEtH/1NSTv9TUk7/U1JO/zU0Mf9GRUH/U1JO/1NSTv9TUk7/RkVB/1mZSv9Idjz/T05K/1NSTv9PTkr/Ozo2/1NSTv9TUk7/U1JO/1NSTv87Ojb/T05K/1NSTv9PTkr/U1JO/zo5Nv9Idjz/Pz47/09OSv9TUk7/RkVB/zs6Nv9GRUH/U1JO/09OSv9GRUH/Ozo2/09OSv9PTkr/U1JO/1NSTv9TUk7/Ozo2/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9PTkr/U1JO/09OSv9TUk7/T05K/zU0Mf87Ojb/NTQx/zs6Nv9ZmUr/WZlK/0xLR/9Idjz/T05K/0ZFQf81NDH/SHY8/1NSTv9PTkr/T05K/1NSTv87Ojb/T05K/09OSv87Ojb/Pz47/0h2PP9Idjz/Pz47/1NSTv9PTkr/Ozo2/0xLR/9TUk7/T05K/0xLR/9GRUH/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/T05K/09OSv9PTkr/TEtH/zs6Nv81NDH/Ozo2/zs6Nv81NDH/NTQx/zU0Mf9TUk7/U1JO/zU0Mf81NDH/NTQx/zs6Nv87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9MS0f/WZlK/zs6Nv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf9ZmUr/T05K/0h2PP81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/LSwp/0h2PP8/Pjv/KCgl/1NSTv9TUk7/U1JO/w==" },
  chasm: { w: 16, h: 16, rgba: "AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/w==" },
  well: { w: 16, h: 16, rgba: "U1JO/1NSTv+am43/k5aI/5udjv+Tloj/j5GE/5OWiP+am43/j5GE/5udjv+PkYT/mpuN/5udjv9TUk7/T05K/1NSTv+am43/jY6A/42OgP+NjoD/jY6A/42OgP+NjoD/j5GE/4+RhP+NjoD/jY6A/42OgP+Fh3r/j5GE/0xLR/9TUk7/k5aI/4+RhP9NTkT/NDYt/zQ2Lf80Ni3/NDYt/zAxKv80Ni3/MDEq/zAxKv9KS0L/mpuN/42OgP9MS0f/U1JO/5OWiP+NjoD/IiMc/zAxKv85OzL/MDEq/zk7Mv8wMSr/NDYt/zQ2Lf8wMSr/IiMc/5OWiP+NjoD/U1JO/0xLR/+PkYT/jY6A/yIjHP80Ni3/NDYt/zAxKv8wMSr/MDEq/zAxKv8wMSr/NDYt/yIjHP+Tloj/hYd6/1NSTv87Ojb/m52O/4WHev8iIxz/MDEq/zQ2Lf80Ni3/OTsy/zQ2Lf80Ni3/MDEq/zAxKv8iIxz/k5aI/42OgP87Ojb/U1JO/5qbjf+PkYT/GhsWhQAAADMAAAAzAAAAMwAAADMAAAAzAAAAMwAAADMAAAAzGhsWhZOWiP+Fh3r/T05K/1NSTv+bnY7/jY6A/wAAADMAAAAzAAAAMwAAADMAAAAzAAAAMwAAADMAAAAzAAAAMwAAADObnY7/jY6A/09OSv9TUk7/k5aI/42OgP8AAAAzAAAAMwAAADMAAAAzAAAAMwAAADMAAAAzAAAAMwAAADMAAAAzj5GE/42OgP9PTkr/NTQx/5OWiP+PkYT/AAAAMwAAADMAAAAzAAAAMwAAADMAAAAzAAAAMwAAADMAAAAzAAAAM5OWiP+NjoD/NTQx/zs6Nv+Tloj/hYd6/2ZoXoUAAAAzAAAAMwAAADMAAAAzAAAAMwAAADMAAAAzAAAAM2ZoXoWam43/jY6A/09OSv87Ojb/m52O/4WHev+am43/k5aI/5udjv+Tloj/mpuN/4+RhP+Tloj/k5aI/5qbjf+am43/jY6A/4WHev9PTkr/Ozo2/0VHPv+NjoD/j5GE/4WHev+Fh3r/jY6A/42OgP+NjoD/j5GE/42OgP+PkYT/j5GE/4WHev85OzL/U1JO/zU0Mf85OzL/OTsy/0VHPv9FRz7/RUc+/zk7Mv9FRz7/RUc+/0VHPv85OzL/RUc+/0VHPv9FRz7/MDEq/zU0Mf9TUk7/RkVB/zk7Mv85OzL/OTsy/zQ2Lf85OzL/OTsy/zk7Mv80Ni3/OTsy/zk7Mv85OzL/OTsy/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  pedestal: { w: 16, h: 16, rgba: "mpqa/5mZmf+ZmZn/mJiY/5eXl/+YmJj/mZmZ/5mZmf+ZmZn/mZmZ/5qamv+ampr/mZmZ/5mZmf+ZmZn/mJiY/42Njf+AgID/gICA/4GBgf+AgID/f39//39/f/+AgID/gICA/4GBgf+AgID/fn5+/4GBgf9/f3//f39//3Fxcf+NjY3/gICA/4GBgf9zc3P/dHR0/3Nzc/90dHT/c3Nz/3R0dP9zc3P/cnJy/3Nzc/9/f3//gYGB/4CAgP9ycnL/jIyM/4CAgP9/f3//c3Nz/4GBgf9/f3//gYGB/39/f/+AgID/gICA/35+fv+AgID/i4uL/4GBgf+AgID/c3Nz/4uLi/+AgID/fn5+/3Nzc/9/f3//gICA/39/f/9/f3//gYGB/39/f/+BgYH/gICA/4yMjP+AgID/gICA/3Nzc/+MjIz/gYGB/39/f/9zc3P/f39//4CAgP9/f3//goKC/4GBgf+AgID/gICA/39/f/+MjIz/gICA/4GBgf9zc3P/jIyM/4GBgf+AgID/cnJy/4CAgP+AgID/gICA/39/f/9/f3//gICA/4CAgP+AgID/i4uL/4CAgP+CgoL/c3Nz/4yMjP+AgID/gICA/3Nzc/+AgID/gICA/4GBgf+AgID/gICA/4GBgf9/f3//gYGB/4uLi/9/f3//gICA/3Nzc/+NjY3/f39//4CAgP9zc3P/gYGB/39/f/9/f3//gICA/4CAgP+AgID/gICA/4GBgf+NjY3/gYGB/39/f/9zc3P/ioqK/39/f/+AgID/gICA/4yMjP+MjIz/jIyM/4uLi/+MjIz/jY2N/4uLi/+NjY3/i4uL/4CAgP+AgID/cXFx/42Njf+AgID/gICA/39/f/+BgYH/gICA/39/f/+AgID/gICA/4CAgP+AgID/gICA/4GBgf+AgID/f39//3Jycv+CgoL/dHR0/3R0dP9ycnL/dHR0/3Nzc/9ycnL/dHR0/3R0dP9zc3P/cnJy/3Jycv9ycnL/cnJy/3Jycv9ZWVn/YGBg/0pKSv9KSkr/SUlJ/0lJSf9JSUn/SkpK/0pKSv9KSkr/SkpK/0pKSv9JSUn/SkpK/0lJSf9KSkr/QEBA/15eXv9JSUn/SUlJ/0pKSv9KSkr/SkpK/0pKSv9KSkr/SUlJ/0lJSf9KSkr/SkpK/0pKSv9JSUn/SkpK/z8/P/9gYGD/SUlJ/0pKSv9JSUn/SUlJ/0pKSv9KSkr/SkpK/0lJSf9JSUn/SUlJ/0pKSv9KSkr/SkpK/0pKSv9AQED/X19f/0pKSv9KSkr/SkpK/0pKSv9JSUn/SkpK/0pKSv9JSUn/SkpK/0pKSv9KSkr/SkpK/0pKSv9KSkr/QEBA/w==" },
  statue: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv9GRUH/U1JO/1NSTv//////NTQx/0xLR/+Li4v/TEtH/0ZFQf81NDH/U1JO/1NSTv9MS0f/U1JO/09OSv81NDH/p6el//////9PTkr/urq4/729vf+9vb3/dXRz/0xLR/+9vb3/YGBe/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx//////+9vb3/U1JO/09OSv+Li4v/i4uL/0xLR/9TUk7/vb29/4uLi/9GRUH/U1JO/1NSTv87Ojb/Ozo2/zU0Mf//////vb29/729vf9PTkr//////4uLi/81NDH/vb29/729vf+Li4v/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb//////729vf+9vb3///////////+Li4v/vb29/729vf+Li4v/i4uL/zs6Nv9PTkr/T05K/1NSTv9PTkr/Ozo2//////+IiIb/vb29//////+9vb3/vb29/729vf+Li4v/b29t/4uLi/81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv//////U1JO/4aGhP//////vb29/729vf+Li4v/b29t/1NSTv+Li4v/Ozo2/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/nZ2b/zs6Nv87Ojb/i4uL/729vf+9vb3/i4uL/09OSv9TUk7/bW1r/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/5udjv+bnY7/jY6A/42OgP//////i4uL/42OgP+NjoD/m52O/5udjv87Ojb/T05K/09OSv87Ojb/U1JO/0JCPv+bnY7/hYd6/4WHev//////vb29/729vf+Li4v/hYd6/4WHev+bnY7/Kion/09OSv9PTkr/Ozo2/0xLR/8/Pjv/m52O/5udjv+NjoD/jY6A/42OgP+NjoD/jY6A/42OgP+bnY7/m52O/yoqJ/9TUk7/U1JO/zU0Mf81NDH/Kion/2VmXP9lZlz/ZWZc/2VmXP9lZlz/ZWZc/2VmXP9lZlz/ZWZc/2VmXP8qKif/Ozo2/zU0Mf9TUk7/RkVB/y8uK/9YWVD/WFlQ/1hZUP9YWVD/WFlQ/1hZUP9YWVD/WFlQ/1hZUP9YWVD/PTw5/1NSTv9PTkr/U1JO/09OSv87Ojb/QkI+/z8+O/89PDn/QkI+/0JCPv8/Pjv/Ly4r/z8+O/9CQj7/Kion/1NSTv9TUk7/U1JO/w==" },
  bookshelf: { w: 16, h: 16, rgba: "al5C/2hbP/9VSS3/ZFg8/2VYPP9qXUH/YlY6/2ZZPf9pXED/X1I3/2RXO/9jVjr/XE8z/2NWOv9qXUH/aFxA/2RYPP8+OjD/Mi4k/zIuJP8vKyL/Lysi/y8rIv8yLiT/Mi4k/zIuJP8dSS7/GkYr/zIuJP88OC7/PDgu/2FUOP9qXkL/dyws/zUwJv86O2r/QTwy/0E8Mv8+OC7/Mi0j/4KBf/9BPDL/WF40/1VbMf9ra2n/QTwy/2cpOv9nWz//aVxA/3csLP9LSG3/Pj9u/0lcM/9CPDH/RD4z/zUvJP+Dg4H/eSlD/yZSNv8nUzj/a2tp/0Q+M/9lJzj/aV1B/2FUOP91Kyv/S0ht/0BBcP9HWjH/R08z/0I8Mf81LyT/goF//3UlQP8pVTr/JlI2/2traf8jPVL/Zyk6/2pdQf9gVDj/fz4l/0tIbf9AQXD/RU0x/0lcM/9CPDH/ODIn/3l5d/9qGjX/T1Us/0xSKf9ubmz/HThN/1sdLv9bTzP/al5C/20qKv9JR2f/Ojtl/0E8Mv9GVzL/QTwy/zItI/91dXP/cSlA/ylQOP8pUDj/bGtp/x01SP9fJzb/ZFc7/2xfQ/9kVzv/XE8z/2ZaPv9sX0P/aVxA/2dbP/9bTzP/aV1B/2ZZPf9qXUH/aFs//2dbP/9XSi//bF9D/2lcQP9nWz//ODMq/zIuJP84Myr/Pjow/zw4Lv84Myr/Mi4k/zw4Lv88OC7/Pjow/z46MP8+OjD/Mi4k/zgzKv9jVzv/WU0y/2traf81MCb/gXZo/zUwJv9bHT7/WBo8/zItI/8/OjD/QTwy/z86MP9BPDL/Pzow/zItI/81MCb/XE80/2BTOP90c3H/aWUl/4p/cP9EPjP/ZSdI/2EiRP9GVHX/RD4z/0Q+M/9CPDH/Qjwx/yliQv8dVjb/J2BA/2JWOv9eUTX/enp4/2tnJ/+LgHL/QEFw/2cpSv9lJ0j/SVd4/0A6L/9EPjP/eHh2/3d2dP90c3H/a2tp/3h4dv9kWDz/XVE1/3d2dP9pZSX/i4By/z4/bv9+RED/fUM+/0lXeP9cWBj/ODIn/zgyJ/8xMmL/MTJi/zEyYv9AQXD/aVxA/11RNv9ra2n/XFgY/4F2aP80NWT/Wx0+/1sdPv9JV3j/XFgY/zUvJP9ZPGz/WTxs/1EzZP9rRUr/UTNk/1tPNP9qXkL/bGtp/1hUG/99c2X/PD1n/2EpRv9hKUb/Tlt4/15aIP8yLSP/f358/4GAfv9ycXD/fX17/4GAfv9lWT3/aFs//2RYPP9dUTX/Zlo+/2peQv9mWT3/aFs//2daPv9mWT3/Wk4y/2ldQf9lWDz/V0ov/2daPv9rXkL/bGBE/w==" },
  alchemy: { w: 16, h: 16, rgba: "WUIf/1lCH/9TPRv/Uz0b/0IyHP9MOBv/PS0W/zUoFv9HNRn/RzUZ/1lCH/9ZQh//WUIf/1M9G/9TPRv/Uz0b/0IyHP9CMhz/QjIc/0IyHP8xJBL/MSQS/97cx//e3Mf/3tzH/97cx/81KBb/MSQS/0IyHP89LRf/PS0X/z0tF/9mSR//Zkkf/2ZJH/9SOhn/3tzH/97cx/99fHL/PDw6/zw8Ov99fHL/3tzH/6ytpf89LRb/Uz0b/0IyHP9mSR//QjIc/z0tF/8xJBL/3tzH/zw8Ov88PDr/PDw6/zw8Ov88PDr/PDw6/zw8Ov88PDr/rK2l/zUoFv89LRf/QjIc/1lCH/9SOhn/3tzH/318cv88PDr/PDw6/zw8Ov88PDr/PDw6/zw8Ov88PDr/PDw6/2lpZf+sraX/UjoZ/2ZJH/9ZQh//QjEW/97cx/88PDr/PDw6/wAAADMAAAAzAAAAMwAAADMAAAAzAAAAMzw8Ov88PDr/rK2l/0c1Gf9TPRv/NSgW/6WKU//e3Mf/AAAAMwAAADMAAAAzAAAAMwAAADMAAAAzAAAAMwAAADMAAAAzAAAAM6ytpf+lilP/MSQS/1I6Gf+lilP/3tzH/6upmYUAAAAzAAAAMwAAADMAAAAzAAAAMwAAADMAAAAzAAAAM4SFf4WsraX/pYpT/zEkEv9HNRn/bFY+/6WKU//e3Mf/AAAAMwAAADMAAAAzAAAAMwAAADMAAAAzAAAAMwAAADOsraX/pYpT/2xWPv8xJBL/MSQS/2xWPv+lilP/pYpT/6ytpf+sraX/hIV/hQAAADMAAAAzhIV/haytpf+sraX/pYpT/6WKU/9sVj7/MSQS/2ZJH/9SOhn/bFY+/6WKU/+lilP/pYpT/6ytpf+sraX/rK2l/6ytpf+lilP/pYpT/6WKU/9sVj7/UjoZ/2ZJH/9ZQh//RzUZ/2xWPv9sVj7/bFY+/6WKU/+lilP/pYpT/6WKU/+lilP/pYpT/2xWPv9sVj7/bFY+/0IxFv9TPRv/QjIc/0IyHP8xJBL/bFY+/2xWPv9sVj7/bFY+/2xWPv9sVj7/bFY+/2xWPv9sVj7/bFY+/zEkEv9CMhz/QjIc/z0tF/9mSR//Zkkf/1I6Gf9sVj7/bFY+/2xWPv9sVj7/bFY+/2xWPv9sVj7/bFY+/0c1Gf9TPRv/WUIf/0w4G/9CMhz/PS0X/0IyHP89LRf/MSQS/zUoFv9dQyj/XUMo/11DKP9dQyj/MSQS/zUoFv89LRf/QjIc/0IyHP89LRf/Zkkf/1M9G/9TPRv/WUIf/1M9G/9TPRv/RzUZ/zUoFv9SOhn/UjoZ/2ZJH/9mSR//Zkkf/2ZJH/9mSR//Zkkf/w==" },
  water: { w: 16, h: 16, rgba: "SnVh/z5qVf8+alX/PmpV/z5qVf8+alX/SnVh/0p1Yf9KdWH/PmpV/z5qVf8+alX/PmpV/z5qVf8+alX/PmpV/0p1Yf9KdWH/PmpV/zVfS/81X0v/PmpV/0p1Yf9KdWH/SnVh/z5qVf81X0v/PmpV/z5qVf8+alX/PmpV/z5qVf9KdWH/SnVh/z5qVf8+alX/SnVh/0p1Yf8+alX/NV9L/z5qVf81X0v/PmpV/z5qVf8+alX/PmpV/z5qVf8+alX/SnVh/0p1Yf9KdWH/SnVh/0p1Yf8+alX/NV9L/zVfS/81X0v/NV9L/z5qVf8+alX/NV9L/z5qVf8+alX/PmpV/z5qVf9KdWH/SnVh/0p1Yf8+alX/PmpV/zVfS/81X0v/NV9L/z5qVf8+alX/PmpV/zVfS/81X0v/NV9L/z5qVf9Qe13/SnVh/0p1Yf9KdWH/SnVh/z5qVf8+alX/PmpV/z5qVf8+alX/PmpV/z5qVf81X0v/PmpV/zVfS/8+alX/SnVh/0p1Yf9KdWH/SnVh/0p1Yf8+alX/SnVh/0p1Yf9KdWH/PmpV/z5qVf8+alX/PmpV/z5qVf81X0v/NV9L/z5qVf8+alX/NV9L/zVfS/8+alX/PmpV/z5qVf9KdWH/SnVh/z5qVf8+alX/NV9L/zVfS/81X0v/NV9L/z5qVf81X0v/PmpV/z5qVf8+alX/NV9L/zVfS/81X0v/PmpV/0p1Yf8+alX/PmpV/zVfS/81X0v/NV9L/z5qVf81X0v/NV9L/z5qVf8+alX/PmpV/zVfS/81X0v/NV9L/zVfS/9KdWH/SnVh/z5qVf8+alX/NV9L/zVfS/81X0v/NV9L/z5qVf81X0v/NV9L/zVfS/81X0v/NV9L/zVfS/81X0v/NV9L/0p1Yf9KdWH/SnVh/z5qVf81X0v/NV9L/zVfS/8+alX/PmpV/zVfS/8+alX/NV9L/zVfS/81X0v/NV9L/zVfS/81X0v/SnVh/1B7Xf9Qe13/PmpV/z5qVf81X0v/PmpV/0p1Yf8+alX/PmpV/z5qVf8+alX/PmpV/z5qVf8+alX/PmpV/z5qVf9KdWH/SnVh/0p1Yf9KdWH/PmpV/zVfS/9KdWH/UHtd/0p1Yf8+alX/PmpV/z5qVf8+alX/PmpV/zVfS/81X0v/NV9L/z5qVf8+alX/PmpV/z5qVf8+alX/SnVh/z5qVf8+alX/PmpV/zVfS/8+alX/NV9L/zVfS/81X0v/NV9L/zVfS/81X0v/NV9L/zVfS/81X0v/PmpV/zVfS/81X0v/PmpV/z5qVf81X0v/NV9L/zVfS/81X0v/NV9L/zVfS/81X0v/NV9L/zVfS/81X0v/NV9L/w==" },
  trap_revealed: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv8qKSf/MjEv/1NSTv9MS0f/IB8d/y4tK/9TUk7/TEtH/yopJ/8gHx3/U1JO/1NSTv9MS0f/U1JO/09OSv8gHx3/K7hB/xypMv9PTkr/MjEv/wCEDf8LmCH/U1JO/y4tK/8Zpi//Haoz/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/yGuN/8bqDH/dXVx/09OSv8Rnif/DZoj/3BvbP9TUk7/HKky/yWyO/9ramf/U1JO/1NSTv87Ojb/Ozo2/zU0Mf91dXH/cnFu/1NSTv9PTkr/YmFe/2JhXv81NDH/Ozo2/11dWv9iYV7/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/Li0r/zIxL/9TUk7/U1JO/yAfHf8qKSf/U1JO/1NSTv8yMS//Kikn/zs6Nv9PTkr/T05K/1NSTv9PTkr/IyMg/wCJEv8eqzT/U1JO/zIxL/8Jlh//Haoz/1NSTv8vLyz/IK02/wCNFv81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv8apzD/K7hB/3Jxbv9GRUH/C5gh/xuoMf9ycW7/U1JO/yazPP8Snyj/YmFe/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/YmFe/2JhXv87Ojb/NTQx/11dWv9ycW7/U1JO/09OSv91dXH/cnFu/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/y4tK/8yMS//T05K/0ZFQf8gHx3/MjEv/1NSTv9PTkr/Ly8s/zIxL/87Ojb/T05K/09OSv87Ojb/U1JO/zIxL/8ptj//DJki/1NSTv8vLyz/JbI7/wmWH/9TUk7/Ly8s/xShKv8OmyT/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/AIcQ/wiVHv9ycW7/TEtH/xuoMf8cqTL/YmFe/zs6Nv8Rnif/IK02/11dWv9TUk7/U1JO/zU0Mf81NDH/NTQx/2JhXv9iYV7/Ozo2/zs6Nv9iYV7/XV1a/zU0Mf9MS0f/cG9s/2JhXv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_toxic: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv8qKSf/MjEv/1NSTv9MS0f/IB8d/y4tK/9TUk7/TEtH/yopJ/8gHx3/U1JO/1NSTv9MS0f/U1JO/09OSv8gHx3/K7hB/xypMv9PTkr/MjEv/wCEDf8LmCH/U1JO/y4tK/8Zpi//Haoz/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/yGuN/8bqDH/dXVx/09OSv8Rnif/DZoj/3BvbP9TUk7/HKky/yWyO/9ramf/U1JO/1NSTv87Ojb/Ozo2/zU0Mf91dXH/cnFu/1NSTv9PTkr/YmFe/2JhXv81NDH/Ozo2/11dWv9iYV7/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/Li0r/zIxL/9TUk7/U1JO/yAfHf8qKSf/U1JO/1NSTv8yMS//Kikn/zs6Nv9PTkr/T05K/1NSTv9PTkr/IyMg/wCJEv8eqzT/U1JO/zIxL/8Jlh//Haoz/1NSTv8vLyz/IK02/wCNFv81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv8apzD/K7hB/3Jxbv9GRUH/C5gh/xuoMf9ycW7/U1JO/yazPP8Snyj/YmFe/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/YmFe/2JhXv87Ojb/NTQx/11dWv9ycW7/U1JO/09OSv91dXH/cnFu/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/y4tK/8yMS//T05K/0ZFQf8gHx3/MjEv/1NSTv9PTkr/Ly8s/zIxL/87Ojb/T05K/09OSv87Ojb/U1JO/zIxL/8ptj//DJki/1NSTv8vLyz/JbI7/wmWH/9TUk7/Ly8s/xShKv8OmyT/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/AIcQ/wiVHv9ycW7/TEtH/xuoMf8cqTL/YmFe/zs6Nv8Rnif/IK02/11dWv9TUk7/U1JO/zU0Mf81NDH/NTQx/2JhXv9iYV7/Ozo2/zs6Nv9iYV7/XV1a/zU0Mf9MS0f/cG9s/2JhXv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_fire: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv8qKSf/MjEv/1NSTv9MS0f/IB8d/y4tK/9TUk7/TEtH/yopJ/8gHx3/U1JO/1NSTv9MS0f/U1JO/09OSv8gHx3//38V//9wBv9PTkr/MjEv/+BLAP/0XwD/U1JO/y4tK///bQP//3EH/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx//91C///bwX/dXVx/09OSv/6ZQD/9mEA/3BvbP9TUk7//3AG//95D/9ramf/U1JO/1NSTv87Ojb/Ozo2/zU0Mf91dXH/cnFu/1NSTv9PTkr/YmFe/2JhXv81NDH/Ozo2/11dWv9iYV7/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/Li0r/zIxL/9TUk7/U1JO/yAfHf8qKSf/U1JO/1NSTv8yMS//Kikn/zs6Nv9PTkr/T05K/1NSTv9PTkr/IyMg/+VQAP//cgj/U1JO/zIxL//yXQD//3EH/1NSTv8vLyz//3QK/+lUAP81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv//bgT//38V/3Jxbv9GRUH/9F8A//9vBf9ycW7/U1JO//96EP/7ZgD/YmFe/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/YmFe/2JhXv87Ojb/NTQx/11dWv9ycW7/U1JO/09OSv91dXH/cnFu/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/y4tK/8yMS//T05K/0ZFQf8gHx3/MjEv/1NSTv9PTkr/Ly8s/zIxL/87Ojb/T05K/09OSv87Ojb/U1JO/zIxL///fRP/9WAA/1NSTv8vLyz//3kP//JdAP9TUk7/Ly8s//1oAP/3YgD/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/404A//FcAP9ycW7/TEtH//9vBf//cAb/YmFe/zs6Nv/6ZQD//3QK/11dWv9TUk7/U1JO/zU0Mf81NDH/NTQx/2JhXv9iYV7/Ozo2/zs6Nv9iYV7/XV1a/zU0Mf9MS0f/cG9s/2JhXv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_paralytic: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv8qKSf/MjEv/1NSTv9MS0f/IB8d/y4tK/9TUk7/TEtH/yopJ/8gHx3/U1JO/1NSTv9MS0f/U1JO/09OSv8gHx3/0qJe/86lXP9PTkr/MjEv/8K2UP/ItEb/U1JO/y4tK//OuVL/0rRY/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/8uzWf/Dokn/dXVx/09OSv/Wol//v6NR/3BvbP9TUk7/wqVG/8C5T/9ramf/U1JO/1NSTv87Ojb/Ozo2/zU0Mf91dXH/cnFu/1NSTv9PTkr/YmFe/2JhXv81NDH/Ozo2/11dWv9iYV7/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/Li0r/zIxL/9TUk7/U1JO/yAfHf8qKSf/U1JO/1NSTv8yMS//Kikn/zs6Nv9PTkr/T05K/1NSTv9PTkr/IyMg/8a6X//Vq13/U1JO/zIxL//SsVj/2KlV/1NSTv8vLyz/xqpY/7+kWv81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv+/t0//x7dJ/3Jxbv9GRUH/1rpU/8inU/9ycW7/U1JO/82sSf/Er1P/YmFe/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/YmFe/2JhXv87Ojb/NTQx/11dWv9ycW7/U1JO/09OSv91dXH/cnFu/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/y4tK/8yMS//T05K/0ZFQf8gHx3/MjEv/1NSTv9PTkr/Ly8s/zIxL/87Ojb/T05K/09OSv87Ojb/U1JO/zIxL//NpFr/06pK/1NSTv8vLyz/06tG/9GzUv9TUk7/Ly8s/8ymTv/Fs1b/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/wKhY/8yqR/9ycW7/TEtH/8+tRf/ItFv/YmFe/zs6Nv/Vslv/zbBa/11dWv9TUk7/U1JO/zU0Mf81NDH/NTQx/2JhXv9iYV7/Ozo2/zs6Nv9iYV7/XV1a/zU0Mf9MS0f/cG9s/2JhXv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_poison: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv8qKSf/MjEv/1NSTv9MS0f/IB8d/y4tK/9TUk7/TEtH/yopJ/8gHx3/U1JO/1NSTv9MS0f/U1JO/09OSv8iISD/rkLv/6Ni4P9PTkr/LSwr/4ZN0/+WVc//U1JO/yoqKP+hT+D/pF7W/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/6dkyf+iX8r/dXVx/09OSv+aUuP/l1zd/3BvbP9TUk7/o2Dd/6lK6P9ramf/U1JO/1NSTv87Ojb/Ozo2/zU0Mf91dXH/cnFu/1NSTv9PTkr/YmFe/2JhXv81NDH/Ozo2/11dWv9iYV7/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/Li0r/zIxL/9TUk7/U1JO/yAfHf8qKSf/U1JO/1NSTv8yMS//Kikn/zs6Nv9PTkr/T05K/1NSTv9PTkr/JCQi/4pa0P+kVuX/U1JO/zIxL/+UYtX/o0na/1NSTv8rKyn/pkXo/41eyv81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv+hTtn/rkje/3Jxbv9GRUH/lVHP/6JW3f9ycW7/U1JO/6tR5v+bPeT/YmFe/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/YmFe/2JhXv87Ojb/NTQx/11dWv9ycW7/U1JO/09OSv91dXH/cnFu/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/y4tK/8yMS//T05K/0ZFQf8gHx3/MjEv/1NSTv9PTkr/Ly8s/zIxL/87Ojb/T05K/09OSv87Ojb/U1JO/y0sK/+tTtr/llvi/1NSTv8rKyn/qk3D/5Rez/9TUk7/Kysp/5xS1f+YW+H/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/iFLk/5NV3P9ycW7/TEtH/6JW0f+jWcv/YmFe/zs6Nv+aU+D/pVjd/11dWv9TUk7/U1JO/zU0Mf81NDH/NTQx/2JhXv9iYV7/Ozo2/zs6Nv9iYV7/XV1a/zU0Mf9MS0f/cG9s/2JhXv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_alarm: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv8qKSf/MjEv/1NSTv9MS0f/IB8d/y4tK/9TUk7/TEtH/yopJ/8gHx3/U1JO/1NSTv9MS0f/U1JO/09OSv8gHx3/tzQw/9Q3T/9PTkr/MjEv/74xRv++MCv/U1JO/y4tK//bN1f/wjM//1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/8IvMf/ILkj/dXVx/09OSv/MLTL/tTFQ/3BvbP9TUk7/xS0t/8UxVf9ramf/U1JO/1NSTv87Ojb/Ozo2/zU0Mf91dXH/cnFu/1NSTv9PTkr/YmFe/2JhXv81NDH/Ozo2/11dWv9iYV7/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/Li0r/zIxL/9TUk7/U1JO/yAfHf8qKSf/U1JO/1NSTv8yMS//Kikn/zs6Nv9PTkr/T05K/1NSTv9PTkr/IyMg/7osLf/OLCD/U1JO/zIxL/+wMi7/wzAm/1NSTv8vLyz/zCsg/8goIv81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv/DKij/wTg8/3Jxbv9GRUH/sjAv/7cuLf9ycW7/U1JO/703QP/HRVf/YmFe/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/YmFe/2JhXv87Ojb/NTQx/11dWv9ycW7/U1JO/09OSv91dXH/cnFu/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/y4tK/8yMS//T05K/0ZFQf8gHx3/MjEv/1NSTv9PTkr/Ly8s/zIxL/87Ojb/T05K/09OSv87Ojb/U1JO/zIxL/+3ICX/xys1/1NSTv8vLyz/wy46/8IvKv9TUk7/Ly8s/80rO//NMTb/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/wyxN/9AkLP9ycW7/TEtH/8E5RP/IMir/YmFe/zs6Nv/QGxr/yjkt/11dWv9TUk7/U1JO/zU0Mf81NDH/NTQx/2JhXv9iYV7/Ozo2/zs6Nv9iYV7/XV1a/zU0Mf9MS0f/cG9s/2JhXv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_lightning: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv8qKSf/MjEv/1NSTv9MS0f/IB8d/y4tK/9TUk7/TEtH/yopJ/8gHx3/U1JO/1NSTv9MS0f/U1JO/09OSv8gHx3/bKz6/2HM6/9PTkr/MjEv/0S33v9Uv9r/U1JO/y4tK/9fuev/Ysjh/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/2XO1P9gydX/dXVx/09OSv9YvO7/Vcbo/3BvbP9TUk7/Ycro/2e08/9ramf/U1JO/1NSTv87Ojb/Ozo2/zU0Mf91dXH/cnFu/1NSTv9PTkr/YmFe/2JhXv81NDH/Ozo2/11dWv9iYV7/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/Li0r/zIxL/9TUk7/U1JO/yAfHf8qKSf/U1JO/1NSTv8yMS//Kikn/zs6Nv9PTkr/T05K/1NSTv9PTkr/IyMg/0jE2/9iwPD/U1JO/zIxL/9SzOD/YbPl/1NSTv8vLyz/ZK/z/0vI1f81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv9fuOT/bLLp/3Jxbv9GRUH/U7va/2DA6P9ycW7/U1JO/2m78f9Zp+//YmFe/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/YmFe/2JhXv87Ojb/NTQx/11dWv9ycW7/U1JO/09OSv91dXH/cnFu/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/y4tK/8yMS//T05K/0ZFQf8gHx3/MjEv/1NSTv9PTkr/Ly8s/zIxL/87Ojb/T05K/09OSv87Ojb/U1JO/zIxL/9ruOX/VMXt/1NSTv8vLyz/aLfO/1LI2v9TUk7/Ly8s/1q84P9Wxez/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/Rrzv/1G/5/9ycW7/TEtH/2DA3P9hw9b/YmFe/zs6Nv9Yvev/Y8Lo/11dWv9TUk7/U1JO/zU0Mf81NDH/NTQx/2JhXv9iYV7/Ozo2/zs6Nv9iYV7/XV1a/zU0Mf9MS0f/cG9s/2JhXv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_gripping: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv8qKSf/MjEv/1NSTv9MS0f/IB8d/y4tK/9TUk7/TEtH/yopJ/8gHx3/U1JO/1NSTv9MS0f/U1JO/09OSv8gHx3/p4Ft/4l2av9PTkr/MjEv/5+fn/+Tk5P/U1JO/y4tK/+goKD/iXZq/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/8eEX/+Gc2n/dXVx/09OSv+Ghob/paWl/3BvbP9TUk7/rKys/7OFav9ramf/U1JO/1NSTv87Ojb/Ozo2/zU0Mf91dXH/cnFu/1NSTv9PTkr/YmFe/2JhXv81NDH/Ozo2/11dWv9iYV7/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/Li0r/zIxL/9TUk7/U1JO/yAfHf8qKSf/U1JO/1NSTv8yMS//Kikn/zs6Nv9PTkr/T05K/1NSTv9PTkr/IyMg/56env+enp7/U1JO/zIxL/+RkZH/r4Rs/1NSTv8vLyz/0mwy/7F0Vf81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv+uhGz/rIJt/3Jxbv9GRUH/h4eH/6ioqP9ycW7/U1JO/9VpLv+YcVv/YmFe/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/YmFe/2JhXv87Ojb/NTQx/11dWv9ycW7/U1JO/09OSv91dXH/cnFu/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/y4tK/8yMS//T05K/0ZFQf8gHx3/MjEv/1NSTv9PTkr/Ly8s/zIxL/87Ojb/T05K/09OSv87Ojb/U1JO/zIxL/+Hh4f/uYVo/1NSTv8vLyz/yHJE/9JsNf9TUk7/Ly8s/6Wlpf+ampr/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/o6Oj/7mFaP9ycW7/TEtH/9JkKP/Cc0n/YmFe/zs6Nv+ZmZn/mZmZ/11dWv9TUk7/U1JO/zU0Mf81NDH/NTQx/2JhXv9iYV7/Ozo2/zs6Nv9iYV7/XV1a/zU0Mf9MS0f/cG9s/2JhXv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_summoning: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv8qKSf/MjEv/1NSTv9MS0f/IB8d/y4tK/9TUk7/TEtH/yopJ/8gHx3/U1JO/1NSTv9MS0f/U1JO/09OSv8gHx3/mNn//9v///9PTkr/MjEv/4rL//+t7v//U1JO/y4tK//c////y////1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/6Di///G////dXVx/09OSv/c////svP//3BvbP9TUk7/svP//6Di//9ramf/U1JO/1NSTv87Ojb/Ozo2/zU0Mf91dXH/cnFu/1NSTv9PTkr/YmFe/2JhXv81NDH/Ozo2/11dWv9iYV7/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/Li0r/zIxL/9TUk7/U1JO/yAfHf8qKSf/U1JO/1NSTv8yMS//Kikn/zs6Nv9PTkr/T05K/1NSTv9PTkr/IyMg/6vs///O////U1JO/zIxL/+5+v//u/z//1NSTv8vLyz/q+z//8D///81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv+y8///wv///3Jxbv9GRUH/vv///5/g//9ycW7/U1JO/6Di///U////YmFe/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/YmFe/2JhXv87Ojb/NTQx/11dWv9ycW7/U1JO/09OSv91dXH/cnFu/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/y4tK/8yMS//T05K/0ZFQf8gHx3/MjEv/1NSTv9PTkr/Ly8s/zIxL/87Ojb/T05K/09OSv87Ojb/U1JO/zIxL/+P0P//isv//1NSTv8vLyz/ouP//53e//9TUk7/Ly8s/77////N////NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/1////6Lj//9ycW7/TEtH/+P///+k5f//YmFe/zs6Nv+29///3v///11dWv9TUk7/U1JO/zU0Mf81NDH/NTQx/2JhXv9iYV7/Ozo2/zs6Nv9iYV7/XV1a/zU0Mf9MS0f/cG9s/2JhXv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_toxic_secret: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv9GRUH/U1JO/1NSTv9MS0f/NTQx/0xLR/9TUk7/TEtH/0ZFQf81NDH/U1JO/1NSTv9MS0f/U1JO/09OSv81NDH/T05K/1NSTv9PTkr/U1JO/zU0Mf9PTkr/U1JO/0xLR/9PTkr/NTQx/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/1NSTv9PTkr/U1JO/09OSv81NDH/TEtH/0xLR/9TUk7/TEtH/zU0Mf9GRUH/U1JO/1NSTv87Ojb/Ozo2/zU0Mf9TUk7/T05K/1NSTv9PTkr/Ozo2/zs6Nv81NDH/Ozo2/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/TEtH/1NSTv9TUk7/U1JO/zU0Mf9GRUH/U1JO/1NSTv9TUk7/RkVB/zs6Nv9PTkr/T05K/1NSTv9PTkr/Ozo2/1NSTv9TUk7/U1JO/1NSTv87Ojb/T05K/1NSTv9PTkr/U1JO/0xLR/81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv9GRUH/U1JO/09OSv9GRUH/Ozo2/09OSv9PTkr/U1JO/1NSTv9TUk7/Ozo2/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9PTkr/U1JO/09OSv9TUk7/T05K/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/0xLR/9TUk7/T05K/0ZFQf81NDH/U1JO/1NSTv9PTkr/T05K/1NSTv87Ojb/T05K/09OSv87Ojb/U1JO/1NSTv9PTkr/U1JO/1NSTv9PTkr/Ozo2/0xLR/9TUk7/T05K/0xLR/9GRUH/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/T05K/09OSv9PTkr/TEtH/zs6Nv81NDH/Ozo2/zs6Nv81NDH/NTQx/zU0Mf9TUk7/U1JO/zU0Mf81NDH/NTQx/zs6Nv87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9MS0f/TEtH/zs6Nv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_fire_secret: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv9GRUH/U1JO/1NSTv9MS0f/NTQx/0xLR/9TUk7/TEtH/0ZFQf81NDH/U1JO/1NSTv9MS0f/U1JO/09OSv81NDH/T05K/1NSTv9PTkr/U1JO/zU0Mf9PTkr/U1JO/0xLR/9PTkr/NTQx/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/1NSTv9PTkr/U1JO/09OSv81NDH/TEtH/0xLR/9TUk7/TEtH/zU0Mf9GRUH/U1JO/1NSTv87Ojb/Ozo2/zU0Mf9TUk7/T05K/1NSTv9PTkr/Ozo2/zs6Nv81NDH/Ozo2/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/TEtH/1NSTv9TUk7/U1JO/zU0Mf9GRUH/U1JO/1NSTv9TUk7/RkVB/zs6Nv9PTkr/T05K/1NSTv9PTkr/Ozo2/1NSTv9TUk7/U1JO/1NSTv87Ojb/T05K/1NSTv9PTkr/U1JO/0xLR/81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv9GRUH/U1JO/09OSv9GRUH/Ozo2/09OSv9PTkr/U1JO/1NSTv9TUk7/Ozo2/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9PTkr/U1JO/09OSv9TUk7/T05K/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/0xLR/9TUk7/T05K/0ZFQf81NDH/U1JO/1NSTv9PTkr/T05K/1NSTv87Ojb/T05K/09OSv87Ojb/U1JO/1NSTv9PTkr/U1JO/1NSTv9PTkr/Ozo2/0xLR/9TUk7/T05K/0xLR/9GRUH/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/T05K/09OSv9PTkr/TEtH/zs6Nv81NDH/Ozo2/zs6Nv81NDH/NTQx/zU0Mf9TUk7/U1JO/zU0Mf81NDH/NTQx/zs6Nv87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9MS0f/TEtH/zs6Nv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_paralytic_secret: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv9GRUH/U1JO/1NSTv9MS0f/NTQx/0xLR/9TUk7/TEtH/0ZFQf81NDH/U1JO/1NSTv9MS0f/U1JO/09OSv81NDH/T05K/1NSTv9PTkr/U1JO/zU0Mf9PTkr/U1JO/0xLR/9PTkr/NTQx/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/1NSTv9PTkr/U1JO/09OSv81NDH/TEtH/0xLR/9TUk7/TEtH/zU0Mf9GRUH/U1JO/1NSTv87Ojb/Ozo2/zU0Mf9TUk7/T05K/1NSTv9PTkr/Ozo2/zs6Nv81NDH/Ozo2/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/TEtH/1NSTv9TUk7/U1JO/zU0Mf9GRUH/U1JO/1NSTv9TUk7/RkVB/zs6Nv9PTkr/T05K/1NSTv9PTkr/Ozo2/1NSTv9TUk7/U1JO/1NSTv87Ojb/T05K/1NSTv9PTkr/U1JO/0xLR/81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv9GRUH/U1JO/09OSv9GRUH/Ozo2/09OSv9PTkr/U1JO/1NSTv9TUk7/Ozo2/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9PTkr/U1JO/09OSv9TUk7/T05K/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/0xLR/9TUk7/T05K/0ZFQf81NDH/U1JO/1NSTv9PTkr/T05K/1NSTv87Ojb/T05K/09OSv87Ojb/U1JO/1NSTv9PTkr/U1JO/1NSTv9PTkr/Ozo2/0xLR/9TUk7/T05K/0xLR/9GRUH/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/T05K/09OSv9PTkr/TEtH/zs6Nv81NDH/Ozo2/zs6Nv81NDH/NTQx/zU0Mf9TUk7/U1JO/zU0Mf81NDH/NTQx/zs6Nv87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9MS0f/TEtH/zs6Nv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_inactive: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv8qKSf/MjEv/1NSTv9MS0f/IB8d/y4tK/9TUk7/TEtH/yopJ/8gHx3/U1JO/1NSTv9MS0f/U1JO/09OSv8gHx3/AAAA/wAAAP9PTkr/MjEv/wAAAP8AAAD/U1JO/y4tK/8AAAD/AAAA/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/wAAAP8AAAD/dXVx/09OSv8AAAD/AAAA/3BvbP9TUk7/AAAA/wAAAP9ramf/U1JO/1NSTv87Ojb/Ozo2/zU0Mf91dXH/cnFu/1NSTv9PTkr/YmFe/2JhXv81NDH/Ozo2/11dWv9iYV7/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/Li0r/zIxL/9TUk7/U1JO/yAfHf8qKSf/U1JO/1NSTv8yMS//Kikn/zs6Nv9PTkr/T05K/1NSTv9PTkr/IyMg/wAAAP8AAAD/U1JO/zIxL/8AAAD/AAAA/1NSTv8vLyz/AAAA/wAAAP81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv8AAAD/AAAA/3Jxbv9GRUH/AAAA/wAAAP9ycW7/U1JO/wAAAP8AAAD/YmFe/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/YmFe/2JhXv87Ojb/NTQx/11dWv9ycW7/U1JO/09OSv91dXH/cnFu/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/y4tK/8yMS//T05K/0ZFQf8gHx3/MjEv/1NSTv9PTkr/Ly8s/zIxL/87Ojb/T05K/09OSv87Ojb/U1JO/zIxL/8AAAD/AAAA/1NSTv8vLyz/AAAA/wAAAP9TUk7/Ly8s/wAAAP8AAAD/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/AAAA/wAAAP9ycW7/TEtH/wAAAP8AAAD/YmFe/zs6Nv8AAAD/AAAA/11dWv9TUk7/U1JO/zU0Mf81NDH/NTQx/2JhXv9iYV7/Ozo2/zs6Nv9iYV7/XV1a/zU0Mf9MS0f/cG9s/2JhXv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_poison_secret: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv9GRUH/U1JO/1NSTv9MS0f/NTQx/0xLR/9TUk7/TEtH/0ZFQf81NDH/U1JO/1NSTv9MS0f/U1JO/09OSv81NDH/T05K/1NSTv9PTkr/U1JO/zU0Mf9PTkr/U1JO/0xLR/9PTkr/NTQx/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/1NSTv9PTkr/U1JO/09OSv81NDH/TEtH/0xLR/9TUk7/TEtH/zU0Mf9GRUH/U1JO/1NSTv87Ojb/Ozo2/zU0Mf9TUk7/T05K/1NSTv9PTkr/Ozo2/zs6Nv81NDH/Ozo2/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/TEtH/1NSTv9TUk7/U1JO/zU0Mf9GRUH/U1JO/1NSTv9TUk7/RkVB/zs6Nv9PTkr/T05K/1NSTv9PTkr/Ozo2/1NSTv9TUk7/U1JO/1NSTv87Ojb/T05K/1NSTv9PTkr/U1JO/0xLR/81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv9GRUH/U1JO/09OSv9GRUH/Ozo2/09OSv9PTkr/U1JO/1NSTv9TUk7/Ozo2/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9PTkr/U1JO/09OSv9TUk7/T05K/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/0xLR/9TUk7/T05K/0ZFQf81NDH/U1JO/1NSTv9PTkr/T05K/1NSTv87Ojb/T05K/09OSv87Ojb/U1JO/1NSTv9PTkr/U1JO/1NSTv9PTkr/Ozo2/0xLR/9TUk7/T05K/0xLR/9GRUH/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/T05K/09OSv9PTkr/TEtH/zs6Nv81NDH/Ozo2/zs6Nv81NDH/NTQx/zU0Mf9TUk7/U1JO/zU0Mf81NDH/NTQx/zs6Nv87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9MS0f/TEtH/zs6Nv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_alarm_secret: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv9GRUH/U1JO/1NSTv9MS0f/NTQx/0xLR/9TUk7/TEtH/0ZFQf81NDH/U1JO/1NSTv9MS0f/U1JO/09OSv81NDH/T05K/1NSTv9PTkr/U1JO/zU0Mf9PTkr/U1JO/0xLR/9PTkr/NTQx/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/1NSTv9PTkr/U1JO/09OSv81NDH/TEtH/0xLR/9TUk7/TEtH/zU0Mf9GRUH/U1JO/1NSTv87Ojb/Ozo2/zU0Mf9TUk7/T05K/1NSTv9PTkr/Ozo2/zs6Nv81NDH/Ozo2/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/TEtH/1NSTv9TUk7/U1JO/zU0Mf9GRUH/U1JO/1NSTv9TUk7/RkVB/zs6Nv9PTkr/T05K/1NSTv9PTkr/Ozo2/1NSTv9TUk7/U1JO/1NSTv87Ojb/T05K/1NSTv9PTkr/U1JO/0xLR/81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv9GRUH/U1JO/09OSv9GRUH/Ozo2/09OSv9PTkr/U1JO/1NSTv9TUk7/Ozo2/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9PTkr/U1JO/09OSv9TUk7/T05K/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/0xLR/9TUk7/T05K/0ZFQf81NDH/U1JO/1NSTv9PTkr/T05K/1NSTv87Ojb/T05K/09OSv87Ojb/U1JO/1NSTv9PTkr/U1JO/1NSTv9PTkr/Ozo2/0xLR/9TUk7/T05K/0xLR/9GRUH/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/T05K/09OSv9PTkr/TEtH/zs6Nv81NDH/Ozo2/zs6Nv81NDH/NTQx/zU0Mf9TUk7/U1JO/zU0Mf81NDH/NTQx/zs6Nv87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9MS0f/TEtH/zs6Nv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_lightning_secret: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv9GRUH/U1JO/1NSTv9MS0f/NTQx/0xLR/9TUk7/TEtH/0ZFQf81NDH/U1JO/1NSTv9MS0f/U1JO/09OSv81NDH/T05K/1NSTv9PTkr/U1JO/zU0Mf9PTkr/U1JO/0xLR/9PTkr/NTQx/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/1NSTv9PTkr/U1JO/09OSv81NDH/TEtH/0xLR/9TUk7/TEtH/zU0Mf9GRUH/U1JO/1NSTv87Ojb/Ozo2/zU0Mf9TUk7/T05K/1NSTv9PTkr/Ozo2/zs6Nv81NDH/Ozo2/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/TEtH/1NSTv9TUk7/U1JO/zU0Mf9GRUH/U1JO/1NSTv9TUk7/RkVB/zs6Nv9PTkr/T05K/1NSTv9PTkr/Ozo2/1NSTv9TUk7/U1JO/1NSTv87Ojb/T05K/1NSTv9PTkr/U1JO/0xLR/81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv9GRUH/U1JO/09OSv9GRUH/Ozo2/09OSv9PTkr/U1JO/1NSTv9TUk7/Ozo2/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9PTkr/U1JO/09OSv9TUk7/T05K/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/0xLR/9TUk7/T05K/0ZFQf81NDH/U1JO/1NSTv9PTkr/T05K/1NSTv87Ojb/T05K/09OSv87Ojb/U1JO/1NSTv9PTkr/U1JO/1NSTv9PTkr/Ozo2/0xLR/9TUk7/T05K/0xLR/9GRUH/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/T05K/09OSv9PTkr/TEtH/zs6Nv81NDH/Ozo2/zs6Nv81NDH/NTQx/zU0Mf9TUk7/U1JO/zU0Mf81NDH/NTQx/zs6Nv87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9MS0f/TEtH/zs6Nv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_gripping_secret: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv9GRUH/U1JO/1NSTv9MS0f/NTQx/0xLR/9TUk7/TEtH/0ZFQf81NDH/U1JO/1NSTv9MS0f/U1JO/09OSv81NDH/T05K/1NSTv9PTkr/U1JO/zU0Mf9PTkr/U1JO/0xLR/9PTkr/NTQx/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/1NSTv9PTkr/U1JO/09OSv81NDH/TEtH/0xLR/9TUk7/TEtH/zU0Mf9GRUH/U1JO/1NSTv87Ojb/Ozo2/zU0Mf9TUk7/T05K/1NSTv9PTkr/Ozo2/zs6Nv81NDH/Ozo2/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/TEtH/1NSTv9TUk7/U1JO/zU0Mf9GRUH/U1JO/1NSTv9TUk7/RkVB/zs6Nv9PTkr/T05K/1NSTv9PTkr/Ozo2/1NSTv9TUk7/U1JO/1NSTv87Ojb/T05K/1NSTv9PTkr/U1JO/0xLR/81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv9GRUH/U1JO/09OSv9GRUH/Ozo2/09OSv9PTkr/U1JO/1NSTv9TUk7/Ozo2/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9PTkr/U1JO/09OSv9TUk7/T05K/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/0xLR/9TUk7/T05K/0ZFQf81NDH/U1JO/1NSTv9PTkr/T05K/1NSTv87Ojb/T05K/09OSv87Ojb/U1JO/1NSTv9PTkr/U1JO/1NSTv9PTkr/Ozo2/0xLR/9TUk7/T05K/0xLR/9GRUH/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/T05K/09OSv9PTkr/TEtH/zs6Nv81NDH/Ozo2/zs6Nv81NDH/NTQx/zU0Mf9TUk7/U1JO/zU0Mf81NDH/NTQx/zs6Nv87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9MS0f/TEtH/zs6Nv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  trap_summoning_secret: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/zs6Nv9GRUH/U1JO/1NSTv9MS0f/NTQx/0xLR/9TUk7/TEtH/0ZFQf81NDH/U1JO/1NSTv9MS0f/U1JO/09OSv81NDH/T05K/1NSTv9PTkr/U1JO/zU0Mf9PTkr/U1JO/0xLR/9PTkr/NTQx/1NSTv9PTkr/U1JO/0xLR/9MS0f/NTQx/1NSTv9PTkr/U1JO/09OSv81NDH/TEtH/0xLR/9TUk7/TEtH/zU0Mf9GRUH/U1JO/1NSTv87Ojb/Ozo2/zU0Mf9TUk7/T05K/1NSTv9PTkr/Ozo2/zs6Nv81NDH/Ozo2/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/TEtH/1NSTv9TUk7/U1JO/zU0Mf9GRUH/U1JO/1NSTv9TUk7/RkVB/zs6Nv9PTkr/T05K/1NSTv9PTkr/Ozo2/1NSTv9TUk7/U1JO/1NSTv87Ojb/T05K/1NSTv9PTkr/U1JO/0xLR/81NDH/U1JO/09OSv9TUk7/RkVB/zs6Nv9GRUH/U1JO/09OSv9GRUH/Ozo2/09OSv9PTkr/U1JO/1NSTv9TUk7/Ozo2/0ZFQf9PTkr/NTQx/zU0Mf87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9PTkr/U1JO/09OSv9TUk7/T05K/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/T05K/0xLR/9TUk7/T05K/0ZFQf81NDH/U1JO/1NSTv9PTkr/T05K/1NSTv87Ojb/T05K/09OSv87Ojb/U1JO/1NSTv9PTkr/U1JO/1NSTv9PTkr/Ozo2/0xLR/9TUk7/T05K/0xLR/9GRUH/NTQx/09OSv9PTkr/Ozo2/0xLR/9PTkr/T05K/09OSv9PTkr/TEtH/zs6Nv81NDH/Ozo2/zs6Nv81NDH/NTQx/zU0Mf9TUk7/U1JO/zU0Mf81NDH/NTQx/zs6Nv87Ojb/Ozo2/zs6Nv87Ojb/NTQx/zU0Mf9MS0f/TEtH/zs6Nv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/T05K/0ZFQf81NDH/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/1NSTv9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  high_grass: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/WZlK/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf87Ojb/Ozo2/1mZSv87Ojb/NTQx/zs6Nv9PTkr/WZlK/1mZSv9TUk7/T05K/zs6Nv9ZmUr/U1JO/1NSTv9MS0f/NTQx/0xLR/9Idjz/TEtH/0ZFQf9ZmUr/U1JO/1mZSv9MS0f/U1JO/09OSv81NDH/WZlK/1NSTv9PTkr/U1JO/1mZSv9PTkr/MjEv/y4tK/9PTkr/WZlK/1NSTv9Idjz/U1JO/y4tK/9Idjz/NTQx/1mZSv9ZmUr/U1JO/09OSv9ZmUr/TEtH/0xLR/9TUk7/WZlK/zU0Mf8qKSf/SHY8/zIxL/87Ojb/IyMg/zU0Mf9TUk7/WZlK/1NSTv9PTkr/WZlK/zs6Nv81NDH/Ozo2/1mZSv87Ojb/Ozo2/zs6Nv87Ojb/U1JO/0xLR/87Ojb/TEtH/1mZSv9TUk7/U1JO/1mZSv9GRUH/U1JO/1NSTv9Idjz/RkVB/zs6Nv9PTkr/T05K/1NSTv9PTkr/Ozo2/1NSTv9ZmUr/SHY8/1NSTv9Idjz/WZlK/1NSTv9PTkr/SHY8/0xLR/81NDH/SHY8/y8vLP9TUk7/RkVB/zs6Nv9GRUH/WZlK/0h2PP9GRUH/SHY8/0h2PP9PTkr/MjEv/0h2PP8yMS//IyMg/0ZFQf9PTkr/NTQx/zU0Mf9ZmUr/Ozo2/1mZSv9Idjz/IB8d/yAfHf9Idjz/U1JO/y8vLP8yMS//T05K/zU0Mf87Ojb/NTQx/zs6Nv9GRUH/WZlK/0xLR/9TUk7/SHY8/0ZFQf8gHx3/MjEv/1NSTv9PTkr/WZlK/1NSTv9ZmUr/T05K/09OSv87Ojb/U1JO/1mZSv9PTkr/U1JO/0h2PP9Idjz/Ozo2/0xLR/9TUk7/WZlK/1mZSv9GRUH/WZlK/09OSv9PTkr/Ozo2/0xLR/9ZmUr/T05K/09OSv9Idjz/SHY8/zs6Nv9Idjz/Ozo2/0h2PP81NDH/IB8d/0h2PP8yMS//U1JO/zU0Mf81NDH/SHY8/zs6Nv87Ojb/SHY8/0h2PP8jIyD/IB8d/zU0Mf9Idjz/TEtH/zs6Nv8gHx3/IyMg/zU0Mf8yMS//Kikn/yMjIP9Idjz/Ly8s/0h2PP9Idjz/Ly8s/yopJ/8gHx3/T05K/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv8jIyD/MjEv/y8vLP8uLSv/MjEv/zIxL/9PTkr/Ozo2/09OSv9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  sign: { w: 16, h: 16, rgba: "U1JO/1NSTv81NDH/RkVB/0xLR/9PTkr/T05K/1NSTv9MS0f/Ozo2/09OSv9PTkr/Ozo2/09OSv9TUk7/T05K/1NSTv9TUk7/Ozo2/zs6Nv81NDH/NTQx/zU0Mf8vLiv/Ly4r/y8uK/8vLiv/NTQx/zs6Nv9PTkr/T05K/0xLR/9TUk7/T05K/y8uK/84NzT/QkI+/0JCPv89PDn/Kion/5h1Rf98VTH/PTw5/zg3NP8qKif/QkI+/0JCPv9MS0f/U1JO/z8+O/8qKif/j29D/41uQ/+NbkP/kXFG/5BxRP+NbkP/kHFE/41uQ/+Pb0P/lXRJ/5NzSP8/Pjv/QkI+/0xLR/89PDn/jW5D/3RRMf9zUDD/eVU1/3dUMv95VTX/eFU0/3hVNP95VTX/dVMx/3pWNv9mSzD/Zksw/0JCPv87Ojb/Ly4r/5V0Sf93VDL/dVMx/2hOMv9oTjL/eVU1/2hNMf9mSzD/Zksw/2ZLMP93VDL/aE0x/2hNMf8vLiv/U1JO/z08Of+Sckf/ZUov/0o3JP9JNiL/RTMg/0k2I/9UOyT/UDgi/0k2Iv9JNiL/SDUi/2ZLMP9jSS7/Pz47/1NSTv8/Pjv/kXFG/2VKL/9mSzD/Zksw/2NJLv9mSzD/ak80/2dMMf9nTDH/Zksw/2VKL/9mSzD/aE4y/z8+O/9TUk7/ODc0/5FxRv9nTDH/ak80/0c0If9HNCL/RTMg/0c0If9HNCL/RzQi/3dUMv96Vjb/d1Qy/2NJLv8/Pjv/NTQx/yoqJ/+QcUT/Z0wx/2pPNP91UzH/dVMx/3VTMf93VDL/eFU0/3RRMf91UzH/dVMx/3NQMP9qTzT/Kion/zs6Nv84NzT/kXFG/3hVNP90UTH/d1Qy/3hVNP93VDL/eVU1/3VTMf95VTX/dFEx/3lVNf95VTX/Z0wx/z8+O/87Ojb/QkI+/0JCPv9oTTH/Zksw/2ZLMP9lSi//Y0ku/2NJLv9qTzT/ZUov/2ZLMP9oTjL/aE0x/z8+O/8/Pjv/Ozo2/0xLR/8/Pjv/Pz47/z8+O/8/Pjv/PTw5/y8uK/9wUzD/VT4l/y8uK/8qKif/Kion/yoqJ/9CQj7/U1JO/zU0Mf81NDH/NTQx/zs6Nv87Ojb/Ozo2/zs6Nv8vLiv/l3RE/2RHKf89PDn/TEtH/zs6Nv81NDH/Ozo2/zU0Mf9TUk7/RkVB/zs6Nv9GRUH/T05K/1NSTv9TUk7/Pz47/5t3R/9qTS7/Pz47/1NSTv81NDH/TEtH/1NSTv9PTkr/U1JO/09OSv87Ojb/U1JO/09OSv9MS0f/U1JO/0JCPv8/Pjv/Ly4r/z8+O/9TUk7/NTQx/1NSTv9TUk7/U1JO/w==" },
  tile_caves_chasm: { w: 16, h: 16, rgba: "AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/w==" },
  tile_caves_floor: { w: 16, h: 16, rgba: "LCkn/ywpJ/8sKSf/LCkn/zAsKv8sKSf/LCkn/ykkI/8sKSf/LCkn/zAsKv8sKSf/LCkn/ykkI/8pJCP/MCwq/zAsKv8sKSf/LCkn/ywpJ/8sKSf/MCwq/ywpJ/8pJCP/LCkn/ywpJ/8sKSf/KSQj/ywpJ/8sKSf/KSQj/ywpJ/8sKSf/LCkn/ywpJ/8sKSf/LCkn/ywpJ/8pJCP/LCkn/ywpJ/8sKSf/KSQj/ywpJ/8sKSf/LCkn/ywpJ/8wLCr/LCkn/ywpJ/8sKSf/LCkn/ywpJ/8sKSf/KSQj/ykkI/8pJCP/LCkn/ywpJ/8wLCr/MCwq/zAsKv8wLCr/MCwq/ywpJ/8sKSf/LCkn/ywpJ/8sKSf/LCkn/ywpJ/8wLCr/KSQj/ykkI/8wLCr/LCkn/ywpJ/8wLCr/LCkn/zAsKv8sKSf/MCwq/ywpJ/8wLCr/MCwq/zAsKv8wLCr/MCwq/ywpJ/8sKSf/MCwq/ykkI/8pJCP/LCkn/ywpJ/8sKSf/MCwq/zAsKv8sKSf/LCkn/ykkI/8pJCP/LCkn/ykkI/8sKSf/MCwq/zAsKv8sKSf/KSQj/ykkI/8pJCP/LCkn/ywpJ/8wLCr/LCkn/ywpJ/8pJCP/KSQj/ykkI/8pJCP/MCwq/zAsKv8sKSf/LCkn/ykkI/8pJCP/KSQj/zAsKv8sKSf/MCwq/zAsKv8sKSf/LCkn/ywpJ/8wLCr/LCkn/ywpJ/8sKSf/LCkn/ywpJ/8pJCP/LCkn/ywpJ/8sKSf/LCkn/ywpJ/8pJCP/MCwq/zAsKv8wLCr/MCwq/ykkI/8sKSf/LCkn/ykkI/8pJCP/LCkn/zAsKv8wLCr/LCkn/ywpJ/8sKSf/LCkn/ykkI/8sKSf/KSQj/ywpJ/8pJCP/KSQj/ywpJ/8sKSf/KSQj/ywpJ/8sKSf/LCkn/ywpJ/8sKSf/LCkn/zAsKv8sKSf/KSQj/ykkI/8sKSf/KSQj/ywpJ/8sKSf/LCkn/ykkI/8pJCP/LCkn/ywpJ/8sKSf/LCkn/ykkI/8sKSf/MCwq/zAsKv8pJCP/LCkn/ywpJ/8sKSf/KSQj/ywpJ/8pJCP/KSQj/zAsKv8sKSf/LCkn/zAsKv8sKSf/MCwq/ywpJ/8sKSf/KSQj/ykkI/8pJCP/LCkn/ywpJ/8pJCP/KSQj/ykkI/8sKSf/KSQj/ywpJ/8sKSf/LCkn/zAsKv8sKSf/KSQj/ykkI/8pJCP/KSQj/ywpJ/8wLCr/LCkn/ywpJ/8pJCP/LCkn/ykkI/8sKSf/LCkn/ywpJ/8wLCr/KSQj/ykkI/8pJCP/KSQj/ykkI/8sKSf/LCkn/ywpJ/8sKSf/LCkn/ykkI/8pJCP/LCkn/w==" },
  tile_caves_grass: { w: 16, h: 16, rgba: "LCkn/ywpJ/8sKSf/LCkn/zAsKv8sKSf/LCkn/ykkI/8sKSf/LCkn/zAsKv8sKSf/LCkn/ykkI/8pJCP/MCwq/zAsKv8sKSf/LCkn/ywpJ/8sKSf/MCwq/ywpJ/8pJCP/LCkn/ywpJ/8sKSf/KSQj/ywpJ/9PTif/KSQj/ywpJ/8sKSf/LCkn/ywpJ/8sKSf/LCkn/ywpJ/8pJCP/LCkn/ywpJ/8sKSf/KSQj/ywpJ/8sKSf/LCkn/ywpJ/8wLCr/LCkn/ywpJ/8sKSf/LCkn/ywpJ/8sKSf/T04n/32MQ/8pJCP/LCkn/ywpJ/8wLCr/MCwq/zAsKv8wLCr/MCwq/ywpJ/8sKSf/LCkn/32MQ/8hHx7/LCkn/ywpJ/9PTif/fYxD/09OJ/8wLCr/LCkn/ywpJ/8wLCr/LCkn/zAsKv8sKSf/MCwq/ywpJ/8wLCr/MCwq/zAsKv8lISD/T04n/09OJ/8hHx7/MCwq/ykkI/99jEP/LCkn/ywpJ/8sKSf/MCwq/zAsKv8sKSf/LCkn/ykkI/8pJCP/LCkn/ykkI/8sKSf/MCwq/zAsKv8sKSf/KSQj/32MQ/9PTif/LCkn/ywpJ/8wLCr/LCkn/ywpJ/8pJCP/KSQj/ykkI/8pJCP/MCwq/zAsKv8sKSf/LCkn/x8bG/9PTif/Hxsb/zAsKv8sKSf/MCwq/zAsKv8sKSf/LCkn/ywpJ/8wLCr/LCkn/ywpJ/8sKSf/LCkn/ywpJ/8pJCP/LCkn/ywpJ/8sKSf/LCkn/ywpJ/8pJCP/MCwq/zAsKv8wLCr/MCwq/ykkI/8sKSf/LCkn/ykkI/8pJCP/LCkn/zAsKv8wLCr/LCkn/ywpJ/99jEP/fYxD/ykkI/9PTif/KSQj/ywpJ/8pJCP/T04n/ywpJ/8sKSf/KSQj/ywpJ/8sKSf/LCkn/ywpJ/8sKSf/IR8e/09OJ/9PTif/Hxsb/ykkI/8sKSf/KSQj/ywpJ/8sKSf/LCkn/ykkI/8pJCP/LCkn/ywpJ/8sKSf/LCkn/ykkI/8sKSf/MCwq/zAsKv8pJCP/LCkn/ywpJ/8sKSf/KSQj/ywpJ/8pJCP/KSQj/zAsKv8sKSf/LCkn/zAsKv8sKSf/MCwq/ywpJ/8sKSf/KSQj/ykkI/8pJCP/LCkn/ywpJ/8pJCP/fYxD/ykkI/8sKSf/KSQj/ywpJ/8sKSf/LCkn/zAsKv8sKSf/KSQj/ykkI/8pJCP/KSQj/ywpJ/99jEP/LCkn/09OJ/8pJCP/LCkn/ykkI/8sKSf/LCkn/ywpJ/8wLCr/KSQj/ykkI/8pJCP/KSQj/ykkI/8sKSf/IR8e/09OJ/8hHx7/IR8e/ykkI/8pJCP/LCkn/w==" },
  tile_caves_wall: { w: 16, h: 16, rgba: "t7Cl/5WNif9qZmL/amZi/4aBfv+GgX7/lY2J/5WNif+GgX7/hoF+/4aBfv+GgX7/amZi/4aBfv+GgX7/hoF+/7ewpf9qZmL/lY2J/4aBfv+VjYn/hoF+/5WNif9qZmL/hoF+/5WNif+GgX7/amZi/4aBfv+GgX7/hoF+/5WNif+VjYn/lY2J/5WNif+VjYn/hoF+/4aBfv9qZmL/amZi/5WNif+GgX7/amZi/4aBfv+GgX7/lY2J/7ewpf+3sKX/lY2J/5WNif+GgX7/hoF+/5WNif9qZmL/amZi/4aBfv+VjYn/amZi/4aBfv+3sKX/hoF+/7ewpf+3sKX/lY2J/5WNif+GgX7/hoF+/5WNif+VjYn/hoF+/5WNif+3sKX/amZi/2pmYv+3sKX/lY2J/5WNif+3sKX/hoF+/5WNif+GgX7/lY2J/7ewpf+3sKX/hoF+/5WNif+VjYn/hoF+/2pmYv+3sKX/t7Cl/5WNif+VjYn/lY2J/4aBfv+GgX7/t7Cl/7ewpf+3sKX/lY2J/4aBfv+VjYn/amZi/2pmYv+VjYn/t7Cl/5WNif+VjYn/hoF+/2pmYv+GgX7/hoF+/7ewpf+VjYn/t7Cl/5WNif+VjYn/hoF+/2pmYv+VjYn/t7Cl/5WNif+GgX7/hoF+/2pmYv9qZmL/hoF+/5WNif+VjYn/hoF+/4aBfv9qZmL/hoF+/4aBfv+VjYn/t7Cl/4aBfv+VjYn/hoF+/2pmYv9qZmL/hoF+/5WNif+3sKX/hoF+/4aBfv9qZmL/amZi/4aBfv+GgX7/lY2J/4aBfv+GgX7/hoF+/2pmYv9qZmL/amZi/5WNif+VjYn/lY2J/4aBfv+GgX7/lY2J/5WNif+VjYn/hoF+/2pmYv+GgX7/hoF+/4aBfv9qZmL/hoF+/2pmYv+VjYn/lY2J/4aBfv+GgX7/hoF+/5WNif+VjYn/lY2J/2pmYv9qZmL/hoF+/4aBfv9qZmL/amZi/4aBfv+GgX7/hoF+/4aBfv+GgX7/hoF+/4aBfv+GgX7/hoF+/4aBfv9qZmL/amZi/4aBfv9qZmL/amZi/2pmYv9qZmL/hoF+/2pmYv+GgX7/hoF+/5WNif+GgX7/hoF+/5WNif9qZmL/amZi/2pmYv9qZmL/amZi/4aBfv9qZmL/amZi/2pmYv+GgX7/hoF+/4aBfv+VjYn/lY2J/7ewpf+GgX7/amZi/2pmYv9qZmL/amZi/4aBfv+GgX7/amZi/4aBfv+GgX7/hoF+/4aBfv+GgX7/lY2J/7ewpf+GgX7/amZi/2pmYv9qZmL/amZi/4aBfv+GgX7/hoF+/4aBfv+GgX7/hoF+/4aBfv+GgX7/hoF+/w==" },
  tile_caves_door: { w: 16, h: 16, rgba: "t7Cl/5WNif9qZmL/amZi/4aBfv+GgX7/lY2J/5WNif+GgX7/hoF+/4aBfv+GgX7/amZi/4aBfv+GgX7/hoF+/7ewpf9FOjP/RToz/z8zLv8/My7/PzMu/z8zLv8/My7/RToz/0U6M/9FOjP/RToz/0U6M/9FOjP/PzMu/5WNif+VjYn/PzMu/0tAOv9LQDr/S0A6/0U6M/9FOjP/RToz/0tAOv9LQDr/S0A6/0tAOv9FOjP/S0A6/z8zLv+3sKX/lY2J/0U6M/9FOjP/a002/2FHMv9SPCr/a002/11DLv9hRzL/VT4t/2tNNv9hRzL/Ujwq/0U6M/8/My7/lY2J/5WNif9FOjP/RToz/2tNNv9hRzL/Ujwq/2tNNv9dQy7/XUMu/1I8Kv9rTTb/YUcy/1I8Kv9FOjP/PzMu/5WNif+GgX7/PzMu/0tAOv9rTTb/YUcy/1U+Lf9rTTb/YUcy/2FHMv9SPCr/a002/zc4O/83ODv/RToz/z8zLv+GgX7/t7Cl/0U6M/9LQDr/a002/11DLv9SPCr/a002/11DLv9dQy7/Ujwq/2tNNv8sLS//LC0v/0tAOv8/My7/hoF+/7ewpf9FOjP/S0A6/2tNNv9dQy7/VT4t/2tNNv9hRzL/XUMu/1U+Lf9rTTb/YUcy/1I8Kv9FOjP/PzMu/5WNif+VjYn/RToz/0U6M/83ODv/Nzg7/1U+Lf9rTTb/YUcy/11DLv9SPCr/a002/2FHMv9SPCr/RToz/z8zLv+3sKX/hoF+/0U6M/9FOjP/LC0v/ywtL/9SPCr/a002/2FHMv9dQy7/VT4t/2tNNv9hRzL/Ujwq/0tAOv8/My7/lY2J/4aBfv8/My7/RToz/2tNNv9dQy7/VT4t/2tNNv9dQy7/XUMu/1U+Lf9rTTb/YUcy/1U+Lf9FOjP/PzMu/4aBfv+GgX7/RToz/0U6M/9rTTb/YUcy/1I8Kv9rTTb/XUMu/11DLv9SPCr/a002/2FHMv9SPCr/S0A6/z8zLv+GgX7/hoF+/0tAOv9LQDr/a002/11DLv9SPCr/a002/11DLv9hRzL/Ujwq/2tNNv83ODv/Nzg7/0U6M/8/My7/hoF+/5WNif9FOjP/S0A6/2tNNv9dQy7/Ujwq/2tNNv9hRzL/YUcy/1I8Kv9rTTb/LC0v/ywtL/9FOjP/PzMu/4aBfv+VjYn/PzMu/0U6M/9rTTb/XUMu/1U+Lf9rTTb/YUcy/11DLv9SPCr/a002/11DLv9VPi3/S0A6/z8zLv+GgX7/lY2J/zgvKf84Lyn/a002/11DLv9SPCr/a002/2FHMv9hRzL/Ujwq/2tNNv9dQy7/VT4t/zgvKf8zKST/hoF+/w==" },
  tile_caves_entrance: { w: 16, h: 16, rgba: "LCkn/ywpJ/8sKSf/fWpZ/3ZkVP8oJSP/LCkn/ykkI/8sKSf/LCkn/zAsKv98aVj/cV9P/yUgH/8pJCP/MCwq/zAsKv8sKSf/LCkn/3toV/9xX0//sp+S/7CdkP+vnY//jnNg/4twXf+McV7/fGlY/3JgUP8oJSP/KSQj/ywpJ/8sKSf/LCkn/ywpJ/9+a1r/c2FR/1xOQf9dT0L/W01A/1tNQP9eUEP/Wkw//3toV/9xX0//KCUj/ywpJ/8wLCr/LCkn/ywpJ/8sKSf/f2xb/3ZkVP8oJSP/KSQj/ykkI/8pJCP/LCkn/ywpJ/9/bFv/cF5O/ysoJv8wLCr/MCwq/ywpJ/8sKSf/LCkn/3toV/9wXk7/KCUj/ywpJ/8wLCr/KSQj/ykkI/8wLCr/fmta/3RiUv8rKCb/LCkn/zAsKv8sKSf/MCwq/ywpJ/96Z1b/dGJS/7Gekf+LcF3/jnNg/490Yf+Oc2D/jHFe/35rWv9yYFD/KCUj/ywpJ/8sKSf/MCwq/zAsKv8sKSf/emdW/3JgUP9dT0L/XlBD/1tNQP9ZSz7/W01A/1tNQP+AbVz/dGJS/yUgH/8pJCP/LCkn/ywpJ/8wLCr/LCkn/39sW/9zYVH/JSAf/ykkI/8pJCP/MCwq/zAsKv8sKSf/e2hX/3RiUv8lIB//KSQj/zAsKv8sKSf/MCwq/zAsKv99aln/dWNT/yglI/8wLCr/LCkn/ywpJ/8sKSf/LCkn/35rWv92ZFT/KCUj/ywpJ/8sKSf/LCkn/ywpJ/8pJCP/e2hX/3NhUf+um47/sZ6R/4twXf+QdWL/kXZj/490Yf98aVj/dGJS/ysoJv8wLCr/LCkn/ywpJ/8sKSf/LCkn/35rWv92ZFT/XU9C/15QQ/9eUEP/WUs+/1lLPv9eUEP/f2xb/3ZkVP8oJSP/LCkn/ywpJ/8sKSf/LCkn/zAsKv98aVj/dGJS/yUgH/8sKSf/KSQj/ywpJ/8sKSf/LCkn/39sW/9wXk7/KCUj/ywpJ/8sKSf/LCkn/ykkI/8sKSf/f2xb/3BeTv8lIB//LCkn/ywpJ/8sKSf/KSQj/ywpJ/9/bFv/cV9P/ysoJv8sKSf/LCkn/zAsKv8sKSf/MCwq/39sW/9xX0//kXZj/4twXf+RdmP/jHFe/4xxXv+PdGH/gG1c/3JgUP8oJSP/KSQj/ywpJ/8sKSf/LCkn/zAsKv96Z1b/cV9P/1pMP/9dT0L/WEo9/1xOQf9cTkH/XE5B/31qWf91Y1P/KCUj/yUgH/8jIR//LCkn/ywpJ/8wLCr/fmta/3FfT/8ZFhX/IR0c/yUgH/8sKSf/LCkn/ywpJ/9/bFv/dWNT/xkWFf8hHRz/KCUj/w==" },
  tile_caves_exit: { w: 16, h: 16, rgba: "LCkn/ywpJ/8sKSf/LCkn/zAsKv8sKSf/LCkn/ykkI/8sKSf/LCkn/zAsKv8sKSf/LCkn/ykkI/8pJCP/MCwq/zAsKv8sKSf/LCkn/4VtW/+FbVv/JiMi/ywpJ/8pJCP/LCkn/ywpJ/8sKSf/hW1b/4VtW/8jIR//KSQj/ywpJ/8sKSf/LCkn/ywpJ/+FbVv/W05A/yMhH/8pJCP/LCkn/ywpJ/8sKSf/KSQj/4VtW/9bTkD/IyEf/ywpJ/8wLCr/LCkn/ywpJ/8sKSf/aVlK/1tOQP+qmY3/qpmN/4VtW/+FbVv/hW1b/4VtW/9pWUr/W05A/zAsKv8wLCr/MCwq/ywpJ/8sKSf/IR8e/2lZSv9bTkD/VUc7/1VHO/9VRzv/VUc7/1VHO/9FOzH/aVlK/1tOQP8lISD/LCkn/zAsKv8sKSf/JSEg/yAeHP9pWUr/Sz80/yEeHP8hHhz/IR4c/x4cGv8eHBr/IR4c/2lZSv9LPzT/IB4c/yEfHv8sKSf/MCwq/yMgHv8eHBr/VUc7/0s/NP8aFxb/HBoZ/xoXFv8cGhn/Hxwb/x8cG/9VRzv/Sz80/xwYGP8eGhn/LCkn/ywpJ/8hHhz/HBoZ/1VHO/8/Niz/iH92/1VHO/9VRzv/VUc7/1VHO/9VRzv/VUc7/z82LP8aFxb/HBgY/zAsKv8sKSf/Hxwb/x0aGf9FOzH/PzYs/zMrJP8zKyT/Mysk/zMrJP8zKyT/Mysk/0U7Mf8/Niz/GhkX/xwaGf8sKSf/LCkn/xoZF/8ZFhX/RTsx/zApIv8dGhn/HRoZ/xkWFf8aGRf/GhkX/xkWFf8zKyT/MCki/x0aGf8dGhn/LCkn/ywpJ/8aGRf/GhkX/zMrJP8wKSL/GRYV/xoZF/8ZFhX/GRYV/xoZF/8aGRf/Mysk/zApIv8aGRf/GhkX/ywpJ/8sKSf/GhkX/x0aGf8lIBr/JSAa/zMrJP8zKyT/Mysk/zMrJP8zKyT/Mysk/yUgGv8lIBr/GhkX/xoZF/8sKSf/LCkn/ykkI/8aGRf/JSAa/yUgGv8ZFhX/GhkX/xoZF/8aGRf/GRYV/xoZF/8lIBr/JSAa/x0aGf8sKSf/LCkn/zAsKv8sKSf/MCwq/ywpJ/8lIBr/GRYV/xkWFf8ZFhX/GhkX/xoZF/8ZFhX/JSAa/ykkI/8sKSf/KSQj/ywpJ/8sKSf/LCkn/zAsKv8sKSf/KSQj/ykkI/8pJCP/KSQj/ywpJ/8wLCr/LCkn/ywpJ/8pJCP/LCkn/ykkI/8sKSf/LCkn/ywpJ/8wLCr/KSQj/ykkI/8pJCP/KSQj/ykkI/8sKSf/LCkn/ywpJ/8sKSf/LCkn/ykkI/8pJCP/LCkn/w==" },
  tile_caves_trap: { w: 16, h: 16, rgba: "LCkn/ywpJ/8sKSf/LCkn/zAsKv8sKSf/LCkn/ykkI/8sKSf/LCkn/zAsKv8sKSf/LCkn/ykkI/8pJCP/MCwq/zAsKv8sKSf/LCkn/ywpJ/8sKSf/HBoY/xoYFv8pJCP/LCkn/ywpJ/8aGBb/GBQU/ywpJ/8sKSf/KSQj/ywpJ/8sKSf/LCkn/ywpJ/8sKSf/GhgW/z3JUv9I1F3/S0hF/ywpJ/8aGBb/O8dQ/0PPWP9LSEX/LCkn/ywpJ/8wLCr/LCkn/ywpJ/8sKSf/GhgW/0XRWv9G0lv/SEFA/ykkI/8YFBT/QMxV/zbCS/9QS0n/MCwq/xwaGP8wLCr/MCwq/ywpJ/8sKSf/GhgW/zbCS/9F0Vr/S0hF/ywpJ/8cGhj/OcVO/0PPWP9QS0n/LCkn/xoYFv9I1F3/S0hF/zAsKv8sKSf/HBoY/zjETf9Czlf/UEtJ/zAsKv8cGhj/O8dQ/zzIUf9LSEX/MCwq/xgUFP83w0z/PspT/0tIRf8sKSf/MCwq/xwaGP9Czlf/S0hF/ykkI/8YFBT/OsZP/zrGT/9LSEX/MCwq/xwaGP9Dz1j/PclS/0hBQP8pJCP/LCkn/ywpJ/8wLCr/S0hF/ywpJ/8YFBT/R9Nc/0LOV/9IQUD/MCwq/xwaGP9F0Vr/R9Nc/0hBQP8pJCP/KSQj/zAsKv8sKSf/MCwq/zAsKv8aGBb/OsZP/zjETf9QS0n/LCkn/xoYFv8+ylP/Qc1W/0tIRf8pJCP/GhgW/ywpJ/8sKSf/LCkn/ywpJ/8YFBT/QMxV/zfDTP9QS0n/MCwq/xgUFP9K1l//PMhR/0hBQP8pJCP/GhgW/zjETf9QS0n/LCkn/ywpJ/8aGBb/NsJL/zjETf9LSEX/KSQj/xoYFv9G0lv/PspT/0tIRf8sKSf/GBQU/zrGT/9J1V7/S0hF/ywpJ/8sKSf/GhgW/zzIUf9LSEX/KSQj/xgUFP9BzVb/RtJb/0tIRf8sKSf/GhgW/z/LVP9Czlf/S0hF/ywpJ/8sKSf/LCkn/ykkI/9LSEX/MCwq/xwaGP83w0z/O8dQ/0tIRf8sKSf/GBQU/0HNVv9I1F3/SEFA/zAsKv8sKSf/LCkn/zAsKv8sKSf/MCwq/xoYFv88yFH/RtJb/0hBQP8pJCP/GhgW/z7KU/9E0Fn/SEFA/ykkI/8sKSf/KSQj/ywpJ/8sKSf/LCkn/zAsKv8sKSf/SEFA/0hBQP8pJCP/KSQj/ywpJ/9QS0n/S0hF/ywpJ/8pJCP/LCkn/ykkI/8sKSf/LCkn/ywpJ/8wLCr/KSQj/ykkI/8pJCP/KSQj/ykkI/8sKSf/LCkn/ywpJ/8sKSf/LCkn/ykkI/8pJCP/LCkn/w==" },
  tile_caves_statue: { w: 16, h: 16, rgba: "LCkn/ywpJ/8sKSf/LCkn/zAsKv9ybWb/zMnC/ykkI//MycL/zMnC/6CbkP+gm5D/LCkn/ykkI/8pJCP/MCwq/zAsKv8sKSf/LCkn/ywpJ/8sKSf/oJuQ/1NXR/+gm5D/oJuQ/6CbkP+gm5D/oJuQ/6CbkP8sKSf/KSQj/ywpJ/8sKSf/LCkn/ywpJ/8sKSf/LCkn/ywpJ/+gm5D/fHtt/3x7bf9TV0f/oJuQ/1NXR/+gm5D/LCkn/ywpJ/8wLCr/LCkn/ywpJ/8sKSf/LCkn/ywpJ/8sKSf/oJuQ/3x7bf98e23/fHtt/3x7bf+gm5D/oJuQ/6CbkP8wLCr/MCwq/ywpJ/8sKSf/LCkn/ywpJ/8sKSf/zMnC/6CbkP98e23/fHtt/3x7bf98e23/fHtt/3x7bf+gm5D/LCkn/zAsKv8sKSf/MCwq/ywpJ/8wLCr/MCwq/8zJwv+gm5D/oJuQ/3x7bf9TV0f/U1dH/1NXR/9TV0f/U1dH/ywpJ/8sKSf/MCwq/zAsKv8sKSf/LCkn/6CbkP+gm5D/fHtt/3x7bf98e23/fHtt/1NXR/9TV0f/KSQj/ykkI/8pJCP/LCkn/ywpJ/8wLCr/LCkn/ywpJ/+gm5D/fHtt/3x7bf98e23/fHtt/1NXR/98e23/U1dH/ykkI/8pJCP/KSQj/zAsKv8sKSf/MCwq/zAsKv8sKSf/fHtt/3x7bf98e23/oJuQ/8zJwv/MycL/fHtt/6CbkP+gm5D/LCkn/ywpJ/8sKSf/LCkn/ywpJ/8pJCP/MCwq/1NXR/9TV0f/fHtt/3x7bf98e23/oJuQ/3x7bf98e23/oJuQ/zAsKv8wLCr/LCkn/ywpJ/+QiX//kIl//5CJf/9TV0f/U1dH/1NXR/98e23/fHtt/3x7bf98e23/U1dH/3x7bf+QiX//kIl//ywpJ/8sKSf/kIl//3x7bf9TV0f/U1dH/1NXR/9TV0f/U1dH/1NXR/+gm5D/U1dH/1NXR/+gm5D/fXVu/5CJf/8sKSf/IyEf/5CJf/+QiX//fXVu/311bv99dW7/fXVu/311bv99dW7/fXVu/311bv99dW7/fXVu/5CJf/+QiX//IyEf/yYjIv93cmn/d3Jp/3dyaf93cmn/d3Jp/3dyaf93cmn/d3Jp/3dyaf93cmn/d3Jp/3dyaf93cmn/d3Jp/yMhH/8jIR//U1dH/1NXR/9TV0f/U1dH/1NXR/9TV0f/U1dH/1NXR/9TV0f/U1dH/1NXR/9TV0f/U1dH/1NXR/8jIR//LCkn/yMhH/8mIyL/IR0c/yEdHP8hHRz/IR0c/yEdHP8jIR//IyEf/yMhH/8jIR//IyEf/yEdHP8hHRz/LCkn/w==" },
  tile_caves_water: { w: 16, h: 16, rgba: "GjQy/xo0Mv8XMDD/FzAw/xcwMP8XMDD/FzAw/xcwMP8XMDD/GjQy/yE7N/8aNDL/FzAw/xcwMP8XMDD/FzAw/xcwMP8XMDD/FzAw/xcwMP8XMDD/FzAw/xcwMP8XMDD/FzAw/zhVUf8sSET/ITs3/yE7N/8hOzf/GjQy/xcwMP8XMDD/FzAw/xcwMP8XMDD/GjQy/xo0Mv8aNDL/GjQy/yE7N/8aNDL/FzAw/xo0Mv8hOzf/ITs3/yE7N/8hOzf/FzAw/xcwMP8XMDD/FzAw/xcwMP8aNDL/ITs3/yE7N/8aNDL/FzAw/xcwMP8XMDD/FzAw/xcwMP8hOzf/ITs3/xo0Mv8XMDD/FzAw/xcwMP8XMDD/ITs3/yE7N/8aNDL/FzAw/xcwMP8XMDD/FzAw/xcwMP8XMDD/GjQy/yE7N/8hOzf/ITs3/xo0Mv8XMDD/FzAw/yE7N/8hOzf/FzAw/xcwMP8XMDD/FzAw/xcwMP8XMDD/FzAw/xcwMP8aNDL/GjQy/yE7N/8hOzf/GjQy/xo0Mv8aNDL/GjQy/xcwMP8XMDD/FzAw/xcwMP8XMDD/FzAw/xcwMP8aNDL/GjQy/xo0Mv8XMDD/GjQy/xo0Mv8XMDD/FzAw/xcwMP8XMDD/FzAw/xcwMP8XMDD/GjQy/xo0Mv8aNDL/ITs3/yE7N/8aNDL/GjQy/xo0Mv8XMDD/FzAw/xo0Mv8XMDD/FzAw/xcwMP8XMDD/FzAw/xcwMP8aNDL/GjQy/yE7N/8hOzf/GjQy/xo0Mv8XMDD/FzAw/xo0Mv8hOzf/ITs3/xo0Mv8XMDD/FzAw/xcwMP8XMDD/FzAw/yE7N/8hOzf/GjQy/xo0Mv8XMDD/FzAw/xcwMP8aNDL/OFVR/yxIRP8hOzf/ITs3/yE7N/8aNDL/FzAw/xcwMP8hOzf/ITs3/xcwMP8aNDL/GjQy/xo0Mv8aNDL/LEhE/yE7N/8aNDL/ITs3/yE7N/8hOzf/ITs3/xo0Mv8hOzf/ITs3/xcwMP8XMDD/GjQy/xo0Mv8hOzf/ITs3/yE7N/8XMDD/FzAw/xcwMP8XMDD/GjQy/yE7N/8hOzf/ITs3/xo0Mv8XMDD/FzAw/xcwMP8hOzf/ITs3/yE7N/8XMDD/FzAw/xcwMP8XMDD/FzAw/xcwMP8aNDL/ITs3/yE7N/8aNDL/FzAw/xcwMP8XMDD/ITs3/yE7N/8XMDD/FzAw/xcwMP8XMDD/FzAw/xcwMP8XMDD/GjQy/xo0Mv8hOzf/GjQy/xcwMP8XMDD/GjQy/xo0Mv8hOzf/FzAw/xcwMP8XMDD/FzAw/xcwMP8XMDD/FzAw/xo0Mv8aNDL/GjQy/xo0Mv8aNDL/FzAw/w==" },
  mob_spinner: { w: 16, h: 16, rgba: "////AP///wD///8A////AICAgACAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAP///wD///8A////AP///wCAgIAAjduc/4CAgACAgIAAgICAAI3bnP9+tI3/gICAAICAgACAgIAAgICAAICAgAD///8A////AP///wD///8AgICAAI3bnP9+tI3/gICAAI3bnP9+tI3/gICAAICAgACN25z/frSN/4CAgACAgIAA////AP///wCN25z/jducAICAgACN25z/frSN/4CAgACN25z/frSN/4CAgACN25z/frSN/4CAgACAgIAAgICAAP///wD///8Ajduc/43bnP////8Ajduc/1GPUv9Rj1L/UY9S/1GPUv+N25z/jduc/360jf+AgIAAgICAAICAgAD///8A////AH60jf+N25z/jduc/1GPUv9qpmv/aqZr/1mLYf9Zi2H/UY9S/360jf+AgIAAgICAAICAgACAgIAA////AP///wB+tI0AfrSN/1GPUv9qpmv/WYth/1mLYf9qpmv/WYth/wAAAP9Cckn/4fjX/4CAgACAgIAAgICAAP///wD///8AfrSNAH60jQBCckn/WYth/0dvVP9Zi2H/WYth/1mLYf9Zi2H/QnJJ/wAAAACAgIAAgICAAICAgAD///8A////AP///wB+tI0AM1Y+/1mLYf9Zi2H/WYth/1mLYf9Hb1T/WYth/zNWPv8AAAAAgICAAICAgACAgIAA////AP///wD///8Ajduc/zNWPv9Hb1T/WYth/0dvVP9Zi2H/WYth/wAAAP8zVj7/4fjX/4CAgACAgIAAgICAAP///wD///8Ajduc/43bnP9+tI3/M1Y+/0dvVP9Hb1T/R29U/0dvVP8zVj7/jduc/wAAAACAgIAAgICAAICAgAD///8A////AI3bnP9+tI3/AAAAAI3bnP8zVj7/M1Y+/zNWPv8zVj7/frSN/43bnP+N25z/gICAAICAgACAgIAA////AP///wB+tI3/frSNAICAgACN25z/frSN/4CAgAB+tI3/jduc/4CAgAB+tI3/jduc/4CAgACAgIAAgICAAP///wD///8AfrSNAH60jQCAgIAAjduc/360jf+AgIAAfrSN/43bnP+AgIAAgICAAH60jf9+tI3/gICAAICAgAD///8A////AH60jQB+tI0AgICAAH60jf+AgIAAgICAAICAgAB+tI3/jduc/4CAgACAgIAAgICAAICAgACAgIAA////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  mob_elemental: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wD/VQCZ/1UAAP///wD///8A/1UAmf9VAAD///8A////AP///wAAAAAAAAAAAAAAAAAAAAAA////AP///wD///8A/1UAmf9VAJn/uzP//1UAmf9VAJn/VQCZ/1UAAP///wD///8AAAAAAAAAAAAAAAAAAAAAAP///wD///8A/1UAmf9VAJn//2b//7sz//+7M///uzP//1UAmf9VAJn/VQAA////AAAAAAAAAAAAAAAAAAAAAAD///8A/1UAmf9VAJn/uzP///9m////Zv///2b///9m//+7M///VQCZ/1UAmf///wAAAAAAAAAAAAAAAAAAAAAA////AP9VAJn/uzP///9m////Zv///2b///9m////Zv///2b//7sz//9VAJn///8AAAAAAAAAAAAAAAAAAAAAAP///wD/VQCZ/7sz////Zv+eCw//ngsP////Zv///2b/ngsP/54LD///VQCZ////AAAAAAAAAAAAAAAAAAAAAAD///8A/1UAmf+7M////2b///9m////Zv///2b///9m////Zv//uzP//1UAmf///wAAAAAAAAAAAAAAAAAAAAAA////AP9VAJn/uzP///9m////Zv/YnUP/ngsP/54LD//YnUP//7sz//9VAJn///8AAAAAAAAAAAAAAAAAAAAAAP///wD/VQCZ/1UAmf+7M////2b///9m////Zv///2b//7sz//9VAJn/VQCZ////AAAAAAAAAAAAAAAAAAAAAAD///8A/1UAAP9VAJn/VQCZ/7sz//+7M///uzP//7sz//9VAJn/VQCZ/1UAAP///wAAAAAAAAAAAAAAAAAAAAAA////AP9VAAD/VQAA/1UAmf9VAJn/VQCZ/1UAmf9VAJn/VQCZ/1UAAP9VAAD///8AAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAAAAAAAAAAAAAAAAAAAA////AP///wD///8A////M////zP///8z////M////zP///8z////AP///wD///8AAAAAAAAAAAAAAAAAAAAAAA==" },
  mob_monk: { w: 16, h: 16, rgba: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAAAA////AP///wD///8A////AAoKCv8KCgr/CgoK/woKCv8AAAAA////AP///wD///8A////AP///wD///8AAAAAAP///wD///8A////AAoKCv8AAAD/7fLx/+3y8f/t8vH/3Obk/wAAAAD///8A////AP///wD///8A////AAAAAAD///8A////APX19f8AAAD/2+Tj/9vk4/8AAAD/2+Tj/wAAAP8AAAAA////AP///wD///8A////AP///wAAAAAA////APX19f/b5OP/AAAA/+ZBFf/mQRX/2+Tj/9vk4/+8zMr/oyMH/6MjB/8AAAAA////AP///wD///8AAAAAAP///wDc5uT/2+Tj//X19f/may7/5msu/6MjB/8zMzP/AAAA/8xfKf+jIwf/AAAAAP///wD///8A////AAAAAAD///8AaXuD/9vk4//b5OP/5msu/8xfKf+jIwf/MzMz/wAAAP/MXyn/oyMH/wAAAAD///8A////AP///wAAAAAA////AGl7g/+/ys3/2+Tj/7/Kzf9pe4P/AAAA/wAAAP8KCgr/aXuD/wAAAAAAAAAA////AP///wD///8AAAAAAP///wAAAAAAaXuD/2l7g/9pe4P/2+Tj/7/Kzf+ksbf/aXuD/wAAAAAAAAAAAAAAAP///wD///8A////AAAAAAD///8AAAAAAKMjB//MXyn/zF8p/+ZrLv/may7/5msu/+ZrLv/mQRX/AAAAAP///wD///8A////AP///wAAAAAA////AP///wDmQRX/5msu/+ZrLv/may7/5msu/+ZrLv/may7/5msu/+ZBFf8AAAAA////AP///wD///8AAAAAAP///wD///8A5kEV/+ZrLv/may7/oyMH/6MjB/+jIwf/zF8p/+ZrLv/mQRX/AAAAAP///wD///8A////AAAAAAD///8A////AOZBFf/may7/oyMH/wAAAAAAAAAAAAAAAKMjB//MXyn/zy0I/wAAAAD///8A////AP///wAAAAAA////AP///wCPoKX/aXuD/2l7g/8AAAAAAAAAAAAAAABpe4P/aXuD/2l7g/+PoKX/AAAAAP///wD///8AAAAAAA==" },
  mob_dm300: { w: 22, h: 20, rgba: "gICAAICAgACAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAgICAAP///wD///8A////AP///wD///8AwMCz/8DAs//AwLP/wMCz/8DAs/9iUkH/YlJB/2JSQf9XV1r/OztB/wAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AwMCz/9XVzP/V1cz/1dXM/9XVzP/V1cz/1dXM/4h4Zv99fYD/fX2A/319gP87O0H/AAAAAP///wCAgIAAOztB/4CAgAAAAAAA////AP///wD///8AmZmT/7i4s/+4uLP/uLiz/7i4s/+4uLP/uLiz/7i4s/99fYD/fX2A/319gP99fYD/fX2A/zs7Qf8AAAAAAAAAADs7Qf8AAAAAAAAAAP///wD///8A////ALaigP/Ov6P/zr+j/86/o//V1cz/1dXM/9XVzP/Ov6P/fX2A/319gP99fYD/fX2A/319gP87O0H/AAAAAAAAAAA7O0H/AAAAAAAAAAD///8A////AMDAs//V1cz/uLiz/86/o//V1cz/uLiz/9XVzP/V1cz/uLiz/319gP///2b///9m/319gP///2b///9m/zs7Qf8AAAAAOztB/wAAAAD///8A////AP///wDAwLP/1dXM/9XVzP/Ov6P/1dXM/9XVzP/V1cz/1dXM/9XVzP99fYD/fX2A/319gP99fYD/fX2A/319gP87O0H/OztB/zs7Qf8AAAAA////AP///wD///8AwMCz/5mUk/+ZlJP/1dXM/9XVzP/V1cz/mZST/5mUk//V1cz/1dXM/319gP8AAAD/AAAA/wAAAP8AAAD/OztB/wAAAAAAAAAAAAAAAP///wD///8AmIFp/5iBaf+YgWn/mZST/5mUk/+ZlJP/mZST/5mUk/+ZlJP/mZST/0o7MP8vLjb/fX2A/319gP99fYD/fX2A/zs7Qf8AAAAAAAAAAAAAAAD///8Ae2dU/5qXmf+al5n/mpeZ/5qXmf+al5n/mpeZ/5qXmf+al5n/mpeZ/3VydP9fXWb/cF9S/y8uNv87OkH/fX2A/319gP99fYD/OztB/wAAAAD///8A////AGJQQf99eoD/fXqA/316gP99eoD/fXqA/316gP99eoD/fXqA/316gP9XVFr/UE5Z/19dZv9wX1L/UE5Z/zs6Qf9fX2b/X19m/zs7Qf8AAAAA////AP///wA7OkH/X11m/316gP99eoD/fXqA/4h2Zv99eoD/fXqA/316gP99eoD/V1Ra/3BfUv9QTln/OzpB/0o7MP99fYD/iHhm/4h4Zv87O0H/AAAAAP///wD///8AAAAAADs6Qf87OkH/Sjsw/0o7MP9KOzD/Sjsw/0o7MP87OkH/OzpB/zs6Qf87OkH/Sjsw/19fZv99fYD/X19m/319gP9fX2b/OztB/wAAAAD///8A////AAAAAAAAAAAAgnRc/6WZgv+qqqP/qqqj/6qqo/+qqqP/qqqj/6qqo/+lmYL/zr+j/319gP99fYD/fX2A/319gP99fYD/fX2A/zs7Qf8AAAAA////AP///wD///8AOztB/zs7Qf87O0H/OztB/zs7Qf87O0H/OztB/zs7Qf87O0H/OztB/zs7Qf87O0H/OztB/zs7Qf8lJS3/JSUt/yUlLf8lJS3/JSUt/yUlLf8AAAAAOztB/319gP99fYD/fX2A/319gP99fYD/JCQz/319gP99fYD/fX2A/319gP8kJDP/fX2A/319gP99fYD/fX2A/zs7Qf9fX2b/X19m/19fZv9fX2b/OztB/zs7Qf99fYD/JCQz/yQkM/+ampn/mpqZ/5qamf+ampn/mpqZ/5qamf+ampn/mpqZ/5qamf8kJDP/JCQz/319gP8lJS3/QkJN/0JCTf9CQk3/QkJN/yUlLf87O0H/mpqZ/yQkM/8kJDP/mpqZ/319gP+ampn/fX2A/5qamf99fYD/mpqZ/319gP+ampn/JCQz/yQkM/+fj3r/OztB/19fZv9fX2b/X19m/19fZv87O0H/OztB/5+Pev+fj3r/n496/5qamf+ampn/mpqZ/5qamf+ampn/mpqZ/5qamf+ampn/n496/5+Pev+fj3r/n496/yUlLf9CQk3/QkJN/0JCTf9CQk3/JSUt/wAAAAA7O0H/OztB/zs7Qf87O0H/OztB/zs7Qf87O0H/OztB/zs7Qf87O0H/OztB/zs7Qf87O0H/OztB/zs7Qf87O0H/OztB/zs7Qf87O0H/OztB/wAAAAA=" },
  mob_bee: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8A////AP///wAAAAAA3Ny9OtHRqEPj48lD7e3cOgAAAAAAAAAAAAAAAN/fwjre3sFD1dWvOgAAAAD///8A////AP///wD///8A19ezOufn0k3W1rJN5+fSTeDgxU3b27tQAAAAANnZuDrY2LVjzs6hY+vr2U3n59E6////AP///wD///8A////AOzs2kPq6tZN29u7TePjyU25uXl6TUdD/01HQ//T06yQTUdD/01HQ//Vyqp60tKrQ////wD///8A////AP///wDv7+JD4eHGTd3dv026unx6AAAA/zEsKv+6pY//TUdD/zEsKv+6pY//TUdD/9PTrFr///8A////AP///wD///8A5eXOOurq1k3IyJd6//94/wAAAP8xLCr/MSwq/01HQ/8xLCr/MSwq/01HQ//V1a9Q////AP///wD///8A////AAAAAADHx5VQwZBA///vAP+3lkP/AAAA/wAAAP9wRSL/AAAA/wAAAP+4uHdmTUdDAP///wD///8A////AP///wAAAAAAAAAAAMGQQP//7wD/t5ZD///vAP//7wD/cEUi/01HQwAxLCoATUdDAE1HQwD///8A////AP///wD///8A////AP///wDBkEAAimYr/4pmK/+KZiv/imYr/3BFIgBwRSIAAAAAAAAAAAD///8A////AP///wD///8A////AP///wD///8AwZBAAMGQQAD//3gA//94AP///wBwRSIAcEUiAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAAAzAAAAMwAAADMAAAAzAAAAMwAAADMAAAAz////AP///wD///8A////AA==" },
  npc_blacksmith: { w: 16, h: 16, rgba: "////AP///wD///8A////AE1eGv+GtCX/hrQl/4a0Jf9NXhr/AAAAAAAAAACAgIAAgICAAAAAAAAAAAAAAAAAAP///wD///8A////ACMiC/+XlKH/sK23/7Ctt/+51mH/jJtS/1lWZv+AgIAAgICAAICAgAAAAAAAAAAAAAAAAAD///8A////AP///wAjIgv/l5Sh/7Ctt/+wrbf/sK23/7Ctt/9ZVmb/gICAAICAgACAgIAAAAAAAAAAAAAAAAAA////AP///wAvKzv/IyIL/21pe/+Mm1L/udZh/7nWYf+51mH/TV4a/4CAgACAgIAAgICAAAAAAAAAAAAAAAAAAP///wD///8AgICAACMiC/9taXv/bWl7/wAAAP9taXv/AAAA/y8rO/+AgIAAgICAAICAgAAAAAAAAAAAAAAAAAD///8A////AAAAAAAjIgv/bWl7/5eUof9taXv/l5Sh/21pe/9ZVmb/gICAAICAgACAgIAAAAAAAAAAAAAAAAAA////AP///wAAAAAAIyIL/15dNv9taXv/l5Sh/5eUof9ZVmb/AAAAAAAAAACAgIAAgICAAAAAAAAAAAAAAAAAAP///wD///8AeXWD/5eUof+wrbf/sK23/7Ctt/+wrbf/l5Sh/1lWZv////8A////AP///wAAAAAAAAAAAAAAAAD///8AeXWD/5eUof+XlKH/bWl7/5eUof+wrbf/sK23/7Ctt/95dYP/////AP///wD///8AAAAAAAAAAAAAAAAA////AFlWZv+XlKH/WVZm/21pe/+XlKH/MzMz/zMzM/+XlKH/eXWD/y8rO/////8A////AAAAAAAAAAAAAAAAAFk6G/9ZVmb/l5Sh/1lWZv9ZOhv/WTob/wAAAP8AAAD/l5Sh/y8rO/8vKzv/////AP///wAAAAAAAAAAAAAAAABZOhsAWTobAC8rO/8jIgv/jJtS/7nWYf8AAAD/AAAA/7nWYf8vKzv/Lys7/////wD///8AAAAAAAAAAAAAAAAAWTobAFk6GwD///8ATV4a/4ybUv+LHxD/4HEV//irEf/dTh3/dggL/wAAAP8AAAD/gICAAAAAAAAAAAAAAAAAAP///wD///8ATV4a/15dNv9eXTb/IyIL/08GCP9PBgj/TwYI/wAAAP8AAAD/AAAAAICAgAAAAAAAAAAAAAAAAAD///8A////AFlWZv9taXv/Lys7/08GCABPBggAMzMz/wAAAP8AAAD/TwYIAAAAAACAgIAAAAAAAAAAAAAAAAAA////AP///wAvKzv/Lys7/y8rO/////8AMzMz/wAAAP8AAAD/AAAA/wAAAP8AAAAAgICAAAAAAAAAAAAAAAAAAA==" },
  item_wand_magicmissile: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZqZ5MP+meTD/pnkw/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AM/JjQD///8AAAAAZqZ5MP///////wAA/2tKEP8AAABm////AP///wD///8A////AP///wD///8A////AP///wC2sGcAAAAAZgAAAGameTD//wAA/44AAP9rShD/AAAAZv///wD///8A////AOfinwD///8A////AP///wD///8AAAAAZgAAAGb/////sc3N/4GBgf+BgYH/AAAAZgAAAGb///8A////AP///wDPyY0Az8mNAM/JjQD///8AAAAAZgAAAGameTD/k2ok/2tKEP8AAABmAAAAZgAAAGZrShAA////AP///wD///8A////ALawZwCCflYAAAAAZgAAAGameTD/k2ok/2tKEP8AAABmAAAAZoGBgQCBgYEA////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/////sc3N/4GBgf8AAABmAAAAZmtKEAD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGameTD/k2ok/2tKEP8AAABmAAAAZmtKEADn4p8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGameTD/k2ok/2tKEP8AAABmAAAAZoGBgQD///8A5+KfAP///wD///8A////AP///wD///8AAAAAZgAAAGb/////sc3N/4GBgf8AAABmAAAAZmtKEAD///8A////AOfinwD///8A////AP///wD///8A////AAAAAGameTD/k2ok/2tKEP8AAABmAAAAZmtKEAD///8Az8mNAM/JjQDn4p8A////AP///wD///8A////AP///wAAAABmk2ok/2tKEP8AAABmAAAAZoGBgQD///8A////AIJ+VgCCflYAgn5WAP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZmtKEAC2sGcAtrBnALawZwC2sGcAtrBnALawZwD///8A////AP///wD///8A////AP///wCTaiQAa0oQAGtKEAC2sGcAtrBnALawZwC2sGcAtrBnALawZwC2sGcA////AP///wD///8A////AA==" },
  item_wand_teleportation: { w: 16, h: 16, rgba: "AAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wAAAAAA////AIGBgQCBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQAAAABmAAAAZvnazv/52s7/+drO/wAAAGb///8AAAAAAP///wCBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQCBgYEAAAAAZvnazv///////wAA/5R1aP8AAABm////AAAAAAD///8AgYGBAIGBgQCBgYEAgYGBAIGBgQCBgYEAAAAAZgAAAGb52s7//wAA/44AAP+UdWj/AAAAZv///wAAAAAA////AIGBgQCBgYEAgYGBAIGBgQCBgYEAAAAAZgAAAGb/9Vv/saEA/4R6AP+EegD/AAAAZgAAAGb///8AAAAAAP///wCBgYEAgYGBAIGBgQCBgYEAAAAAZgAAAGb52s7/9MGt/5R1aP8AAABmAAAAZgAAAGb///8A////AAAAAAD///8AgYGBAIGBgQCBgYEAAAAAZgAAAGb52s7/9MGt/5R1aP8AAABmAAAAZoR6AACEegAA////AP///wAAAAAA////AIGBgQCBgYEAAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZoGBgQCBgYEA////AP///wD///8AAAAAAP///wCBgYEAAAAAZgAAAGb52s7/9MGt/5R1aP8AAABmAAAAZoGBgQCBgYEAgYGBAP///wD///8A////AAAAAAD///8AAAAAZgAAAGb52s7/9MGt/5R1aP8AAABmAAAAZoR6AACBgYEAgYGBAIGBgQD///8A////AP///wAAAAAAAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZoGBgQCBgYEAgYGBAIGBgQCBgYEA////AP///wD///8AAAAAAAAAAGb52s7/9MGt/5R1aP8AAABmAAAAZkxMTACBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQD///8A////AAAAAAAAAABm9MGt/5R1aP8AAABmAAAAZoR6AACBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQCBgYEA////AP///wAAAAAAAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_wand_slowness: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AIGBgQCBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQAAAABmAAAAZu+Vff/vlX3/75V9/wAAAGb///8A////AP///wD///8AgYGBAIGBgQCBgYEAgYGBAIGBgQCBgYEAAAAAZu+Vff///////wAA/4UrDv8AAABm////AP///wD///8A////AIGBgQCBgYEAgYGBAIGBgQCBgYEAAAAAZgAAAGbvlX3//wAA/44AAP+FKw7/AAAAZv///wD///8A////AP///wCBgYEAgYGBAIGBgQCBgYEAAAAAZgAAAGb/9Vv/saEA/4R6AP+EegD/AAAAZgAAAGb///8A////AP///wD///8AgYGBAIGBgQCBgYEAAAAAZgAAAGbvlX3/3Ewe/4UrDv8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AIGBgQCBgYEAAAAAZgAAAGbvlX3/3Ewe/4UrDv8AAABmAAAAZoR6AACEegAA////AP///wD///8A////AP///wCBgYEAAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZoGBgQCBgYEA////AP///wD///8A////AP///wD///8AAAAAZgAAAGbvlX3/3Ewe/4UrDv8AAABmAAAAZoGBgQCBgYEAgYGBAP///wD///8A////AP///wD///8AAAAAZgAAAGbvlX3/3Ewe/4UrDv8AAABmAAAAZoR6AACBgYEAgYGBAIGBgQD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZoGBgQCBgYEAgYGBAIGBgQCBgYEA////AP///wD///8A////AAAAAGbvlX3/3Ewe/4UrDv8AAABmAAAAZkxMTACBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQD///8A////AP///wAAAABm3Ewe/4UrDv8AAABmAAAAZoR6AACBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQCBgYEA////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_wand_firebolt: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AIGBgQCBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQAAAABmAAAAZpCFbf+QhW3/kIVt/wAAAGb///8A////AP///wD///8AgYGBAIGBgQCBgYEAgYGBAIGBgQCBgYEAAAAAZpCFbf///////wAA/yUYAv8AAABm////AP///wD///8A////AIGBgQCBgYEAgYGBAIGBgQCBgYEAAAAAZgAAAGaQhW3//wAA/44AAP8lGAL/AAAAZv///wD///8A////AP///wCBgYEAgYGBAIGBgQCBgYEAAAAAZgAAAGb/9Vv/saEA/4R6AP+EegD/AAAAZgAAAGb///8A////AP///wD///8AgYGBAIGBgQCBgYEAAAAAZgAAAGaQhW3/Qy4C/yUYAv8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AIGBgQCBgYEAAAAAZgAAAGaQhW3/Qy4C/yUYAv8AAABmAAAAZoR6AACEegAA////AP///wD///8A////AP///wCBgYEAAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZoGBgQCBgYEA////AP///wD///8A////AP///wD///8AAAAAZgAAAGaQhW3/Qy4C/yUYAv8AAABmAAAAZoGBgQCBgYEAgYGBAP///wD///8A////AP///wD///8AAAAAZgAAAGaQhW3/Qy4C/yUYAv8AAABmAAAAZoR6AACBgYEAgYGBAIGBgQD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZoGBgQCBgYEAgYGBAIGBgQCBgYEA////AP///wD///8A////AAAAAGaQhW3/Qy4C/yUYAv8AAABmAAAAZkxMTACBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQD///8A////AP///wAAAABmQy4C/yUYAv8AAABmAAAAZoR6AACBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQCBgYEA////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_wand_poison: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AIGBgQCBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQAAAABmAAAAZvSkhf/0pIX/9KSF/wAAAGb///8A////AP///wD///8AgYGBAIGBgQCBgYEAgYGBAIGBgQCBgYEAAAAAZvSkhf///////wAA/4w8Fv8AAABm////AP///wD///8A////AIGBgQCBgYEAgYGBAIGBgQCBgYEAAAAAZgAAAGb0pIX//wAA/44AAP+MPBb/AAAAZv///wD///8A////AP///wCBgYEAgYGBAIGBgQCBgYEAAAAAZgAAAGb/9Vv/saEA/4R6AP+EegD/AAAAZgAAAGb///8A////AP///wD///8AgYGBAIGBgQCBgYEAAAAAZgAAAGb0pIX/52Yt/4w8Fv8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AIGBgQCBgYEAAAAAZgAAAGb0pIX/52Yt/4w8Fv8AAABmAAAAZoR6AACEegAA////AP///wD///8A////AP///wCBgYEAAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZoGBgQCBgYEA////AP///wD///8A////AP///wD///8AAAAAZgAAAGb0pIX/52Yt/4w8Fv8AAABmAAAAZoGBgQCBgYEAgYGBAP///wD///8A////AP///wD///8AAAAAZgAAAGb0pIX/52Yt/4w8Fv8AAABmAAAAZoR6AACBgYEAgYGBAIGBgQD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZoGBgQCBgYEAgYGBAIGBgQCBgYEA////AP///wD///8A////AAAAAGb0pIX/52Yt/4w8Fv8AAABmAAAAZkxMTACBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQD///8A////AP///wAAAABm52Yt/4w8Fv8AAABmAAAAZoR6AACBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQCBgYEA////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_wand_regrowth: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AIGBgQCBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQAAAABmAAAAZtaujv/Wro7/1q6O/wAAAGb///8A////AP///wD///8AgYGBAIGBgQCBgYEAgYGBAIGBgQCBgYEAAAAAZtaujv///////wAA/25EIf8AAABm////AP///wD///8A////AIGBgQCBgYEAgYGBAIGBgQCBgYEAAAAAZgAAAGbWro7//wAA/44AAP9uRCH/AAAAZv///wD///8A////AP///wCBgYEAgYGBAIGBgQCBgYEAAAAAZgAAAGb/9Vv/saEA/4R6AP+EegD/AAAAZgAAAGb///8A////AP///wD///8AgYGBAIGBgQCBgYEAAAAAZgAAAGbWro7/t3U8/25EIf8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AIGBgQCBgYEAAAAAZgAAAGbWro7/t3U8/25EIf8AAABmAAAAZoR6AACEegAA////AP///wD///8A////AP///wCBgYEAAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZoGBgQCBgYEA////AP///wD///8A////AP///wD///8AAAAAZgAAAGbWro7/t3U8/25EIf8AAABmAAAAZoGBgQCBgYEAgYGBAP///wD///8A////AP///wD///8AAAAAZgAAAGbWro7/t3U8/25EIf8AAABmAAAAZoR6AACBgYEAgYGBAIGBgQD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZoGBgQCBgYEAgYGBAIGBgQCBgYEA////AP///wD///8A////AAAAAGbWro7/t3U8/25EIf8AAABmAAAAZkxMTACBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQD///8A////AP///wAAAABmt3U8/25EIf8AAABmAAAAZoR6AACBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQCBgYEA////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_wand_blink: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZr6Zhf++mYX/vpmF/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZr6Zhf///////wAA/1QuGP8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGa+mYX//wAA/44AAP9ULhj/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP+EegD/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGa+mYX/j1Iv/1QuGP8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGa+mYX/j1Iv/1QuGP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGa+mYX/j1Iv/1QuGP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGa+mYX/j1Iv/1QuGP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGa+mYX/j1Iv/1QuGP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmj1Iv/1QuGP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_wand_lightning: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZufRr//n0a//59Gv/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZufRr////////wAA/4JrR/8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbn0a///wAA/44AAP+Ca0f/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP+EegD/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbn0a//17N4/4JrR/8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbn0a//17N4/4JrR/8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbn0a//17N4/4JrR/8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbn0a//17N4/4JrR/8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGbn0a//17N4/4JrR/8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABm17N4/4JrR/8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_wand_amok: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZvR7cf/0e3H/9Htx/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZvR7cf///////wAA/4cMBP8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb0e3H//wAA/44AAP+HDAT/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP+EegD/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb0e3H/3xsK/4cMBP8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb0e3H/3xsK/4cMBP8AAABmAAAAZoR6AACEegAA////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZv///wCBgYEAgYGBAP///wD///8A////AP///wD///8AAAAAZgAAAGb0e3H/3xsK/4cMBP8AAABmAAAAZv///wD///8AgYGBAIGBgQD///8A////AP///wD///8AAAAAZgAAAGb0e3H/3xsK/4cMBP8AAABmAAAAZv///wD///8A////AIGBgQCBgYEA////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZv///wD///8A////AP///wCBgYEAgYGBAP///wD///8A////AAAAAGb0e3H/3xsK/4cMBP8AAABmAAAAZv///wD///8A////AP///wD///8AgYGBAIGBgQD///8A////AP///wAAAABm3xsK/4cMBP8AAABmAAAAZv///wD///8A////AP///wD///8A////AIGBgQCBgYEA////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_wand_reach: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AIGBgQCBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQAAAABmAAAAZqPmn/+j5p//o+af/wAAAGb///8A////AP///wCBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQCBgYEAAAAAZqPmn////////wAA/0CBVv8AAABm////AP///wD///8AgYGBAIGBgQCBgYEAgYGBAIGBgQCBgYEAAAAAZgAAAGaj5p///wAA/44AAP9AgVb/AAAAZv///wD///8A////AIGBgQCBgYEAgYGBAIGBgQCBgYEAAAAAZgAAAGb/9Vv/saEA/4R6AP+EegD/AAAAZgAAAGb///8A////AP///wCBgYEAgYGBAIGBgQCBgYEAAAAAZgAAAGaj5p//RsZy/0CBVv8AAABmAAAAZgAAAGZAgVYA////AP///wD///8AgYGBAIGBgQCBgYEAAAAAZgAAAGaj5p//RsZy/0CBVv8AAABmAAAAZoR6AACEegAA////AP///wD///8A////AIGBgQCBgYEAAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZkCBVgCBgYEA////AP///wD///8A////AP///wCBgYEAAAAAZgAAAGaj5p//RsZy/0CBVv8AAABmAAAAZkCBVgCBgYEAgYGBAP///wD///8A////AP///wD///8AAAAAZgAAAGaj5p//RsZy/0CBVv8AAABmAAAAZoR6AACBgYEAgYGBAIGBgQD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZkCBVgCBgYEAgYGBAIGBgQCBgYEA////AP///wD///8A////AAAAAGaj5p//RsZy/0CBVv8AAABmAAAAZkCBVgCBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQD///8A////AP///wAAAABmRsZy/0CBVv8AAABmAAAAZoR6AACBgYEAgYGBAIGBgQCBgYEAgYGBAIGBgQCBgYEA////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_wand_flock: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZuw6b//sOm//7Dpv/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZuw6b////////wAA/3YZSP8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbsOm///wAA/44AAP92GUj/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP+EegD/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbsOm//uQBf/3YZSP8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbsOm//uQBf/3YZSP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbsOm//uQBf/3YZSP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbsOm//uQBf/3YZSP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGbsOm//uQBf/3YZSP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmuQBf/3YZSP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_wand_disintegration: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZo5UAP+OVAD/jlQA/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZo5UAP///////wAA/zQgAv8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaOVAD//wAA/44AAP80IAL/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP+EegD/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaOVAD/UzMA/zQgAv8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaOVAD/UzMA/zQgAv8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaOVAD/UzMA/zQgAv8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaOVAD/UzMA/zQgAv8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGaOVAD/UzMA/zQgAv8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmUzMA/zQgAv8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_wand_avalanche: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZubm5v9mZmb/ZmZm/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZubm5v///////wAA/wAAAP8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbm5ub//wAA/44AAP9mZmb/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP+EegD/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGZmZmb/MDAw/2ZmZv8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbm5ub/MDAw/2ZmZv8AAABmAAAAZoR6AACEegAA////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZv///wCBgYEA////AP///wD///8A////AP///wD///8AAAAAZgAAAGbm5ub/mpqa/2ZmZv8AAABmAAAAZv///wD///8AgYGBAP///wD///8A////AP///wD///8AAAAAZgAAAGbm5ub/MDAw/wAAAP8AAABmAAAAZv///wD///8A////AIGBgQD///8A////AP///wD///8AAAAAZgAAAGb/9Vv/saEA/4R6AP8AAABmAAAAZv///wD///8A////AP///wCBgYEA////AP///wD///8A////AAAAAGbm5ub/mpqa/wAAAP8AAABmAAAAZv///wD///8A////AP///wD///8AgYGBAIGBgQD///8A////AP///wAAAABmmpqa/2ZmZv8AAABmAAAAZv///wD///8A////AP///wD///8A////AIGBgQCBgYEA////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_ring_mending: { w: 16, h: 16, rgba: "AAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAAAA////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8AAAAAAP///wD///8A////AP///wAAAABmAAAAZv/////m5ub/AAAAZgAAAGb///8A////AP///wD///8A////AAAAAAD///8A////AP///wD///8AAAAAZubm5v/m5ub/5ubm/7S0tP8AAABm////AP///wD///8A////AP///wAAAAAA////AP///wD///8AAAAAZgAAAGb/1zz/tLS0/7S0tP//1zz/AAAAZgAAAGb///8A////AP///wD///8AAAAAAP///wD///8A////AAAAAGb/1zz//8cA//+dAP//nQD//50A///XPP8AAABm////AP///wD///8A////AAAAAAD///8A////AP///wAAAABm/8cA//+dAP8AAABmAAAAZv+dAP//xwD/AAAAZv///wD///8A////AP///wAAAAAA////AP///wD///8AAAAAZv+dAP//xwD/AAAAZgAAAGb/xwD//50A/wAAAGb///8A////AP///wD///8AAAAAAP///wD///8A////AAAAAGb/nQD//50A///XPP//1zz//50A//+dAP8AAABm////AP///wD///8A////AAAAAAD///8A////AP///wAAAABmAAAAZv+dAP//nQD//50A//+dAP8AAABmAAAAZv///wD///8A////AP///wAAAAAA////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8AAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAAAA////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_ring_detection: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv////+88f//AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZrzx//+88f//vPH//3m8zv8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/1zz/ebzO/3m8zv//1zz/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/1zz//8cA//+dAP//nQD//50A///XPP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABm/8cA//+dAP8AAABmAAAAZv+dAP//xwD/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZv+dAP//xwD/AAAAZgAAAGb/xwD//50A/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/nQD//50A///XPP//1zz//50A//+dAP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv+dAP//nQD//50A//+dAP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_ring_shadows: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv////+0Bgz/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZrQGDP+0Bgz/tAYM/3cEBf8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/1zz/dwQF/3cEBf//1zz/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/1zz//8cA//+dAP//nQD//50A///XPP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABm/8cA//+dAP8AAABmAAAAZv+dAP//xwD/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZv+dAP//xwD/AAAAZgAAAGb/xwD//50A/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/nQD//50A///XPP//1zz//50A//+dAP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv+dAP//nQD//50A//+dAP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_ring_power: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv//////ACb/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZv8AJv//ACb//wAm/9IAGf8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/1zz/0gAZ/9IAGf//1zz/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/1zz//8cA//+dAP//nQD//50A///XPP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABm/8cA//+dAP8AAABmAAAAZv+dAP//xwD/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZv+dAP//xwD/AAAAZgAAAGb/xwD//50A/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/nQD//50A///XPP//1zz//50A//+dAP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv+dAP//nQD//50A//+dAP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_ring_herbalism: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv////+SYKz/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZpJgrP+SYKz/kmCs/1g3aP8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/1zz/WDdo/1g3aP//1zz/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/1zz//8cA//+dAP//nQD//50A///XPP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABm/8cA//+dAP8AAABmAAAAZv+dAP//xwD/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZv+dAP//xwD/AAAAZgAAAGb/xwD//50A/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/nQD//50A///XPP//1zz//50A//+dAP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv+dAP//nQD//50A//+dAP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_ring_accuracy: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv//////+JH/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZv/4kf//+JH///iR/7evUv8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/1zz/t69S/7evUv//1zz/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/1zz//8cA//+dAP//nQD//50A///XPP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABm/8cA//+dAP8AAABmAAAAZv+dAP//xwD/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZv+dAP//xwD/AAAAZgAAAGb/xwD//50A/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/nQD//50A///XPP//1zz//50A//+dAP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv+dAP//nQD//50A//+dAP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_ring_evasion: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv////8APhL/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgA+Ev8APhL/AD4S/wAAAP8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/1zz/AAAA/wAAAP//1zz/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/1zz//8cA//+dAP//nQD//50A///XPP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABm/8cA//+dAP8AAABmAAAAZv+dAP//xwD/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZv+dAP//xwD/AAAAZgAAAGb/xwD//50A/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/nQD//50A///XPP//1zz//50A//+dAP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv+dAP//nQD//50A//+dAP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_ring_satiety: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv////8AW4H/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgBbgf8AW4H/AFuB/wA0Tf8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/1zz/ADRN/wA0Tf//1zz/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/1zz//8cA//+dAP//nQD//50A///XPP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABm/8cA//+dAP8AAABmAAAAZv+dAP//xwD/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZv+dAP//xwD/AAAAZgAAAGb/xwD//50A/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/nQD//50A///XPP//1zz//50A//+dAP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv+dAP//nQD//50A//+dAP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_ring_haste: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv////8AmiL/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgCaIv8AmiL/AJoi/wBmK/8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/1zz/AGYr/wBmK///1zz/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/1zz//8cA//+dAP//nQD//50A///XPP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABm/8cA//+dAP8AAABmAAAAZv+dAP//xwD/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZv+dAP//xwD/AAAAZgAAAGb/xwD//50A/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/nQD//50A///XPP//1zz//50A//+dAP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv+dAP//nQD//50A//+dAP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_ring_haggler: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv////8tAP//AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZi0A//8tAP//LQD//xgAnf8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/1zz/GACd/xgAnf//1zz/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/1zz//8cA//+dAP//nQD//50A///XPP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABm/8cA//+dAP8AAABmAAAAZv+dAP//xwD/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZv+dAP//xwD/AAAAZgAAAGb/xwD//50A/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/nQD//50A///XPP//1zz//50A//+dAP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv+dAP//nQD//50A//+dAP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_ring_elements: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv/////bopr/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZtuimv/bopr/26Ka/4tkYP8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/1zz/i2Rg/4tkYP//1zz/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/1zz//8cA//+dAP//nQD//50A///XPP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABm/8cA//+dAP8AAABmAAAAZv+dAP//xwD/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZv+dAP//xwD/AAAAZgAAAGb/xwD//50A/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/nQD//50A///XPP//1zz//50A//+dAP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv+dAP//nQD//50A//+dAP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AOzs7ADs7OwA7OzsAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wDs7OwA7OzsAOzs7AD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A7OzsAOzs7ADs7OwA////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AOzs7ADs7OwA7OzsAA==" },
  item_ring_thorns: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv////+otLT/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZqi0tP+otLT/qLS0/4pmZv8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGb/1zz/imZm/4pmZv//1zz/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/1zz//8cA//+dAP//nQD//50A///XPP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABm/8cA//+dAP8AAABmAAAAZv+dAP//xwD/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8AAAAAZv+dAP//xwD/AAAAZgAAAGb/xwD//50A/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGb/nQD//50A///XPP//1zz//50A//+dAP8AAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv+dAP//nQD//50A//+dAP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAOzs7ADs7OwA7OzsAA==" },
  item_potion_experience: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmmmIz/7V9T/8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRsLCw0dC/s//Yx7r/29vb0dvb29EAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNGaYjP/tX1P/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRAAAAZgAAAGbb29vRAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABm29vb0QAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABmAAAAZgAAAGbb29vRAAAAZgAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0QAAAGYAAABmAAAAZgAAAGYAAABmAAAAZtvb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZrCwsNHSABn/0gAZ//8AJv//ACb///////8AJv/b29vRAAAAZv///wD///8A////AP///wD///8A////AAAAAGawsLDR0gAZ/9IAGf//ACb//wAm////////ACb/29vb0QAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0dIAGf/SABn//wAm//8AJv//ACb//wAm/9vb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZgAAAGawsLDR0gAZ/9IAGf//ACb//wAm/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNHFxcXRxcXF0dvb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_potion_toxicgas: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmmmIz/7V9T/8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRsLCw0dC/s//Yx7r/29vb0dvb29EAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNGaYjP/tX1P/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRAAAAZgAAAGbb29vRAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABm29vb0QAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABmAAAAZgAAAGbb29vRAAAAZgAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0QAAAGYAAABmAAAAZgAAAGYAAABmAAAAZtvb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZrCwsNEAKbj/ACm4/wA+//8APv///////wA+///b29vRAAAAZv///wD///8A////AP///wD///8A////AAAAAGawsLDRACm4/wApuP8APv//AD7///////8APv//29vb0QAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0QApuP8AKbj/AD7//wA+//8APv//AD7//9vb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZgAAAGawsLDRACm4/wApuP8APv//AD7//9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNHFxcXRxcXF0dvb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_potion_liquidflame: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmmmIz/7V9T/8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRsLCw0dC/s//Yx7r/29vb0dvb29EAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNGaYjP/tX1P/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRAAAAZgAAAGbb29vRAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABm29vb0QAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABmAAAAZgAAAGbb29vRAAAAZgAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0QAAAGYAAABmAAAAZgAAAGYAAABmAAAAZtvb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZrCwsNEAdCb/AHQm/wC0Pv8AtD7//////wC0Pv/b29vRAAAAZv///wD///8A////AP///wD///8A////AAAAAGawsLDRAHQm/wB0Jv8AtD7/ALQ+//////8AtD7/29vb0QAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0QB0Jv8AdCb/ALQ+/wC0Pv8AtD7/ALQ+/9vb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZgAAAGawsLDRAHQm/wB0Jv8AtD7/ALQ+/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNHFxcXRxcXF0dvb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_potion_paralyticgas: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmmmIz/7V9T/8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRsLCw0dC/s//Yx7r/29vb0dvb29EAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNGaYjP/tX1P/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRAAAAZgAAAGbb29vRAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABm29vb0QAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABmAAAAZgAAAGbb29vRAAAAZgAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0QAAAGYAAABmAAAAZgAAAGYAAABmAAAAZtvb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZrCwsNGlAGv/pQBr/+4AnP/uAJz//////+4AnP/b29vRAAAAZv///wD///8A////AP///wD///8A////AAAAAGawsLDRpQBr/6UAa//uAJz/7gCc///////uAJz/29vb0QAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0aUAa/+lAGv/7gCc/+4AnP/uAJz/7gCc/9vb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZgAAAGawsLDRpQBr/6UAa//uAJz/7gCc/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNHFxcXRxcXF0dvb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_potion_levitation: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmmmIz/7V9T/8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRsLCw0dC/s//Yx7r/29vb0dvb29EAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNGaYjP/tX1P/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRAAAAZgAAAGbb29vRAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABm29vb0QAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABmAAAAZgAAAGbb29vRAAAAZgAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0QAAAGYAAABmAAAAZgAAAGYAAABmAAAAZtvb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZrCwsNETExP/ExMT/z4+Pv8+Pj7//////z4+Pv/b29vRAAAAZv///wD///8A////AP///wD///8A////AAAAAGawsLDRExMT/xMTE/8+Pj7/Pj4+//////8+Pj7/29vb0QAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0RMTE/8TExP/Pj4+/z4+Pv8+Pj7/Pj4+/9vb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZgAAAGawsLDRExMT/xMTE/8+Pj7/Pj4+/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNHFxcXRxcXF0dvb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_potion_mindvision: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmmmIz/7V9T/8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRsLCw0dC/s//Yx7r/29vb0dvb29EAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNGaYjP/tX1P/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRAAAAZgAAAGbb29vRAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABm29vb0QAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABmAAAAZgAAAGbb29vRAAAAZgAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0QAAAGYAAABmAAAAZgAAAGYAAABmAAAAZtvb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZrCwsNG3r6L/t6+i//bs2v/27Nr///////bs2v/b29vRAAAAZv///wD///8A////AP///wD///8A////AAAAAGawsLDRt6+i/7evov/27Nr/9uza///////27Nr/29vb0QAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0bevov+3r6L/9uza//bs2v/27Nr/9uza/9vb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZgAAAGawsLDRt6+i/7evov/27Nr/9uza/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNHFxcXRxcXF0dvb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_potion_purity: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmmmIz/7V9T/8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRsLCw0dC/s//Yx7r/29vb0dvb29EAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNGaYjP/tX1P/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRAAAAZgAAAGbb29vRAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABm29vb0QAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABmAAAAZgAAAGbb29vRAAAAZgAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0QAAAGYAAABmAAAAZgAAAGYAAABmAAAAZtvb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZrCwsNHKZwX/ymcF//+MCf//jAn///////+MCf/b29vRAAAAZv///wD///8A////AP///wD///8A////AAAAAGawsLDRymcF/8pnBf//jAn//4wJ////////jAn/29vb0QAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0cpnBf/KZwX//4wJ//+MCf//jAn//4wJ/9vb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZgAAAGawsLDRymcF/8pnBf//jAn//4wJ/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNHFxcXRxcXF0dvb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_potion_invisibility: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmmmIz/7V9T/8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRsLCw0dC/s//Yx7r/29vb0dvb29EAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNGaYjP/tX1P/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRAAAAZgAAAGbb29vRAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABm29vb0QAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABmAAAAZgAAAGbb29vRAAAAZgAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0QAAAGYAAABmAAAAZgAAAGYAAABmAAAAZtvb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZrCwsNE2GAP/NhgD/2s2Bv9rNgb//////2s2Bv/b29vRAAAAZv///wD///8A////AP///wD///8A////AAAAAGawsLDRNhgD/zYYA/9rNgb/azYG//////9rNgb/29vb0QAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0TYYA/82GAP/azYG/2s2Bv9rNgb/azYG/9vb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZgAAAGawsLDRNhgD/zYYA/9rNgb/azYG/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNHFxcXRxcXF0dvb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_potion_might: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmojZG/71RYP8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRsLCw0dSzuP/cur//29vb0dvb29EAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNGiNkb/vVFg/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRAAAAZgAAAGbb29vRAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABm29vb0QAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABmAAAAZgAAAGbb29vRAAAAZgAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0QAAAGYAAABmAAAAZgAAAGYAAABmAAAAZtvb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZrCwsNFNAHb/TQB2/3oAuP96ALj//////3oAuP/b29vRAAAAZv///wD///8A////AP///wD///8A////AAAAAGawsLDRTQB2/00Adv96ALj/egC4//////96ALj/29vb0QAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0U0Adv9NAHb/egC4/3oAuP96ALj/egC4/9vb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZgAAAGawsLDRTQB2/00Adv96ALj/egC4/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNHFxcXRxcXF0dvb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_potion_frost: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmmmIz/7V9T/8AAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRsLCw0dC/s//Yx7r/29vb0dvb29EAAABm////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNGaYjP/tX1P/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGawsLDRAAAAZgAAAGbb29vRAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABm29vb0QAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmsLCw0QAAAGYAAABmAAAAZgAAAGbb29vRAAAAZgAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0QAAAGYAAABmAAAAZgAAAGYAAABmAAAAZtvb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZrCwsNFGTEz/RkxM/4+amv+Pmpr//////4+amv/b29vRAAAAZv///wD///8A////AP///wD///8A////AAAAAGawsLDRRkxM/0ZMTP+Pmpr/j5qa//////+Pmpr/29vb0QAAAGb///8A////AP///wD///8A////AP///wAAAABmsLCw0UZMTP9GTEz/j5qa/4+amv+Pmpr/j5qa/9vb29EAAABm////AP///wD///8A////AP///wD///8AAAAAZgAAAGawsLDRRkxM/0ZMTP+Pmpr/j5qa/9vb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZrCwsNHFxcXRxcXF0dvb29EAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_scroll_identify: { w: 16, h: 16, rgba: "AAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wAAAAAA////AAAAAGYAAABmzc29////6////+v////r////6////+v////r////6////+v/zc29/wAAAGb///8AAAAAAP///wAAAABmr6KF/9vKpv/byqb/28qm/9vKpv/byqb/28qm/9vKpv/byqb/r6KF/wAAAGYAAABm////AAAAAAD///8AAAAAZqOXf//KvZ//yr2f/3hoRv/KvZ//yr2f/3hoRv/KvZ//yr2f/6OXf/8AAABm////AP///wAAAAAA////AAAAAGajl3//yr2f/8q9n/94aEb/yr2f/8q9n/94aEb/yr2f/8q9n/+jl3//AAAAZv///wD///8AAAAAAP///wAAAABmo5d//8q9n//KvZ//eGhG/7qrg/94aEb/oIxj/8q9n//KvZ//o5d//wAAAGb///8A////AAAAAAD///8AAAAAZqOXf//KvZ//yr2f/3hoRv94aEb/oIxj/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wAAAAAA////AAAAAGajl3//yr2f/8q9n/94aEb/yr2f/8q9n//KvZ//yr2f/8q9n/+jl3//AAAAZv///wD///8AAAAAAP///wAAAABmo5d//8q9n//KvZ//eGhG/8q9n//KvZ//yr2f/8q9n//KvZ//o5d//wAAAGb///8A////AAAAAGYAAABmAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wAAAABmkodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/8q9n/+jl3//AAAAZv///wD///8AAAAAZpKHa/+2qYf/tqmH/7aph/+2qYf/tqmH/7aph/+2qYf/tqmH/5KHa//byqb/r6KF/wAAAGb///8A////AAAAAGYAAABmgnZa/6OTcv+jk3L/o5Ny/6OTcv+jk3L/o5Ny/6OTcv+jk3L/gnZa/wAAAGYAAABm////AP///wAAAAAAAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8AAAAAAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_scroll_magicmapping: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AAAAAGYAAABmzc29////6////+v////r////6////+v////r////6////+v/zc29/wAAAGb///8A////AP///wAAAABmr6KF/9vKpv/byqb/28qm/9vKpv/byqb/28qm/9vKpv/byqb/r6KF/wAAAGYAAABm////AP///wD///8AAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/3hoRv/KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n/+gjGP/yr2f/8q9n/94aEb/yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//eGhG/3hoRv+6q4P/eGhG/8q9n//KvZ//o5d//wAAAGb///8A////AP///wD///8AAAAAZqOXf//KvZ//yr2f/3hoRv+6q4P/eGhG/3hoRv/KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n/94aEb/yr2f/8q9n/+gjGP/yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//eGhG/8q9n//KvZ//yr2f/8q9n//KvZ//o5d//wAAAGb///8A////AAAAAGYAAABmAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wAAAABmkodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/8q9n/+jl3//AAAAZv///wD///8AAAAAZpKHa/+2qYf/tqmH/7aph/+2qYf/tqmH/7aph/+2qYf/tqmH/5KHa//byqb/r6KF/wAAAGb///8A////AAAAAGYAAABmgnZa/6OTcv+jk3L/o5Ny/6OTcv+jk3L/o5Ny/6OTcv+jk3L/gnZa/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_scroll_recharging: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AAAAAGYAAABmzc29////6////+v////r////6////+v////r////6////+v/zc29/wAAAGb///8A////AP///wAAAABmr6KF/9vKpv/byqb/28qm/9vKpv/byqb/28qm/9vKpv/byqb/r6KF/wAAAGYAAABm////AP///wD///8AAAAAZqOXf//KvZ//yr2f/8q9n/94aEb/oIxj/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n//KvZ//eGhG/3hoRv+gjGP/yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//yr2f/3hoRv+6q4P/eGhG/8q9n//KvZ//o5d//wAAAGb///8A////AP///wD///8AAAAAZqOXf//KvZ//yr2f/8q9n/94aEb/yr2f/7qrg//KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n//KvZ//eGhG/8q9n//KvZ//yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//yr2f/3hoRv/KvZ//yr2f/8q9n//KvZ//o5d//wAAAGb///8A////AAAAAGYAAABmAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wAAAABmkodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/8q9n/+jl3//AAAAZv///wD///8AAAAAZpKHa/+2qYf/tqmH/7aph/+2qYf/tqmH/7aph/+2qYf/tqmH/5KHa//byqb/r6KF/wAAAGb///8A////AAAAAGYAAABmgnZa/6OTcv+jk3L/o5Ny/6OTcv+jk3L/o5Ny/6OTcv+jk3L/gnZa/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_scroll_removecurse: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AAAAAGYAAABmzc29////6////+v////r////6////+v////r////6////+v/zc29/wAAAGb///8A////AP///wAAAABmr6KF/9vKpv/byqb/28qm/9vKpv/byqb/28qm/9vKpv/byqb/r6KF/wAAAGYAAABm////AP///wD///8AAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n/94aEb/eGhG/3hoRv94aEb/yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//eGhG/8q9n//KvZ//eGhG/8q9n//KvZ//o5d//wAAAGb///8A////AP///wD///8AAAAAZqOXf//KvZ//yr2f/3hoRv/KvZ//yr2f/3hoRv/KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n/94aEb/eGhG/3hoRv94aEb/yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//yr2f/8q9n//KvZ//yr2f/8q9n//KvZ//o5d//wAAAGb///8A////AAAAAGYAAABmAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wAAAABmkodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/8q9n/+jl3//AAAAZv///wD///8AAAAAZpKHa/+2qYf/tqmH/7aph/+2qYf/tqmH/7aph/+2qYf/tqmH/5KHa//byqb/r6KF/wAAAGb///8A////AAAAAGYAAABmgnZa/6OTcv+jk3L/o5Ny/6OTcv+jk3L/o5Ny/6OTcv+jk3L/gnZa/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_scroll_teleportation: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AAAAAGYAAABmzc29////6////+v////r////6////+v////r////6////+v/zc29/wAAAGb///8A////AP///wAAAABmr6KF/9vKpv/byqb/28qm/9vKpv/byqb/28qm/9vKpv/byqb/r6KF/wAAAGYAAABm////AP///wD///8AAAAAZqOXf//KvZ//eGhG/7qrg//KvZ//uquD/3hoRv/KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n/94aEb/yr2f/3hoRv/KvZ//yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//uquD/3hoRv+6q4P/yr2f/8q9n//KvZ//o5d//wAAAGb///8A////AP///wD///8AAAAAZqOXf//KvZ//yr2f/7qrg/94aEb/uquD/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n/94aEb/yr2f/3hoRv/KvZ//yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n/94aEb/uquD/8q9n/+6q4P/eGhG/8q9n//KvZ//o5d//wAAAGb///8A////AAAAAGYAAABmAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wAAAABmkodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/8q9n/+jl3//AAAAZv///wD///8AAAAAZpKHa/+2qYf/tqmH/7aph/+2qYf/tqmH/7aph/+2qYf/tqmH/5KHa//byqb/r6KF/wAAAGb///8A////AAAAAGYAAABmgnZa/6OTcv+jk3L/o5Ny/6OTcv+jk3L/o5Ny/6OTcv+jk3L/gnZa/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_scroll_challenge: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AAAAAGYAAABmzc29////6////+v////r////6////+v////r////6////+v/zc29/wAAAGb///8A////AP///wAAAABmr6KF/9vKpv/byqb/28qm/9vKpv/byqb/28qm/9vKpv/byqb/r6KF/wAAAGYAAABm////AP///wD///8AAAAAZqOXf//KvZ//yr2f/3hoRv94aEb/uquD/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n/94aEb/uquD/3hoRv+6q4P/yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//eGhG/8q9n//KvZ//eGhG/8q9n//KvZ//o5d//wAAAGb///8A////AP///wD///8AAAAAZqOXf//KvZ//yr2f/3hoRv+gjGP/eGhG/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n/94aEb/yr2f/7qrg/94aEb/yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//eGhG/8q9n//KvZ//eGhG/8q9n//KvZ//o5d//wAAAGb///8A////AAAAAGYAAABmAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wAAAABmkodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/8q9n/+jl3//AAAAZv///wD///8AAAAAZpKHa/+2qYf/tqmH/7aph/+2qYf/tqmH/7aph/+2qYf/tqmH/5KHa//byqb/r6KF/wAAAGb///8A////AAAAAGYAAABmgnZa/6OTcv+jk3L/o5Ny/6OTcv+jk3L/o5Ny/6OTcv+jk3L/gnZa/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_scroll_terror: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AAAAAGYAAABmzc29////6////+v////r////6////+v////r////6////+v/zc29/wAAAGb///8A////AP///wAAAABmr6KF/9vKpv/byqb/28qm/9vKpv/byqb/28qm/9vKpv/byqb/r6KF/wAAAGYAAABm////AP///wD///8AAAAAZqOXf//KvZ//yr2f/8q9n/94aEb/yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n//KvZ//eGhG/8q9n//KvZ//yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//yr2f/3hoRv/KvZ//yr2f/8q9n//KvZ//o5d//wAAAGb///8A////AP///wD///8AAAAAZqOXf//KvZ//yr2f/8q9n/94aEb/yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n//KvZ//eGhG/8q9n//KvZ//yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//yr2f/3hoRv/KvZ//yr2f/8q9n//KvZ//o5d//wAAAGb///8A////AAAAAGYAAABmAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wAAAABmkodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/8q9n/+jl3//AAAAZv///wD///8AAAAAZpKHa/+2qYf/tqmH/7aph/+2qYf/tqmH/7aph/+2qYf/tqmH/5KHa//byqb/r6KF/wAAAGb///8A////AAAAAGYAAABmgnZa/6OTcv+jk3L/o5Ny/6OTcv+jk3L/o5Ny/6OTcv+jk3L/gnZa/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_scroll_lullaby: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AAAAAGYAAABmzc29////6////+v////r////6////+v////r////6////+v/zc29/wAAAGb///8A////AP///wAAAABmr6KF/9vKpv/byqb/28qm/9vKpv/byqb/28qm/9vKpv/byqb/r6KF/wAAAGYAAABm////AP///wD///8AAAAAZqOXf//KvZ//eGhG/8q9n/94aEb/yr2f/3hoRv/KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/3hoRv/KvZ//eGhG/8q9n/94aEb/yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n/+6q4P/eGhG/3hoRv94aEb/uquD/8q9n//KvZ//o5d//wAAAGb///8A////AP///wD///8AAAAAZqOXf//KvZ//yr2f/7qrg/94aEb/uquD/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n//KvZ//eGhG/8q9n//KvZ//yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//yr2f/3hoRv/KvZ//yr2f/8q9n//KvZ//o5d//wAAAGb///8A////AAAAAGYAAABmAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wAAAABmkodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/8q9n/+jl3//AAAAZv///wD///8AAAAAZpKHa/+2qYf/tqmH/7aph/+2qYf/tqmH/7aph/+2qYf/tqmH/5KHa//byqb/r6KF/wAAAGb///8A////AAAAAGYAAABmgnZa/6OTcv+jk3L/o5Ny/6OTcv+jk3L/o5Ny/6OTcv+jk3L/gnZa/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_scroll_psionicblast: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AAAAAGYAAABmzc29////6////+v////r////6////+v////r////6////+v/zc29/wAAAGb///8A////AP///wAAAABmr6KF/9vKpv/byqb/28qm/9vKpv/byqb/28qm/9vKpv/byqb/r6KF/wAAAGYAAABm////AP///wD///8AAAAAZqOXf//KvZ//yr2f/8q9n/94aEb/yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/6CMY//KvZ//eGhG/8q9n//KvZ//yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n/+6q4P/eGhG/3hoRv/KvZ//yr2f/8q9n//KvZ//o5d//wAAAGb///8A////AP///wD///8AAAAAZqOXf//KvZ//yr2f/8q9n/94aEb/eGhG/7qrg//KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n//KvZ//eGhG/8q9n/+gjGP/yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//yr2f/3hoRv/KvZ//yr2f/8q9n//KvZ//o5d//wAAAGb///8A////AAAAAGYAAABmAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wAAAABmkodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/8q9n/+jl3//AAAAZv///wD///8AAAAAZpKHa/+2qYf/tqmH/7aph/+2qYf/tqmH/7aph/+2qYf/tqmH/5KHa//byqb/r6KF/wAAAGb///8A////AAAAAGYAAABmgnZa/6OTcv+jk3L/o5Ny/6OTcv+jk3L/o5Ny/6OTcv+jk3L/gnZa/wAAAGYAAABm////AP///wDs7OwAAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A7OzsAOzs7ACCdloAgnZaAP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_scroll_mirrorimage: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AAAAAGYAAABmzc29////6////+v////r////6////+v////r////6////+v/zc29/wAAAGb///8A////AP///wAAAABmr6KF/9vKpv/byqb/28qm/9vKpv/byqb/28qm/9vKpv/byqb/r6KF/wAAAGYAAABm////AP///wD///8AAAAAZqOXf//KvZ//yr2f/8q9n/94aEb/yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n//KvZ//eGhG/3hoRv94aEb/yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//yr2f/3hoRv/KvZ//yr2f/8q9n//KvZ//o5d//wAAAGb///8A////AP///wD///8AAAAAZqOXf//KvZ//yr2f/8q9n/94aEb/eGhG/3hoRv/KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n//KvZ//eGhG/8q9n//KvZ//yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//yr2f/3hoRv/KvZ//yr2f/8q9n//KvZ//o5d//wAAAGb///8A////AAAAAGYAAABmAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wAAAABmkodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/8q9n/+jl3//AAAAZv///wD///8AAAAAZpKHa/+2qYf/tqmH/7aph/+2qYf/tqmH/7aph/+2qYf/tqmH/5KHa//byqb/r6KF/wAAAGb///8A////AAAAAGYAAABmgnZa/6OTcv+jk3L/o5Ny/6OTcv+jk3L/o5Ny/6OTcv+jk3L/gnZa/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_scroll_enchantment: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AAAAAGYAAABmzc29////6////+v////r////6////+v////r////6////+v/zc29/wAAAGb///8A////AP///wAAAABmr6KF/9vKpv/byqb/28qm/9vKpv/byqb/28qm/9vKpv/byqb/r6KF/wAAAGYAAABm////AP///wD///8AAAAAZqOXf//KvZ//yr2f/7qrg/94aEb/uquD/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/7qrg/94aEb/eGhG/3hoRv+6q4P/yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n/94aEb/yr2f/3hoRv/KvZ//eGhG/8q9n//KvZ//o5d//wAAAGb///8A////AP///wD///8AAAAAZqOXf//KvZ//yr2f/8q9n/94aEb/yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wD///8A////AAAAAGajl3//yr2f/8q9n//KvZ//eGhG/8q9n//KvZ//yr2f/8q9n/+jl3//AAAAZv///wD///8A////AP///wAAAABmo5d//8q9n//KvZ//yr2f/3hoRv/KvZ//yr2f/8q9n//KvZ//o5d//wAAAGb///8A////AAAAAGYAAABmAAAAZqOXf//KvZ//yr2f/8q9n//KvZ//yr2f/8q9n//KvZ//yr2f/6OXf/8AAABm////AP///wAAAABmkodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/5KHa/+Sh2v/kodr/8q9n/+jl3//AAAAZv///wD///8AAAAAZpKHa/+2qYf/tqmH/7aph/+2qYf/tqmH/7aph/+2qYf/tqmH/5KHa//byqb/r6KF/wAAAGb///8A////AAAAAGYAAABmgnZa/6OTcv+jk3L/o5Ny/6OTcv+jk3L/o5Ny/6OTcv+jk3L/gnZa/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_darkgold: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGYAAABm////////////1QD//9UA///VAP/hiQD/AAAAZgAAAGb///8A////AP///wD///8A////AAAAAGYAAABm///////VAP//1QD//9UA///VAP//1QD/4YkA/7A+AP8AAABm////AP///wD///8A////AP///wAAAABm/9UA///VAP//1QD//9UA/+GJAP/hiQD/4YkA/+GJAP+wPgD/AAAAZgAAAGb///8A////AP///wD///8AAAAAZuGJAP//1QD//9UA/+GJAP/hiQD/4YkA////////1QD//9UA/+GJAP8AAABmAAAAZv///wD///8A////AAAAAGYAAABm4YkA/+GJAP/hiQD/sD4A/////////////9UA///VAP/hiQD/sD4A/wAAAGb///8A////AP///wD///8AAAAAZgAAAGb/1QD//////////////////9UA///VAP//1QD/4YkA/7A+AP8AAABm////AP///wD///8AAAAAZgAAAGb/1QD//9UA///VAP//1QD//9UA///VAP//1QD/4YkA/+GJAP+wPgD/AAAAZv///wD///8A////AAAAAGbhiQD//9UA///VAP//1QD//9UA///VAP//1QD/4YkA/+GJAP/hiQD/sD4A/wAAAGb///8A////AP///wAAAABm4YkA/+GJAP//1QD//9UA///VAP/hiQD/4YkA/+GJAP/hiQD/sD4A/wAAAGYAAABmAAAAZgAAAGb///8AAAAAZuGJAP/hiQD/4YkA/+GJAP/hiQD/4YkA/+GJAP+wPgD/sD4A/wAAAGYAAABm/9UA/+GJAP8AAABm////AAAAAGYAAABmsD4A/7A+AP+wPgD/sD4A/7A+AP+wPgD/AAAAZgAAAGYAAABm///////VAP+wPgD/AAAAZv///wD///8AAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABm/9UA///VAP/hiQD/sD4A/wAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGbhiQD/sD4A/wAAAGYAAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABm////AA==" },
  item_pickaxe: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZv///////////////wAAAGb///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGYAAABmAAAAZv//////////AAAAZgAAAGYAAABm////AP///wD///8A////AP///wD///8A////AAAAAGbBhVX/2Zdk///////Nzc3/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmjl01/83Nzf/Nzc3/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZs3Nzf/Nzc3/wYVV/9mXZP8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZs3Nzf+BgYH/AAAAZo5dNf/BhVX/2Zdk/wAAAGYAAABm////AP///wD///8A////AP///wD///8AAAAAZs3Nzf+BgYH/AAAAZgAAAGYAAABmjl01/8GFVf/Zl2T/AAAAZgAAAGb///8A////AP///wD///8A////AAAAAGaBgYH/AAAAZgAAAGb///8AAAAAZgAAAGaOXTX/wYVV/9mXZP8AAABmAAAAZv///wD///8A////AP///wAAAABmgYGB/wAAAGb///8A////AP///wAAAABmAAAAZo5dNf/BhVX/2Zdk/wAAAGYAAABm////AP///wD///8AAAAAZgAAAGYAAABm////AP///wD///8A////AAAAAGYAAABmjl01/8GFVf/Zl2T/AAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AAAAAZgAAAGaOXTX/wYVV/9mXZP8AAABm////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZo5dNf/BhVX/AAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGb///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  item_honeypot: { w: 16, h: 16, rgba: "////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wAAAABm//8A////AP///wD//9YA///WAP//1gD//9YA/8GQQP/BkED/wZBA/wAAAGb///8A////AP///wAAAABmAAAAZppiMv/BkED//9YA///WAP//1gD/wZBA/8GQQP+aYjL/mmIy/5piMv8AAABmAAAAZv///wD///8AAAAAZsGQQP/UuUj/1LlI/8GQQP//1gD/wZBA/8GQQP/BkED/wZBA/8GQQP+aYjL/mmIy/wAAAGb///8A////AAAAAGbBkED/1LlI/8GQQP/BkED/wZBA/8GQQP/BkED/9sAA/8GQQP/BkED/mmIy/5piMv8AAABm////AP///wAAAABmwZBA/8GQQP/BkED/wZBA/8GQQP/BkED/7d7H/zcnC//t3sf/wZBA/5piMv+aYjL/AAAAZv///wD///8AAAAAZppiMv/BkED/wZBA/8GQQP/BkED/wZBA/8GQQP/2wAD/wZBA/5piMv+aYjL/mmIy/wAAAGb///8A////AAAAAGYAAABmmmIy/8GQQP/BkED/wZBA/8GQQP/BkED/wZBA/8GQQP+aYjL/mmIy/wAAAGYAAABm////AP///wD///8AAAAAZppiMv+aYjL/mmIy/8GQQP/BkED/wZBA/8GQQP+aYjL/mmIy/5piMv8AAABm////AP///wD///8A////AAAAAGYAAABmmmIy/5piMv+aYjL/mmIy/5piMv+aYjL/mmIy/5piMv8AAABmAAAAZv///wD///8A////AP///wD///8AAAAAZgAAAGaaYjL/mmIy/5piMv+aYjL/mmIy/5piMv8AAABmAAAAZv///wD///8A////AP///wD///8A////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZv///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AA==" },
  bufficon_mind_vision: { w: 7, h: 7, rgba: "uGK4/7hiuP+4Yrj/uGK4/7hiuP+4Yrj/uGK4/7hiuP/vk87//8Tl///E5f//xOX/75PO/7hiuP/vk87//8Tl/7hiuP/vk87/uGK4///E5f/vk87//8Tl/7hiuP+4Yrj//8Tl/7hiuP+4Yrj//8Tl/++Tzv//xOX/uGK4/++Tzv+4Yrj//8Tl/++Tzv+4Yrj/75PO///E5f//xOX//8Tl/++Tzv+4Yrj/uGK4/7hiuP+4Yrj/uGK4/7hiuP+4Yrj/uGK4/w==" },
  bufficon_levitation: { w: 7, h: 7, rgba: "ZtT//2bU//9m1P//ZtT//2bU//9m1P//ZtT//2bU//9m1P//ZtT//7Lp/////////////2bU//9m1P//ZtT//////////////////2bU//9m1P//ZtT///////////////////////9m1P//ZtT//2bU//////////////////+y6f//ZtT//2bU//9m1P//s+r/////////////ZtT//2bU//9m1P//ZtT//2bU//9m1P//ZtT//2bU//9m1P//ZtT//w==" },
  bufficon_fire: { w: 7, h: 7, rgba: "/yoA//8qAP//KgD//6oz//8qAP//KgD//yoA//8qAP//KgD///9m//8qAP//KgD//yoA//8qAP//KgD//yoA//8qAP///2b//6oz//8qAP//KgD//yoA//+qM////2b///9m////Zv//qjP//yoA//8qAP//qjP///9m////Zv///2b//9VN//8qAP//KgD//6oz////Zv///2b///9m//+qM///KgD//yoA//8qAP//qjP//6oz//+qM///KgD//yoA/w==" },
  bufficon_poison: { w: 7, h: 7, rgba: "ly+Z/5cvmf+XL5n/ly+Z/5cvmf+XL5n/ly+Z/5cvmf+XL5n/SxdM/0sXTP9LF0z/ly+Z/5cvmf+XL5n/AAAA/wAAAP8AAAD/AAAA/wAAAP+XL5n/ly+Z/wAAAP+XL5n/AAAA/5cvmf8AAAD/ly+Z/5cvmf8AAAD/AAAA/0wYTf8AAAD/AAAA/5cvmf+XL5n/TBhN/wAAAP8AAAD/AAAA/0wYTf+XL5n/ly+Z/5cvmf9MGE3/ly+Z/0wYTf+XL5n/ly+Z/w==" },
  bufficon_paralysis: { w: 7, h: 7, rgba: "/9tl///bZf//22X//9tl///bZf//22X//9tl///bZf+AbjP/AAAA/wAAAP8AAAD/gG4z///bZf//22X/AAAA///bZf//22X//9tl/wAAAP//22X/AAAA/wAAAP8AAAD//9tl/wAAAP8AAAD/AAAA///bZf8AAAD//9tl///bZf//22X/AAAA///bZf//22X/gG4z/wAAAP8AAAD/AAAA/4BuM///22X//9tl///bZf//22X//9tl///bZf//22X//9tl/w==" },
  bufficon_hunger: { w: 7, h: 7, rgba: "8nMY//JzGP/ycxj/8nMY//JzGP/ycxj/8nMY//JzGP/yoGb/8uTa/7Ooof/y5Nr/8qBm//JzGP/ycxj/8uTa//Lk2v+zqKH/8uTa//Lk2v/ycxj/8nMY/7Ooof+zqKH/s6ih/7Ooof+zqKH/8nMY//JzGP/y5Nr/8uTa/7Ooof/y5Nr/8uTa//JzGP/ycxj/8qBm//Lk2v+zqKH/8uTa//KgZv/ycxj/8nMY//JzGP/ycxj/8nMY//JzGP/ycxj/8nMY/w==" },
  bufficon_starvation: { w: 7, h: 7, rgba: "zAwM/8wMDP/MDAz/zAwM/8wMDP/MDAz/zAwM/8wMDP/eYlv/8uTa/7Ooof/y5Nr/3mJb/8wMDP/MDAz/8uTa//Lk2v+zqKH/8uTa//Lk2v/MDAz/zAwM/7Ooof+zqKH/s6ih/7Ooof+zqKH/zAwM/8wMDP/y5Nr/8uTa/7Ooof/y5Nr/8uTa/8wMDP/MDAz/3mJb//Lk2v+zqKH/8uTa/95iW//MDAz/zAwM/8wMDP/MDAz/zAwM/8wMDP/MDAz/zAwM/w==" },
  bufficon_slow: { w: 7, h: 7, rgba: "/1Uz//9VM///VTP//1Uz//9VM///VTP//1Uz//9VM/+yOyT/AAAA/wAAAP8AAAD/sjsk//9VM///VTP/AAAA//9VM/9/Khn//1Uz/wAAAP//VTP//1Uz/wAAAP//VTP/AAAA/7I7JP8AAAD//1Uz//9VM/8AAAD//1Uz//9VM///VTP/AAAA//9VM///VTP/sjsk/wAAAP8AAAD/AAAA/7I7JP//VTP//1Uz//9VM///VTP//1Uz//9VM///VTP//1Uz/w==" },
  bufficon_ooze: { w: 7, h: 7, rgba: "AIBW/wCAVv8AgFb/AIBW/wCAVv8AgFb/AIBW/wCAVv8AgFb/AIBW/wCAVv8AWTz/AFk8/wCAVv8AgFb/AIBW/wCAVv8AgFb/AAAA/wAAAP8AgFb/AIBW/wCAVv8AgFb/AAAA/wAAAP8AWTz/AIBW/wCAVv8AgFb/AAAA/wAAAP8AAAD/AIBW/wCAVv8AgFb/AAAA/wAAAP8AAAD/AAAA/wAAAP8AgFb/AIBW/wCAVv8AgFb/AIBW/wCAVv8AgFb/AIBW/w==" },
  bufficon_amok: { w: 7, h: 7, rgba: "AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD//xoa//8aGv+ADQ3/AAAA/wAAAP8AAAD/AAAA/wAAAP+ADQ3//xoa/wAAAP8AAAD/AAAA//8aGv//Ghr/AAAA/wAAAP//Ghr/AAAA/wAAAP8AAAD/AAAA//8aGv8AAAD/AAAA/wAAAP8AAAD//xoa/4ANDf8AAAD/gA0N/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/w==" },
  bufficon_terror: { w: 7, h: 7, rgba: "AAAA/wAAAP////////////////8AAAD/AAAA/wAAAP//////gICA//////+AgID//////wAAAP8AAAD//////wAAAP//////AAAA//////8AAAD/AAAA/wAAAP////////////////8AAAD/AAAA/wAAAP8AAAD//////wAAAP//////AAAA/wAAAP8AAAD/AAAA/4CAgP8AAAD/gICA/wAAAP8AAAD/AAAA/wAAAP8AAAD/gICA/wAAAP8AAAD/AAAA/w==" },
  bufficon_roots: { w: 7, h: 7, rgba: "M0wA/zNMAP8zTAD/M0wA/zNMAP8zTAD/M0wA/zNMAP8zTAD//3kZ//95Gf//eRn/M0wA/zNMAP8zTAD/M0wA//95Gf//eRn//3kZ/zNMAP8zTAD/M0wA/4VeCv//eRn//3kZ//95Gf+FXgr/M0wA/zNMAP//eRn//3kZ//95Gf//eRn//3kZ/zNMAP8zTAD//3kZ/4VeCv//eRn/hV4K//95Gf8zTAD/M0wA//95Gf8zTAD//3kZ/zNMAP//eRn/M0wA/w==" },
  bufficon_invisible: { w: 7, h: 7, rgba: "AFSm/wBUpv8AVKb/AFSm/wBUpv8AVKb/AFSm/wBUpv8AVKb/f6nS/3+p0v9/qdL/AFSm/wBUpv8AVKb/AFSm/3+p0v9/qdL/f6nS/wBUpv8AVKb/AFSm/wBUpv8AVKb/f6nS/wBUpv8AVKb/AFSm/wBUpv8AVKb/f6nS/3+p0v9/qdL/AFSm/wBUpv8AVKb/AFSm/3+p0v8AVKb/f6nS/wBUpv8AVKb/AFSm/wBUpv8AVKb/AFSm/wBUpv8AVKb/AFSm/w==" },
  bufficon_shadows: { w: 7, h: 7, rgba: "AFgm/wBYJv8AWCb/AFgm/wBYJv8AWCb/AFgm/wBYJv8AWCb/AFgm/wDlAP8AWCb/AFgm/wBYJv8AWCb/AFgm/wDlAP8A5QD/AOUA/wBYJv8AWCb/AFgm/wDlAP8A5QD/AOUA/wDlAP8A5QD/AFgm/wBYJv8A5QD/AOUA/wDlAP8A5QD/AOUA/wBYJv8AWCb/AK0P/wDlAP8A5QD/AOUA/wCtD/8AWCb/AFgm/wBYJv8AWCb/AOUA/wBYJv8AWCb/AFgm/w==" },
  bufficon_weakness: { w: 7, h: 7, rgba: "mZl6/5mZev+ZmXr/mZl6/5mZev+ZmXr/mZl6/5mZev+ZmXr/mZl6/5mZev+ZmXr/Khoz/5mZev+ZmXr/mZl6/5mZev+ZmXr/Khoz/yoaM/+ZmXr/mZl6/5mZev8qGjP/mZl6/yoaM/+ZmXr/mZl6/5mZev8qGjP/Khoz/5mZev+ZmXr/mZl6/5mZev+ZmXr/Khoz/5mZev+ZmXr/mZl6/5mZev+ZmXr/mZl6/5mZev+ZmXr/mZl6/5mZev+ZmXr/mZl6/w==" },
  bufficon_frost: { w: 7, h: 7, rgba: "/////////////////////////////////////////////////////1Z0uf//////////////////////VnS5//////9WdLn//////1Z0uf////////////////9WdLn/VnS5/1Z0uf////////////////9WdLn//////1Z0uf//////VnS5//////////////////////9WdLn//////////////////////////////////////////////////////w==" },
  bufficon_blindness: { w: 7, h: 7, rgba: "R2Sd/0dknf9HZJ3/R2Sd/0dknf9HZJ3/R2Sd/0dknf8nMoD/BgA7/wYAO/8GADv/JzKA/0dknf8nMoD/BgA7/wYAO/8nMoD/BgA7/wYAO/8nMoD/BgA7/wYAO/8GADv/R2Sd/wYAO/8GADv/BgA7/ycygP8GADv/BgA7/ycygP8GADv/BgA7/ycygP9HZJ3/JzKA/wYAO/8GADv/BgA7/ycygP9HZJ3/R2Sd/0dknf9HZJ3/R2Sd/0dknf9HZJ3/R2Sd/w==" },
  bufficon_combo: { w: 7, h: 7, rgba: "s7Oz/7Ozs/+zs7P/s7Oz/7Ozs/+zs7P/s7Oz/7Ozs/+zs7P/s7Oz/7Ozs/+zs7P/s7Oz/7Ozs/+zs7P/s7Oz/7Ozs/+zs7P/s7Oz/7Ozs/+zs7P/s7Oz/wAAAP+zs7P/AAAA/7Ozs/8AAAD/s7Oz/7Ozs/+zs7P/s7Oz/7Ozs/+zs7P/s7Oz/7Ozs/+zs7P/s7Oz/7Ozs/+zs7P/s7Oz/7Ozs/+zs7P/s7Oz/7Ozs/+zs7P/s7Oz/7Ozs/+zs7P/s7Oz/w==" },
  bufficon_fury: { w: 7, h: 7, rgba: "AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/4ANDf//Ghr//xoa//8aGv//Ghr//xoa/4ANDf+ADQ3/AAAA/wAAAP//Ghr/AAAA/wAAAP+ADQ3/gA0N//8aGv//Ghr//xoa//8aGv//Ghr/gA0N/wAAAP//Ghr/AAAA/wAAAP8AAAD//xoa/wAAAP8AAAD/gA0N//8aGv//Ghr//xoa/4ANDf8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/w==" },
  bufficon_healing: { w: 7, h: 7, rgba: "JLNi/ySzYv8ks2L/JLNi/ySzYv8ks2L/JLNi/ySzYv8ks2L/JLNi/5n/NP8ks2L/JLNi/ySzYv8ks2L/JLNi/ySzYv+Z/zT/JLNi/ySzYv8ks2L/JLNi/5n/NP+Z/zT/mf80/5n/NP+Z/zT/JLNi/ySzYv8ks2L/JLNi/5n/NP8ks2L/JLNi/ySzYv8ks2L/JLNi/ySzYv+Z/zT/JLNi/ySzYv8ks2L/JLNi/ySzYv8ks2L/JLNi/ySzYv8ks2L/JLNi/w==" },
  bufficon_armor: { w: 7, h: 7, rgba: "mY9c/5mPXP+Zj1z/mY9c/5mPXP+Zj1z/mY9c/5mPXP9NPS7/TT0u/009Lv9NPS7/TT0u/5mPXP+Zj1z/TT0u/009Lv9NPS7/TT0u/009Lv+Zj1z/mY9c/009Lv9NPS7/TT0u/009Lv9NPS7/mY9c/5mPXP+Zj1z/TT0u/009Lv9NPS7/mY9c/5mPXP+Zj1z/mY9c/5mPXP9NPS7/mY9c/5mPXP+Zj1z/mY9c/5mPXP+Zj1z/mY9c/5mPXP+Zj1z/mY9c/w==" },
  bufficon_heart: { w: 7, h: 7, rgba: "5hc5/+YXOf/mFzn/5hc5/+YXOf/mFzn/5hc5/+YXOf/zcov//8zd/+YXOf//zN3/83KL/+YXOf/mFzn//8zd///M3f//zN3//8zd///M3f/mFzn/5hc5///M3f//zN3//8zd///M3f//zN3/5hc5/+YXOf/mFzn//8zd///M3f//zN3/5hc5/+YXOf/mFzn/5hc5/+YXOf//zN3/5hc5/+YXOf/mFzn/5hc5/+YXOf/mFzn/5hc5/+YXOf/mFzn/5hc5/w==" },
  bufficon_light: { w: 7, h: 7, rgba: "ACFX/wAhV/8AIVf/ACFX/wAhV/8AIVf/ACFX/wAhV/8AIVf/zNMR/8zTEf/M0xH/ACFX/wAhV/8AIVf/zNMR////AP////////8A/8zTEf8AIVf/ACFX/8zTEf/////////////////M0xH/ACFX/wAhV//M0xH///8A/////////wD/zNMR/wAhV/8AIVf/ACFX/8zTEf/M0xH/zNMR/wAhV/8AIVf/ACFX/wAhV/8AIVf/ACFX/wAhV/8AIVf/ACFX/w==" },
  bufficon_cripple: { w: 7, h: 7, rgba: "ly+Z/5cvmf+XL5n/ly+Z/5cvmf+XL5n/ly+Z/5cvmf+3kUf/zNMR/8zTEf+3kUf/ly+Z/5cvmf+XL5n/zNMR/5cvmf+XL5n/zNMR/5cvmf+XL5n/ly+Z/5cvmf+scWP/zNMR/7eRR/+XL5n/ly+Z/5cvmf+XL5n/zNMR/5cvmf+XL5n/ly+Z/5cvmf+XL5n/ly+Z/7eRR//M0xH/zNMR/8zTEf+XL5n/ly+Z/5cvmf+XL5n/ly+Z/5cvmf+XL5n/ly+Z/w==" },
  bufficon_barkskin: { w: 7, h: 7, rgba: "AFgm/wBYJv8AWCb/AFgm/wBYJv8AWCb/AFgm/wBYJv9NPS7/AFgm/009Lv8AWCb/TT0u/wBYJv8AWCb/mY9c/wBYJv+Zj1z/AFgm/5mPXP8AWCb/AFgm/5mPXP8AWCb/mY9c/wBYJv+Zj1z/AFgm/wBYJv+Zj1z/mY9c/5mPXP+Zj1z/mY9c/wBYJv8AWCb/AFgm/5mPXP+Zj1z/mY9c/wBYJv8AWCb/AFgm/wBYJv+Zj1z/mY9c/5mPXP8AWCb/AFgm/w==" },
  bufficon_immunity: { w: 7, h: 7, rgba: "5c9c/+XPXP/lz1z/5c9c/+XPXP/lz1z/5c9c/+XPXP8zTAD/M0wA/zNMAP8zTAD/M0wA/+XPXP/lz1z/M0wA/+XPXP8zTAD/5c9c/zNMAP/lz1z/5c9c/zNMAP8zTAD/M0wA/zNMAP8zTAD/5c9c/+XPXP/lz1z/5c9c/zNMAP/lz1z/5c9c/+XPXP/lz1z/5c9c/zNMAP8zTAD/M0wA/+XPXP/lz1z/5c9c/+XPXP/lz1z/5c9c/+XPXP/lz1z/5c9c/w==" },
  bufficon_bleeding: { w: 7, h: 7, rgba: "TTYf/002H/9NNh//TTYf/002H/9NNh//TTYf/002H/9NNh//TTYf/8wAAP9NNh//TTYf/002H/9NNh//TTYf/8wAAP/MAAD/zAAA/002H/9NNh//TTYf/8wAAP/MAAD/zAAA/8wAAP/MAAD/TTYf/002H//MAAD/zAAA/8wAAP/MAAD/zAAA/002H/9NNh//TTYf/8wAAP/MAAD/zAAA/002H/9NNh//TTYf/002H/9NNh//TTYf/002H/9NNh//TTYf/w==" },
  bufficon_mark: { w: 7, h: 7, rgba: "AAAA/wAAAP8AAAD//zMz/wAAAP8AAAD/AAAA/wAAAP8AAAD/UlJS//8zM/9SUlL/AAAA/wAAAP8AAAD/UlJS/8zMzP/MzMz/zMzM/1JSUv8AAAD//zMz//8zM//MzMz//zMz/8zMzP//MzP//zMz/wAAAP9SUlL/zMzM/8zMzP/MzMz/UlJS/wAAAP8AAAD/AAAA/1JSUv//MzP/UlJS/wAAAP8AAAD/AAAA/wAAAP8AAAD//zMz/wAAAP8AAAD/AAAA/w==" },
  bufficon_deferred: { w: 7, h: 7, rgba: "PUVN/z1FTf89RU3/PUVN/z1FTf89RU3/PUVN/z1FTf94PTb//yoA//8qAP//KgD/eD02/z1FTf89RU3//yoA/z1FTf//KgD//yoA//8qAP89RU3/PUVN//8qAP89RU3//yoA//8qAP//KgD/PUVN/z1FTf//KgD/PUVN/z1FTf89RU3//yoA/z1FTf89RU3/eD02//8qAP//KgD//yoA/3g9Nv89RU3/PUVN/z1FTf89RU3/PUVN/z1FTf89RU3/PUVN/w==" },
  bufficon_vertigo: { w: 7, h: 7, rgba: "/////////////////////wAAAP/MzMz//////8zMzP8AAAD/AAAA/8zMzP//////AAAA//////8AAAD///////////8AAAD//////wAAAP///////////8zMzP8AAAD/AAAA/wAAAP/MzMz///////////8AAAD//////wAAAP///////////wAAAP//////AAAA///////MzMz/AAAA/wAAAP/MzMz//////8zMzP8AAAD//////////////////////w==" },
  bufficon_rage: { w: 7, h: 7, rgba: "AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP+AVQD//6oA//+qAP//qgD/gFUA/wAAAP+AVQD//6oA//8aGv//Yg3//xoa//+qAP+AVQD//6oA//8aGv//Ghr//6oA//8aGv//Ghr//6oA/4BVAP//qgD//xoa//9iDf//Ghr//6oA/4BVAP8AAAD/gFUA//+qAP//qgD//6oA/4BVAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/w==" },
  bufficon_sacrifice: { w: 7, h: 7, rgba: "IkRm/yJEZv8iRGb/RIju/yJEZv8iRGb/IkRm/yJEZv8iRGb/u8z//yJEZv8iRGb/IkRm/yJEZv8iRGb/IkRm/yJEZv+7zP//RIju/yJEZv8iRGb/IkRm/0SI7v+7zP//u8z//7vM//9EiO7/IkRm/yJEZv9EiO7/u8z//7vM//+7zP//u8z//yJEZv8iRGb/RIju/7vM//+7zP//u8z//0SI7v8iRGb/IkRm/yJEZv9EiO7/RIju/0SI7v8iRGb/IkRm/w==" }
};

// src/mechanics/buffs.ts
var BURNING_DURATION = 8;
var POISON_TRAP_BASE = 4;
var PARALYSIS_DURATION = 10;
var CRIPPLE_DURATION = 10;
var OOZE_DAMAGE = 1;
function burningTick(rng, hp, ht, left, inWater, flying) {
  const damage = rng.int(1, 5);
  const nextLeft = left - 1;
  const extinguished = rng.float(0, 1) > (2 + hp / ht) / 3 || inWater && !flying;
  const detached = nextLeft <= 0 || extinguished;
  return { damage, left: nextLeft, detached };
}
function poisonTick(left) {
  const damage = Math.floor(left / 3) + 1;
  const nextLeft = left - 1;
  return { damage, left: nextLeft, detached: nextLeft <= 0 };
}
function poisonTrapDuration(depth) {
  return POISON_TRAP_BASE + Math.floor(depth / 2);
}
function bleedingTick(rng, level) {
  const next = rng.int(Math.floor(level / 2), level);
  return { level: next, detached: next <= 0 };
}
function oozeTick(inWater) {
  return { damage: OOZE_DAMAGE, detached: inWater };
}
var MSG_BURNS_UP = "%s burns up!";
var MSG_BURNED_TO_DEATH = "You burned to death...";
var MSG_DIED_FROM_POISON = "You died from poison...";
var MSG_OOZE_KILLED = "Caustic ooze killed you...";
var MSG_BLED_TO_DEATH = "You bled to death...";
var MSG_STARVED_TO_DEATH = "You starved to death...";
var MSG_HUNGRY = "You are hungry.";
var MSG_STARVING = "You are starving!";
var DEATH_MESSAGE_RE = /you burned to death\.\.\.|you died from poison\.\.\.|caustic ooze killed you\.\.\.|you bled to death\.\.\.|you starved to death\.\.\.|you died from a toxic gas\.\.|you fell to death\.\.\./i;
function buffDeathMessage(kind) {
  switch (kind) {
    case "burning":
      return MSG_BURNED_TO_DEATH;
    case "poison":
      return MSG_DIED_FROM_POISON;
    case "ooze":
      return MSG_OOZE_KILLED;
    case "bleeding":
      return MSG_BLED_TO_DEATH;
    case "hunger":
      return MSG_STARVED_TO_DEATH;
    default:
      return null;
  }
}
function burnsUpMessage(itemName) {
  return MSG_BURNS_UP.replace("%s", itemName);
}
function burningInventoryTick(rng, stacks, isScroll, isMysteryMeat) {
  let total = 0;
  for (const s of stacks)
    total += Math.max(0, s.qty);
  if (total <= 0)
    return null;
  let pick = rng.int(0, total);
  for (let i = 0;i < stacks.length; i++) {
    pick -= Math.max(0, stacks[i].qty);
    if (pick < 0) {
      const itemId = stacks[i].itemId;
      if (isScroll(itemId))
        return { stackIndex: i, cookedId: null };
      if (isMysteryMeat(itemId))
        return { stackIndex: i, cookedId: "chargrilled_meat" };
      return null;
    }
  }
  return null;
}

// src/mechanics/blobs.ts
function isSolidForBlob(t) {
  return t === 0 /* WALL */ || t === 2 /* DOOR */ || t === 3 /* DOOR_LOCKED */ || t === 4 /* DOOR_SECRET */ || t === 37 /* BARRICADE */ || t === 15 /* STATUE */ || t === 17 /* BOOKSHELF */ || t === 5 /* EXIT_LOCKED */;
}
function isFlamableForBlob(t) {
  return t === 10 /* GRASS */ || t === 39 /* HIGH_GRASS */ || t === 2 /* DOOR */ || t === 37 /* BARRICADE */ || t === 17 /* BOOKSHELF */;
}

class Blob {
  kind;
  cur;
  off;
  volume = 0;
  constructor(kind, length) {
    this.kind = kind;
    this.cur = new Int32Array(length);
    this.off = new Int32Array(length);
  }
  act(rng, world) {
    if (this.volume > 0) {
      this.volume = 0;
      this.evolve(rng, world);
      const tmp = this.off;
      this.off = this.cur;
      this.cur = tmp;
    }
  }
  evolve(_rng, world) {
    const { w } = world;
    const h = world.length / w;
    const { cur, off } = this;
    for (let y = 1;y < h - 1; y++) {
      const from = y * w + 1;
      const to = from + w - 2;
      for (let pos = from;pos < to; pos++) {
        if (!world.solidAt(pos)) {
          let count = 1;
          let sum = cur[pos];
          if (!world.solidAt(pos - 1)) {
            sum += cur[pos - 1];
            count++;
          }
          if (!world.solidAt(pos + 1)) {
            sum += cur[pos + 1];
            count++;
          }
          if (!world.solidAt(pos - w)) {
            sum += cur[pos - w];
            count++;
          }
          if (!world.solidAt(pos + w)) {
            sum += cur[pos + w];
            count++;
          }
          const value = sum >= count ? Math.floor(sum / count) - 1 : 0;
          off[pos] = value;
          this.volume += value;
        } else {
          off[pos] = 0;
        }
      }
    }
  }
  seed(cell, amount) {
    this.cur[cell] += amount;
    this.volume += amount;
  }
  clear(cell) {
    this.volume -= this.cur[cell];
    this.cur[cell] = 0;
  }
}

class FireBlob extends Blob {
  constructor(length) {
    super("fire", length);
  }
  evolve(_rng, world) {
    const { w, length } = world;
    const { cur, off } = this;
    const from = w + 1;
    const to = length - w - 1;
    let observe = false;
    for (let pos = from;pos < to; pos++) {
      let fire;
      if (cur[pos] > 0) {
        this.burn(world, pos);
        fire = cur[pos] - 1;
        if (fire <= 0 && world.flamableAt(pos)) {
          world.burnOutTile(pos);
          observe = true;
        }
      } else {
        if (world.flamableAt(pos) && (cur[pos - 1] > 0 || cur[pos + 1] > 0 || cur[pos - w] > 0 || cur[pos + w] > 0)) {
          fire = 4;
          this.burn(world, pos);
        } else {
          fire = 0;
        }
      }
      this.volume += off[pos] = fire;
    }
  }
  burn(world, pos) {
    const ch = world.charAt(pos);
    if (ch !== null) {
      world.reigniteBurning(ch);
    }
  }
  seed(cell, amount) {
    if (this.cur[cell] === 0) {
      this.volume += amount;
      this.cur[cell] = amount;
    }
  }
}
var TOXIC_GAS_DEATH_MESSAGE = "You died from a toxic gas..";

class ToxicGasBlob extends Blob {
  constructor(length) {
    super("toxic", length);
  }
  evolve(rng, world) {
    super.evolve(rng, world);
    const levelDamage = 5 + world.depth * 5;
    for (let i = 0;i < world.length; i++) {
      if (this.cur[i] > 0) {
        const ch = world.charAt(i);
        if (ch !== null) {
          let damage = Math.floor((ch.ht + levelDamage) / 40);
          if (rng.int(0, 40) < (ch.ht + levelDamage) % 40) {
            damage++;
          }
          world.damageChar(rng, ch, damage, "toxic_gas", (dead) => {
            world.log(TOXIC_GAS_DEATH_MESSAGE);
          });
        }
      }
    }
    const par = world.blobs.find((b) => b.kind === "paralytic");
    if (par != null) {
      const parCur = par.cur;
      for (let i = 0;i < world.length; i++) {
        const t = this.cur[i];
        const p = parCur[i];
        if (p >= t) {
          this.volume -= t;
          this.cur[i] = 0;
        } else {
          par.volume -= p;
          parCur[i] = 0;
        }
      }
    }
  }
}

class ParalyticGasBlob extends Blob {
  constructor(length) {
    super("paralytic", length);
  }
  evolve(_rng, world) {
    super.evolve(_rng, world);
    for (let i = 0;i < world.length; i++) {
      if (this.cur[i] > 0) {
        const ch = world.charAt(i);
        if (ch !== null) {
          world.prolongParalysis(ch, PARALYSIS_DURATION);
        }
      }
    }
  }
}

class WebBlob extends Blob {
  constructor(length) {
    super("web", length);
  }
  evolve(_rng, world) {
    for (let i = 0;i < world.length; i++) {
      const offv = this.cur[i] > 0 ? this.cur[i] - 1 : 0;
      this.off[i] = offv;
      if (offv > 0) {
        this.volume += offv;
        const ch = world.charAt(i);
        if (ch !== null) {
          world.prolongRoots(ch);
        }
      }
    }
  }
  seed(cell, amount) {
    const diff = amount - this.cur[cell];
    if (diff > 0) {
      this.cur[cell] = amount;
      this.volume += diff;
    }
  }
}
function createBlob(kind, length) {
  switch (kind) {
    case "fire":
      return new FireBlob(length);
    case "toxic":
      return new ToxicGasBlob(length);
    case "paralytic":
      return new ParalyticGasBlob(length);
    case "web":
      return new WebBlob(length);
  }
}
function blobOf(blobs, kind) {
  return blobs.find((b) => b.kind === kind);
}
function seedBlob(blobs, kind, cell, amount, length) {
  let blob = blobOf(blobs, kind);
  if (!blob) {
    blob = createBlob(kind, length);
    blobs.push(blob);
  }
  blob.seed(cell, amount);
  return blob;
}
function tickBlobs(rng, world, blobs) {
  for (const blob of blobs) {
    blob.act(rng, world);
  }
}

// src/mechanics/goo.ts
var GOO_HT = 80;
var GOO_EXP = 10;
var GOO_DEFENSE = 12;
var GOO_DR = 2;
var GOO_ATTACK = 15;
var GOO_ATTACK_PUMPED = 30;
var GOO_DMG_MIN = 2;
var GOO_DMG_MAX = 12;
var GOO_DMG_PUMPED_MIN = 5;
var GOO_DMG_PUMPED_MAX = 30;
var GOO_MAX_LVL = 30;
var PUMP_UP_DELAY = 2;
var GOO_PUMP_CHANCE = 1 / 3;
var GOO_OOZE_CHANCE = 1 / 3;
var GOO_RESISTANCES = ["toxic_gas", "death", "psionic_blast"];
function gooDamageRoll(rng, pumpedUp) {
  return pumpedUp ? rng.normalIntRange(GOO_DMG_PUMPED_MIN, GOO_DMG_PUMPED_MAX) : rng.normalIntRange(GOO_DMG_MIN, GOO_DMG_MAX);
}
function gooAttackSkill(pumpedUp, jumped) {
  return pumpedUp && !jumped ? GOO_ATTACK_PUMPED : GOO_ATTACK;
}
function gooCanAttack(pumpedUp, dist) {
  return pumpedUp ? dist <= 2 : dist <= 1;
}
function gooDecide(rng, state, ctx) {
  if (state.pumpedUp) {
    if (ctx.dist <= 1) {
      return { kind: "pumpedAttack" };
    }
    if (ctx.jumpPathClear && ctx.dist <= 2) {
      return { kind: "jumpAttack" };
    }
    return { kind: "pumpFizzle" };
  }
  return rng.int(0, 3) > 0 ? { kind: "attack" } : { kind: "pump" };
}
function gooAfterAttack(state, action) {
  switch (action.kind) {
    case "attack":
      return { ...state, pumpedUp: false };
    case "pumpedAttack":
      return { ...state, pumpedUp: false, jumped: false };
    case "pump":
      return { ...state, pumpedUp: true };
    case "jumpAttack":
      return { ...state, pumpedUp: false, jumped: true };
    case "pumpFizzle":
      return { ...state, pumpedUp: false };
  }
}
function gooAfterMove(state) {
  return { ...state, pumpedUp: false };
}
function gooOozeRoll(rng) {
  return rng.int(0, 3) === 0;
}
function gooWaterRegen(hp, inWater) {
  return inWater && hp < GOO_HT ? hp + 1 : hp;
}

// src/mechanics/char.ts
function strEff(hero) {
  return hero.weakened ? hero.str - 2 : hero.str;
}
function hasBuff(ch, kind) {
  return ch.buffs[kind] !== undefined;
}
function charTimeScale(ch) {
  let timeScale = 1;
  if (hasBuff(ch, "slow")) {
    timeScale *= 0.5;
  }
  if (hasBuff(ch, "speed")) {
    timeScale *= 2;
  }
  return timeScale;
}
function crippleFactor(ch) {
  return hasBuff(ch, "cripple") ? 0.5 : 1;
}
function charSpeed(ch) {
  return crippleFactor(ch);
}

// src/mechanics/durability.ts
var DURABILITY_WARNING_LEVEL = 1 / 6;
var TXT_GOING_TO_BREAK = "Because of frequent use, your %s is going to break soon.";
var TXT_HAS_BROKEN = "Because of frequent use, your %s has broken.";
var TXT_INCOMPATIBLE_WEAPON = "Interaction of different types of magic has negated the enchantment on this weapon!";
var TXT_INCOMPATIBLE_ARMOR = "Interaction of different types of magic has erased the glyph on this armor!";
var TXT_EQUIP_CURSED_WEAPON = "you wince as your grip involuntarily tightens around your %s";
var TXT_EQUIP_CURSED_ARMOR = "your %s constricts around you painfully";
var TXT_UNEQUIP_CURSED = "You can't remove cursed %s!";
function maxDurability(kind, level) {
  const lvl = level < 0 ? 0 : level;
  return (kind === "weapon" ? 5 : 6) * (lvl < 16 ? 16 - lvl : 1);
}
function initDurability(item, kind) {
  if (item.durability === undefined) {
    item.durability = maxDurability(kind, item.level);
  }
}
function isBroken(item) {
  return (item.durability ?? 1) <= 0;
}
function effectiveLevel(item) {
  return isBroken(item) ? 0 : item.level;
}
function fixDurability(item, kind) {
  item.durability = maxDurability(kind, item.level);
}
function polish(item, kind) {
  initDurability(item, kind);
  const max = maxDurability(kind, item.level);
  if (item.durability < max) {
    item.durability = item.durability + 1;
  }
}
function useDurability(item, kind, levelKnown) {
  initDurability(item, kind);
  if (item.level <= 0 || isBroken(item)) {
    return { warned: false, broke: false };
  }
  const threshold = Math.floor(maxDurability(kind, item.level) * DURABILITY_WARNING_LEVEL);
  const before = item.durability;
  item.durability = Math.max(0, before - 1);
  return {
    warned: levelKnown && before >= threshold && item.durability < threshold,
    broke: isBroken(item)
  };
}
function upgradeItem(item, kind) {
  item.cursed = false;
  item.cursedKnown = true;
  item.level += 1;
  fixDurability(item, kind);
}
function upgradeErasesMagic(rng, preUpgradeLevel, inscribe, hasMagic) {
  if (!hasMagic || inscribe) {
    return false;
  }
  return rng.int(0, preUpgradeLevel) > 0;
}
function eraseWeaponMagic(weapon, rng, preserve, log) {
  if (weapon.enchantment && upgradeErasesMagic(rng, weapon.level, preserve, true)) {
    weapon.enchantment = null;
    log(TXT_INCOMPATIBLE_WEAPON);
  }
}
function eraseArmorMagic(armor, rng, preserve, log) {
  if (armor.glyph && upgradeErasesMagic(rng, armor.level, preserve, true)) {
    armor.glyph = null;
    log(TXT_INCOMPATIBLE_ARMOR);
  }
}

// src/mechanics/hero.ts
var DART = {
  name: "dart",
  tier: 1,
  level: 0,
  min: 1,
  max: 4,
  str: 10,
  acu: 1,
  dly: 1,
  missile: true
};
function accuracyFactor(weapon, heroStr, heroClass = "warrior") {
  let encumbrance = weapon.str - heroStr;
  if (weapon.missile) {
    if (heroClass === "warrior")
      encumbrance += 3;
  }
  return encumbrance > 0 ? weapon.acu / Math.pow(1.5, encumbrance) : weapon.acu;
}
function heroAttackSkill(hero, opts) {
  let accuracy = 1;
  if (opts.ranged && opts.adjacent)
    accuracy *= 0.5;
  accuracy *= accuracyMultiplier(opts.accuracyBonus ?? 0);
  const wep = opts.ranged ? hero.rangedWeapon ?? DART : hero.weapon;
  if (wep) {
    return Math.floor(hero.attackSkill * accuracy * accuracyFactor(wep, strEff(hero)));
  }
  return Math.floor(hero.attackSkill * accuracy);
}
function accuracyMultiplier(bonus) {
  return bonus === 0 ? 1 : Math.pow(1.4, bonus);
}
function evasionMultiplier(bonus) {
  return bonus === 0 ? 1 : Math.pow(1.2, bonus);
}
function heroDefenseSkill(hero, opts = {}) {
  let evasion = evasionMultiplier(opts.evasionBonus ?? 0);
  if (hero.paralysed)
    evasion /= 2;
  const aEnc = hero.armor ? hero.armor.str - strEff(hero) : 0;
  if (aEnc > 0) {
    return Math.floor(hero.defenseSkill * evasion / Math.pow(1.5, aEnc));
  }
  return Math.floor(hero.defenseSkill * evasion);
}
function heroDR(hero) {
  return hero.armor ? Math.max(hero.armor.dr + hero.armor.level, 0) : 0;
}
function weaponDamageRoll(rng, weapon, opts) {
  let damage = rng.normalIntRange(weapon.min + weapon.level, weapon.max + weapon.level * weapon.tier);
  const isHuntress = opts.heroClass === "huntress";
  if (opts.ranged === isHuntress) {
    const exStr = opts.str - weapon.str;
    if (exStr > 0)
      damage += rng.intRange(0, exStr);
  }
  return damage;
}
function heroDamageRoll(rng, hero, opts) {
  const wep = opts.ranged ? hero.rangedWeapon ?? DART : hero.weapon;
  if (wep) {
    return weaponDamageRoll(rng, wep, { str: strEff(hero), ranged: opts.ranged });
  }
  const s = strEff(hero);
  return s > 10 ? rng.intRange(1, s - 9) : 1;
}
function upgradeWeapon(weapon, rng, opts = {}) {
  eraseWeaponMagic(weapon, rng, opts.preserveEnchant ?? false, opts.log ?? (() => {
    return;
  }));
  upgradeItem(weapon, "weapon");
}
function upgradeArmor(armor, rng, opts = {}) {
  eraseArmorMagic(armor, rng, opts.preserveGlyph ?? false, opts.log ?? (() => {
    return;
  }));
  armor.str -= 1;
  upgradeItem(armor, "armor");
}
function gearDisplayName(def) {
  return def.level > 0 ? `${def.name} +${def.level}` : def.name;
}
function updateAwareness(lvl, rogue) {
  return 1 - Math.pow(rogue ? 0.85 : 0.9, (1 + Math.min(lvl, 9)) * 0.5);
}
function heroSpeed(hero) {
  const base = charSpeed(hero);
  const aEnc = hero.armor ? hero.armor.str - strEff(hero) : 0;
  return aEnc > 0 ? base * Math.pow(1.3, -aEnc) : base;
}
function intentionalSearchLevel(awareness) {
  return 2 * awareness - awareness * awareness;
}
function passiveSearchLevel(awareness) {
  return awareness;
}
function searchTimeCost(rng, found, level) {
  if (!found) {
    return 2;
  }
  return rng.float(0, 1) < level ? 2 : 4;
}
function vertigoRedirect(rng, pos, width, blocked) {
  const dx = [1, -1, 0, 0, 1, 1, -1, -1];
  const dy = [0, 0, 1, -1, 1, -1, 1, -1];
  const i = rng.int(0, 8);
  const step = pos + dx[i] + dy[i] * width;
  if (step < 0 || blocked(step)) {
    return null;
  }
  return step;
}

// src/mechanics/exp.ts
function maxExp(lvl) {
  return 5 + lvl * 5;
}
function earnExp(state, amount) {
  state.exp += amount;
  let gained = 0;
  while (state.exp >= maxExp(state.lvl)) {
    state.exp -= maxExp(state.lvl);
    state.lvl++;
    state.ht += 5;
    state.hp += 5;
    state.attackSkill++;
    state.defenseSkill++;
    if (state.lvl < 10) {
      state.awareness = updateAwareness(state.lvl, false);
    }
    gained++;
  }
  return gained;
}
var MOB_EXP = {
  rat: { exp: 1, maxLvl: 5 },
  gnoll: { exp: 2, maxLvl: 8 },
  crab: { exp: 3, maxLvl: 9 },
  swarm: { exp: 1, maxLvl: 10 },
  skeleton: { exp: 5, maxLvl: 10 },
  thief: { exp: 5, maxLvl: 10 },
  goo: { exp: GOO_EXP, maxLvl: GOO_MAX_LVL },
  shaman: { exp: 6, maxLvl: 14 },
  bat: { exp: 7, maxLvl: 15 },
  brute: { exp: 8, maxLvl: 15 },
  tengu: { exp: 20, maxLvl: 30 },
  albino: { exp: 1, maxLvl: 5 },
  fetidrat: { exp: 3, maxLvl: 5 },
  curse: { exp: 3, maxLvl: 5 },
  bandit: { exp: 5, maxLvl: 10 },
  shielded: { exp: 8, maxLvl: 15 },
  spinner: { exp: 9, maxLvl: 16 },
  elemental: { exp: 10, maxLvl: 20 },
  monk: { exp: 11, maxLvl: 21 },
  dm300: { exp: 30, maxLvl: 30 }
};
function expForKill(mobId, heroLvl) {
  const m = MOB_EXP[mobId];
  if (!m)
    return 0;
  return heroLvl <= m.maxLvl ? m.exp : 0;
}

// src/content/identification.ts
class ItemStatusHandler {
  classes;
  images = new Map;
  labels = new Map;
  knownSet = new Set;
  constructor(classes, labels, images, rng) {
    this.classes = [...classes];
    const labelPool = [...labels];
    const imagePool = [...images];
    for (const cls of classes) {
      const index = rng.int(0, labelPool.length);
      this.labels.set(cls, labelPool[index]);
      this.images.set(cls, imagePool[index]);
      labelPool.splice(index, 1);
      imagePool.splice(index, 1);
    }
  }
  image(cls) {
    const img = this.images.get(cls);
    if (img === undefined)
      throw new Error(`unknown class ${cls}`);
    return img;
  }
  label(cls) {
    const lbl = this.labels.get(cls);
    if (lbl === undefined)
      throw new Error(`unknown class ${cls}`);
    return lbl;
  }
  isKnown(cls) {
    return this.knownSet.has(cls);
  }
  know(cls) {
    if (!this.classes.includes(cls))
      return;
    this.knownSet.add(cls);
    if (this.knownSet.size === this.classes.length - 1) {
      for (const c of this.classes) {
        if (!this.knownSet.has(c)) {
          this.knownSet.add(c);
          break;
        }
      }
    }
  }
  known() {
    return this.classes.filter((c) => this.knownSet.has(c));
  }
  unknown() {
    return this.classes.filter((c) => !this.knownSet.has(c));
  }
  all() {
    return [...this.classes];
  }
  save() {
    const out = {};
    for (const cls of this.classes) {
      out[cls] = {
        image: this.images.get(cls),
        label: this.labels.get(cls),
        known: this.knownSet.has(cls)
      };
    }
    return out;
  }
  restore(data, labels, images, rng) {
    this.images.clear();
    this.labels.clear();
    this.knownSet.clear();
    const labelPool = [...labels];
    const imagePool = [...images];
    for (const cls of this.classes) {
      const stored = data[cls];
      if (stored) {
        this.images.set(cls, stored.image);
        this.labels.set(cls, stored.label);
        const li = labelPool.indexOf(stored.label);
        if (li >= 0)
          labelPool.splice(li, 1);
        const ii = imagePool.indexOf(stored.image);
        if (ii >= 0)
          imagePool.splice(ii, 1);
        if (stored.known)
          this.knownSet.add(cls);
      }
    }
    for (const cls of this.classes) {
      if (!this.images.has(cls) && labelPool.length > 0) {
        const index = rng.int(0, labelPool.length);
        this.labels.set(cls, labelPool[index]);
        this.images.set(cls, imagePool[index]);
        labelPool.splice(index, 1);
        imagePool.splice(index, 1);
      }
    }
  }
}
var potionHandler = null;
var scrollHandler = null;
var wandHandler = null;
var wandDef = null;
var ringDef = null;
function registerWandClasses(def) {
  wandDef = def;
}
function registerRingClasses(def) {
  ringDef = def;
}
function identificationReady() {
  return potionHandler !== null && scrollHandler !== null;
}
function need(h, what) {
  if (!h)
    throw new Error(`identification not initialized (${what})`);
  return h;
}
function potionLabel(id) {
  return need(potionHandler, "potions").label(id);
}
function potionImage(id) {
  return need(potionHandler, "potions").image(id);
}
function isPotionKnown(id) {
  return need(potionHandler, "potions").isKnown(id);
}
function knowPotion(id) {
  need(potionHandler, "potions").know(id);
}
function scrollRune(id) {
  return need(scrollHandler, "scrolls").label(id);
}
function scrollImage(id) {
  return need(scrollHandler, "scrolls").image(id);
}
function isScrollKnown(id) {
  return need(scrollHandler, "scrolls").isKnown(id);
}
function knowScroll(id) {
  need(scrollHandler, "scrolls").know(id);
}
function wandLabel(id) {
  return need(wandHandler, "wands").label(id);
}
function wandImage(id) {
  return need(wandHandler, "wands").image(id);
}
function isWandKnown(id) {
  return need(wandHandler, "wands").isKnown(id);
}
function isWandRegistered() {
  return wandHandler !== null;
}
function knowWand(id) {
  need(wandHandler, "wands").know(id);
}

// src/core/turn.ts
var TICK = 1;

class Actor {
  static TICK = TICK;
  time = 0;
  getSpeed() {
    return 1;
  }
  getTimeScale() {
    return 1;
  }
}

class Scheduler {
  heap = [];
  seq = 0;
  order = new Map;
  now = 0;
  get count() {
    return this.heap.length;
  }
  add(a) {
    if (this.order.has(a))
      return;
    this.order.set(a, this.seq++);
    this.push(a);
  }
  remove(a) {
    if (!this.order.has(a))
      return;
    this.order.delete(a);
    const i = this.heap.indexOf(a);
    if (i >= 0) {
      const last = this.heap.pop();
      if (i < this.heap.length) {
        this.heap[i] = last;
        this.bubbleDown(i);
        this.bubbleUp(i);
      }
    }
  }
  contains(a) {
    return this.order.has(a);
  }
  clear() {
    this.heap = [];
    this.order.clear();
    this.seq = 0;
    this.now = 0;
  }
  peek() {
    return this.heap[0];
  }
  next() {
    const m = this.pop();
    if (!m)
      throw new Error("Scheduler: no actors");
    this.order.delete(m);
    this.now = m.time;
    return m;
  }
  spend(taker, cost) {
    const timeScale = taker.getTimeScale?.() ?? 1;
    taker.time = this.now + cost / Math.max(0.01, taker.getSpeed()) / timeScale;
    this.add(taker);
  }
  less(a, b) {
    if (a.time !== b.time)
      return a.time < b.time;
    return (this.order.get(a) ?? 0) < (this.order.get(b) ?? 0);
  }
  push(a) {
    this.heap.push(a);
    this.bubbleUp(this.heap.length - 1);
  }
  pop() {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (top !== undefined && last !== undefined && this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }
  bubbleUp(i) {
    while (i > 0) {
      const p = i - 1 >> 1;
      if (!this.less(this.heap[i], this.heap[p]))
        break;
      [this.heap[i], this.heap[p]] = [this.heap[p], this.heap[i]];
      i = p;
    }
  }
  bubbleDown(i) {
    for (;; ) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < this.heap.length && this.less(this.heap[l], this.heap[m]))
        m = l;
      if (r < this.heap.length && this.less(this.heap[r], this.heap[m]))
        m = r;
      if (m === i)
        break;
      [this.heap[i], this.heap[m]] = [this.heap[m], this.heap[i]];
      i = m;
    }
  }
}

// src/mechanics/wands.ts
var WAND_SPECS = [
  {
    id: "teleportation",
    className: "WandOfTeleportation",
    name: "Wand of Teleportation",
    desc: "A blast from this wand will teleport a creature against " + "its will to a random place on the current level.",
    wood: "holly",
    sprite: "item_wand_teleportation",
    initialCharges: 2,
    hitChars: true
  },
  {
    id: "slowness",
    className: "WandOfSlowness",
    name: "Wand of Slowness",
    desc: "This wand will cause a creature to move and attack " + "at half its ordinary speed until the effect ends",
    wood: "yew",
    sprite: "item_wand_slowness",
    initialCharges: 2,
    hitChars: true
  },
  {
    id: "firebolt",
    className: "WandOfFirebolt",
    name: "Wand of Firebolt",
    desc: "This wand unleashes bursts of magical fire. It will ignite " + "flammable terrain, and will damage and burn a creature it hits.",
    wood: "ebony",
    sprite: "item_wand_firebolt",
    initialCharges: 2,
    hitChars: true
  },
  {
    id: "poison",
    className: "WandOfPoison",
    name: "Wand of Poison",
    desc: "The vile blast of this twisted bit of wood will imbue its target " + "with a deadly venom. A creature that is poisoned will suffer periodic " + "damage until the effect ends. The duration of the effect increases " + "with the level of the staff.",
    wood: "cherry",
    sprite: "item_wand_poison",
    initialCharges: 2,
    hitChars: true
  },
  {
    id: "regrowth",
    className: "WandOfRegrowth",
    name: "Wand of Regrowth",
    desc: '"When life ceases new life always begins to grow... The eternal cycle always remains!"',
    wood: "teak",
    sprite: "item_wand_regrowth",
    initialCharges: 2,
    hitChars: false
  },
  {
    id: "blink",
    className: "WandOfBlink",
    name: "Wand of Blink",
    desc: "This wand will allow you to teleport in the chosen direction. " + "Creatures and inanimate obstructions will block the teleportation.",
    wood: "rowan",
    sprite: "item_wand_blink",
    initialCharges: 2,
    hitChars: true
  },
  {
    id: "lightning",
    className: "WandOfLightning",
    name: "Wand of Lightning",
    desc: "This wand conjures forth deadly arcs of electricity, which deal damage " + "to several creatures standing close to each other.",
    wood: "willow",
    sprite: "item_wand_lightning",
    initialCharges: 2,
    hitChars: true
  },
  {
    id: "amok",
    className: "WandOfAmok",
    name: "Wand of Amok",
    desc: "The purple light from this wand will make the target run amok " + "attacking random creatures in its vicinity.",
    wood: "mahogany",
    sprite: "item_wand_amok",
    initialCharges: 2,
    hitChars: true
  },
  {
    id: "reach",
    className: "WandOfReach",
    name: "Wand of Reach",
    desc: "This utility wand can be used to grab objects from a distance and to switch places with enemies. " + "Waves of magic force radiated from it will affect all cells on their way triggering traps, " + "trampling high vegetation, opening closed doors and closing open ones.",
    wood: "bamboo",
    sprite: "item_wand_reach",
    initialCharges: 2,
    hitChars: false
  },
  {
    id: "flock",
    className: "WandOfFlock",
    name: "Wand of Flock",
    desc: "A flick of this wand summons a flock of magic sheep, creating temporary impenetrable obstacle.",
    wood: "purpleheart",
    sprite: "item_wand_flock",
    initialCharges: 2,
    hitChars: false
  },
  {
    id: "disintegration",
    className: "WandOfDisintegration",
    name: "Wand of Disintegration",
    desc: "This wand emits a beam of destructive energy, which pierces all creatures in its way. " + "The more targets it hits, the more damage it inflicts to each of them.",
    wood: "oak",
    sprite: "item_wand_disintegration",
    initialCharges: 2,
    hitChars: false
  },
  {
    id: "avalanche",
    className: "WandOfAvalanche",
    name: "Wand of Avalanche",
    desc: "When a discharge of this wand hits a wall (or any other solid obstacle) it causes " + "an avalanche of stones, damaging and stunning all creatures in the affected area.",
    wood: "birch",
    sprite: "item_wand_avalanche",
    initialCharges: 2,
    hitChars: false
  },
  {
    id: "magic_missile",
    className: "WandOfMagicMissile",
    name: "Wand of Magic Missile",
    desc: "This wand launches missiles of pure magical energy, dealing moderate damage to a target creature.",
    wood: null,
    sprite: "item_wand_magicmissile",
    initialCharges: 3,
    hitChars: true
  }
];
function wandSpec(id) {
  const spec = WAND_SPECS.find((s) => s.id === id);
  if (!spec)
    throw new Error(`wands: unknown wand id ${id}`);
  return spec;
}
function txtWandIdentified(wandName) {
  return `You are now familiar enough with your ${wandName}.`;
}
var USAGES_TO_KNOW = 40;
function wandMaxCharges(initialCharges, level) {
  return Math.min(initialCharges + level, 9);
}

// src/mechanics/combat.ts
function hitRoll(rng, accuracy, evasion, magic = false) {
  const acuRoll = rng.float(0, accuracy);
  const defRoll = rng.float(0, evasion);
  return (magic ? acuRoll * 2 : acuRoll) >= defRoll;
}
function applyDamage(rng, target, dmg, sourceTag) {
  if (target.hp <= 0)
    return { hp: target.hp, died: true, paralysisBroken: false };
  if (sourceTag && target.immunities.includes(sourceTag)) {
    dmg = 0;
  } else if (sourceTag && target.resistances.includes(sourceTag)) {
    dmg = rng.intRange(0, dmg);
  }
  let paralysisBroken = false;
  if (target.paralysed) {
    if (rng.int(0, dmg) >= rng.int(0, target.hp)) {
      paralysisBroken = true;
    }
  }
  const hp = target.hp - dmg;
  return { hp, died: hp <= 0, paralysisBroken };
}
function skeletonDeathBurst(rng, damageRoll, victimDr) {
  return Math.max(0, damageRoll(rng) - rng.intRange(0, Math.floor(victimDr / 2)));
}

// src/mechanics/traps.ts
var TXT_HIDDEN_PLATE_CLICKS = "A hidden pressure plate clicks!";
var TXT_ALARM_SOUND = "The trap emits a piercing sound that echoes throughout the dungeon!";
var TXT_LIGHTNING_DEATH = "You were killed by a discharge of a lightning trap...";
function trapKindOf(t) {
  switch (t) {
    case 20 /* TRAP_TOXIC */:
    case 21 /* TRAP_TOXIC_HIDDEN */:
      return "toxic";
    case 22 /* TRAP_FIRE */:
    case 23 /* TRAP_FIRE_HIDDEN */:
      return "fire";
    case 24 /* TRAP_PARALYTIC */:
    case 25 /* TRAP_PARALYTIC_HIDDEN */:
      return "paralytic";
    case 26 /* TRAP_POISON */:
    case 27 /* TRAP_POISON_HIDDEN */:
      return "poison";
    case 28 /* TRAP_ALARM */:
    case 29 /* TRAP_ALARM_HIDDEN */:
      return "alarm";
    case 30 /* TRAP_LIGHTNING */:
    case 31 /* TRAP_LIGHTNING_HIDDEN */:
      return "lightning";
    case 32 /* TRAP_GRIPPING */:
    case 33 /* TRAP_GRIPPING_HIDDEN */:
      return "gripping";
    case 34 /* TRAP_SUMMONING */:
    case 35 /* TRAP_SUMMONING_HIDDEN */:
      return "summoning";
    default:
      return null;
  }
}
function trapCharDr(ch) {
  if (ch.kind === "hero") {
    return ch.armor ? Math.max(ch.armor.dr + ch.armor.level, 0) : 0;
  }
  return ch.def.dr;
}
function damageFromTrap(ctx, rng, ch, dmg, sourceTag, onHeroDeath) {
  if (ch.kind === "mob" && ch.invulnerable)
    return;
  const target = {
    hp: ch.hp,
    ht: ch.ht,
    paralysed: ch.paralysed,
    immunities: ch.immunities,
    resistances: ch.resistances
  };
  const applied = applyDamage(rng, target, dmg, sourceTag);
  ch.hp = applied.hp;
  if (applied.paralysisBroken) {
    ch.paralysed = false;
    delete ch.buffs.paralysis;
  }
  if (applied.died) {
    if (ch.kind === "hero") {
      onHeroDeath?.();
    } else {
      ctx.killMob(ch);
    }
  } else if (ch.kind === "mob") {
    ch.onDamaged?.(ctx);
  }
}
function beckonMob(mob, cell) {
  if (mob.invulnerable)
    return;
  if (mob.state !== "hunting") {
    mob.state = "wandering";
  }
  mob.target = cell;
}
function makeBlobWorld(ctx, hero, mobs) {
  const level = ctx.level;
  return {
    w: level.w,
    length: level.w * level.h,
    depth: level.depth,
    blobs: level.blobs,
    solidAt: (pos) => isSolidForBlob(level.getAt(pos)),
    flamableAt: (pos) => isFlamableForBlob(level.getAt(pos)),
    tileAt: (pos) => level.getAt(pos),
    setTile: (pos, t) => {
      const { x, y } = level.xy(pos);
      level.set(x, y, t);
    },
    charAt: (pos) => {
      if (hero.isAlive() && hero.pos === pos)
        return hero;
      return mobs.find((m) => m.isAlive() && m.pos === pos) ?? null;
    },
    visibleAt: (pos) => level.visible[pos] !== 0,
    damageChar: (rng, ch, dmg, sourceTag, onHeroDeath) => damageFromTrap(ctx, rng, ch, dmg, sourceTag, onHeroDeath ? () => onHeroDeath(ch) : undefined),
    reigniteBurning: (ch) => {
      if (ch.invulnerable)
        return;
      if (ch.immunities.includes("burning")) {
        if (ch.hp < ch.ht)
          ch.hp += 1;
        return;
      }
      ch.buffs.burning = { kind: "burning", left: BURNING_DURATION };
    },
    prolongParalysis: (ch, duration) => {
      if (ch.invulnerable)
        return;
      const cur = ch.buffs.paralysis?.left ?? 0;
      ch.buffs.paralysis = { kind: "paralysis", left: Math.max(cur, duration) };
      ch.paralysed = true;
    },
    prolongRoots: (ch) => {
      if (ch.invulnerable)
        return;
      if (ch.flying)
        return;
      const cur = ch.buffs.roots?.left ?? 0;
      ch.buffs.roots = { kind: "roots", left: Math.max(cur, 1) };
      ch.rooted = true;
    },
    burnOutTile: (pos) => {
      const t = level.getAt(pos);
      const unstitchable = t === 2 /* DOOR */ || t === 17 /* BOOKSHELF */;
      let burned = 38 /* EMBERS */;
      if (unstitchable) {
        const { x: x2, y: y2 } = level.xy(pos);
        const flooded = level.neighbors4(x2, y2).some((n) => level.get(n.x, n.y) === 9 /* WATER */);
        if (flooded)
          burned = 9 /* WATER */;
      }
      const { x, y } = level.xy(pos);
      level.set(x, y, burned);
    },
    log: (msg) => ctx.log(msg)
  };
}
function toxicTrap(ctx, cell) {
  const level = ctx.level;
  seedBlob(level.blobs, "toxic", cell, 300 + 20 * level.depth, level.w * level.h);
}
function fireTrap(ctx, cell) {
  const level = ctx.level;
  seedBlob(level.blobs, "fire", cell, 2, level.w * level.h);
}
function paralyticTrap(ctx, cell) {
  const level = ctx.level;
  seedBlob(level.blobs, "paralytic", cell, 80 + 5 * level.depth, level.w * level.h);
}
function poisonTrap(ctx, ch) {
  if (ch !== null) {
    ch.buffs.poison = { kind: "poison", left: poisonTrapDuration(ctx.level.depth) };
  }
}
function alarmTrap(ctx, cell, ch, mobs, visible) {
  for (const mob of mobs) {
    if (mob !== ch) {
      beckonMob(mob, cell);
    }
  }
  if (visible) {
    ctx.log(TXT_ALARM_SOUND);
  }
}
function lightningTrap(ctx, rng, cell, ch) {
  if (ch !== null) {
    const dmg = Math.max(1, rng.int(Math.floor(ch.hp / 3), Math.floor(2 * ch.hp / 3)));
    damageFromTrap(ctx, rng, ch, dmg, "lightning", () => {
      ctx.log(TXT_LIGHTNING_DEATH);
    });
    if (ch.kind === "hero" && ch.isAlive()) {
      chargeHeroWands(ch);
    }
  } else {}
}
function chargeHeroWands(_hero) {
  return 0;
}
function grippingTrap(rng, ch, depth) {
  if (ch !== null) {
    const damage = Math.max(0, depth + 3 - rng.intRange(0, Math.floor(trapCharDr(ch) / 2)));
    ch.buffs.bleeding = { kind: "bleeding", left: 0, level: damage };
    const cur = ch.buffs.cripple?.left ?? 0;
    ch.buffs.cripple = { kind: "cripple", left: Math.max(cur, CRIPPLE_DURATION) };
  } else {}
}
function bestiaryMobId(rng, depth) {
  let chances;
  let ids;
  switch (depth) {
    case 1:
      chances = [1];
      ids = ["rat"];
      break;
    case 2:
      chances = [1, 1];
      ids = ["rat", "gnoll"];
      break;
    case 3:
      chances = [1, 2, 1, 0.02];
      ids = ["rat", "gnoll", "crab", "swarm"];
      break;
    case 4:
      chances = [1, 2, 3, 0.02, 0.01, 0.01];
      ids = ["rat", "gnoll", "crab", "swarm", "skeleton", "thief"];
      break;
    case 6:
      chances = [4, 2, 1, 0.2];
      ids = ["skeleton", "thief", "swarm", "shaman"];
      break;
    case 7:
      chances = [3, 1, 1, 1];
      ids = ["skeleton", "shaman", "thief", "swarm"];
      break;
    case 8:
      chances = [3, 2, 1, 1, 1, 0.02];
      ids = ["skeleton", "shaman", "gnoll", "thief", "swarm", "bat"];
      break;
    case 9:
      chances = [3, 3, 1, 1, 0.02, 0.01];
      ids = ["skeleton", "shaman", "thief", "swarm", "bat", "brute"];
      break;
    default:
      return null;
  }
  let sum = 0;
  for (const c of chances)
    sum += Math.max(0, c);
  if (sum <= 0)
    return null;
  const value = rng.float(0, sum);
  sum = 0;
  for (let i = 0;i < chances.length; i++) {
    sum += Math.max(0, chances[i]);
    if (value < sum)
      return ids[i];
  }
  return null;
}
function summoningTrap(ctx, rng, cell, ch, hero, mobs, summon) {
  const level = ctx.level;
  if (level.bossLevel) {
    return;
  }
  let nMobs = 1;
  if (rng.int(0, 2) === 0) {
    nMobs++;
    if (rng.int(0, 2) === 0) {
      nMobs++;
    }
  }
  const { x, y } = level.xy(cell);
  const candidates = [];
  for (const n of level.neighbors8(x, y)) {
    const p = level.idx(n.x, n.y);
    const occupied = hero.isAlive() && hero.pos === p || mobs.some((m) => m.isAlive() && m.pos === p);
    if (!occupied && (level.isPassable(n.x, n.y) || level.isAvoid(n.x, n.y))) {
      candidates.push(p);
    }
  }
  const points = [];
  while (nMobs > 0 && candidates.length > 0) {
    const index = rng.int(0, candidates.length);
    points.push(candidates.splice(index, 1)[0]);
    nMobs--;
  }
  for (const point of points) {
    const mobId = bestiaryMobId(rng, level.depth);
    if (mobId === null)
      continue;
    summon(mobId, point);
  }
}
function triggerTrap(ctx, rng, cell, kind, ch, hero, mobs, summon) {
  const visible = ctx.level.visible[cell] !== 0;
  switch (kind) {
    case "toxic":
      toxicTrap(ctx, cell);
      break;
    case "fire":
      fireTrap(ctx, cell);
      break;
    case "paralytic":
      paralyticTrap(ctx, cell);
      break;
    case "poison":
      poisonTrap(ctx, ch);
      break;
    case "alarm":
      alarmTrap(ctx, cell, ch, mobs, visible);
      break;
    case "lightning":
      lightningTrap(ctx, rng, cell, ch);
      break;
    case "gripping":
      grippingTrap(rng, ch, ctx.level.depth);
      break;
    case "summoning":
      summoningTrap(ctx, rng, cell, ch, hero, mobs, summon);
      break;
  }
}
function deactivateTrapCell(level, cell) {
  const { x, y } = level.xy(cell);
  level.set(x, y, 36 /* TRAP_INACTIVE */);
}
function pressTrapCell(ctx, cell, ch, summon) {
  const level = ctx.level;
  const tile = level.getAt(cell);
  const kind = trapKindOf(tile);
  if (kind === null) {
    return;
  }
  if (isHiddenTrap(tile)) {
    ctx.log(TXT_HIDDEN_PLATE_CLICKS);
  }
  const hero = ctx.hero;
  const mobs = ctx.mobs;
  triggerTrap(ctx, ctx.rng, cell, kind, ch, hero, mobs, summon);
  deactivateTrapCell(level, cell);
}
function mobPressTrapCell(ctx, mob, summon) {
  const level = ctx.level;
  const cell = mob.pos;
  const tile = level.getAt(cell);
  const kind = trapKindOf(tile);
  if (kind === null || isHiddenTrap(tile)) {
    return;
  }
  const hero = ctx.hero;
  const mobs = ctx.mobs;
  triggerTrap(ctx, ctx.rng, cell, kind, mob, hero, mobs, summon);
  deactivateTrapCell(level, cell);
}

// src/core/path.ts
function findPath(grid, passable, sx, sy, tx, ty, maxExpand = 8192) {
  if (!grid.inBounds(tx, ty) || !passable(tx, ty))
    return null;
  if (sx === tx && sy === ty)
    return [];
  const start = grid.idx(sx, sy);
  const target = grid.idx(tx, ty);
  const open = [start];
  const came = new Map;
  const g = new Map([[start, 0]]);
  const closed = new Set;
  const h = (i) => {
    const p = grid.xy(i);
    return Math.max(Math.abs(p.x - tx), Math.abs(p.y - ty));
  };
  const f = (i) => (g.get(i) ?? Infinity) + h(i);
  let expanded = 0;
  while (open.length > 0 && expanded++ < maxExpand) {
    let bi = 0;
    for (let i = 1;i < open.length; i++) {
      if (f(open[i]) < f(open[bi]))
        bi = i;
    }
    const cur = open.splice(bi, 1)[0];
    if (cur === target) {
      const path = [];
      let c = cur;
      while (c !== undefined && c !== start) {
        path.push(grid.xy(c));
        c = came.get(c);
      }
      path.reverse();
      return path;
    }
    closed.add(cur);
    const p = grid.xy(cur);
    for (const n of grid.neighbors8(p.x, p.y)) {
      if (!passable(n.x, n.y))
        continue;
      const ni = grid.idx(n.x, n.y);
      if (closed.has(ni))
        continue;
      const ng = (g.get(cur) ?? Infinity) + 1;
      if (ng < (g.get(ni) ?? Infinity)) {
        g.set(ni, ng);
        came.set(ni, cur);
        if (!open.includes(ni))
          open.push(ni);
      }
    }
  }
  return null;
}

// src/dungeon/prisonBoss.ts
function pressArenaCell(level, rng, cell, hooks) {
  if (level.enteredArena)
    return;
  const arena = level.bossArena;
  if (!arena)
    return;
  const w = level.w;
  const x = cell % w;
  const y = Math.floor(cell / w);
  if (x < arena.l || x > arena.r || y < arena.t || y > arena.b)
    return;
  level.enteredArena = true;
  let pos = -1;
  for (let tries = 0;tries < 64 && pos < 0; tries++) {
    const px = arena.l + 1 + rng.int(0, arena.r - arena.l - 1);
    const py = arena.t + 1 + rng.int(0, arena.b - arena.t - 1);
    const p = py * w + px;
    if (p !== cell && !hooks.occupied(p))
      pos = p;
  }
  if (pos >= 0)
    hooks.spawn(pos);
  if (level.arenaDoorCell >= 0) {
    level.set(level.arenaDoorCell % w, Math.floor(level.arenaDoorCell / w), 3 /* DOOR_LOCKED */);
  }
}
function onItemDropped(level, itemId) {
  if (level.keyDropped || !level.bossArena)
    return;
  if (itemId !== "skeleton_key")
    return;
  level.keyDropped = true;
  if (level.arenaDoorCell >= 0) {
    const w = level.w;
    level.set(level.arenaDoorCell % w, Math.floor(level.arenaDoorCell / w), 2 /* DOOR */);
  }
}

// src/dungeon/cavesBoss.ts
function pressArenaCell2(level, rng, cell, hooks) {
  if (level.enteredArena)
    return;
  const arena = level.bossArena;
  if (!arena)
    return;
  const w = level.w;
  const x = cell % w;
  const y = Math.floor(cell / w);
  const outside = x < arena.l - 1 || x > arena.r + 1 || y < arena.t - 1 || y > arena.b + 1;
  if (!outside)
    return;
  level.enteredArena = true;
  let pos = -1;
  for (let tries = 0;tries < 4096 && pos < 0; tries++) {
    const p = rng.int(0, level.size);
    const px = p % w;
    const py = Math.floor(p / w);
    const pOutside = px < arena.l - 1 || px > arena.r + 1 || py < arena.t - 1 || py > arena.b + 1;
    if (pOutside && level.isPassable(px, py) && !level.visible[p] && !hooks.occupied(p)) {
      pos = p;
    }
  }
  if (pos >= 0)
    hooks.spawn(pos);
  if (level.arenaDoorCell >= 0) {
    level.set(level.arenaDoorCell % w, Math.floor(level.arenaDoorCell / w), 0 /* WALL */);
  }
}
function onItemDropped2(level, itemId) {
  if (level.keyDropped || !level.bossArena)
    return;
  if (itemId !== "skeleton_key")
    return;
  level.keyDropped = true;
  if (level.arenaDoorCell >= 0) {
    const w = level.w;
    level.set(level.arenaDoorCell % w, Math.floor(level.arenaDoorCell / w), 1 /* FLOOR */);
  }
}

// src/mechanics/hunger.ts
var HUNGER_STEP = 10;
var HUNGRY = 260;
var STARVING = 360;
var STARVE_DAMAGE_CHANCE = 0.3;
function isHungry(level) {
  return level >= HUNGRY;
}
function isStarving(level) {
  return level >= STARVING;
}
function hungerTick(rng, s) {
  const wasHungry = isHungry(s.level);
  const wasStarving = isStarving(s.level);
  let level = s.level;
  let damage = 0;
  let died = false;
  if (wasStarving) {
    if (rng.float(0, 1) < STARVE_DAMAGE_CHANCE && (s.hp > 1 || !s.paralysed)) {
      damage = 1;
      died = s.hp - 1 <= 0;
    }
  } else {
    level += HUNGER_STEP;
  }
  return {
    level,
    damage,
    died,
    becameStarving: !wasStarving && isStarving(level),
    becameHungry: !wasHungry && level >= HUNGRY && level < STARVING
  };
}
function satisfy(level, energy) {
  const v = level - energy;
  if (v < 0)
    return 0;
  if (v > STARVING)
    return STARVING;
  return v;
}
function regenTick(hp, ht, starving) {
  return hp < ht && !starving ? hp + 1 : hp;
}

// src/content/enchantments.ts
var ENCHANTMENT_ORDER = [
  "fire",
  "poison",
  "death",
  "paralysis",
  "leech",
  "slow",
  "shock",
  "instability",
  "horror",
  "luck",
  "tempering"
];
var ENCHANTMENT_INFO = {
  fire: { name: "blazing", weight: 10 },
  poison: { name: "venomous", weight: 10 },
  death: { name: "grim", weight: 1 },
  paralysis: { name: "stunning", weight: 2 },
  leech: { name: "vampiric", weight: 1 },
  slow: { name: "chilling", weight: 2 },
  shock: { name: "shocking", weight: 6 },
  instability: { name: "unstable", weight: 3 },
  horror: { name: "eldritch", weight: 2 },
  luck: { name: "lucky", weight: 2 },
  tempering: { name: "tempered", weight: 3 }
};
function randomEnchantmentId(rng) {
  let total = 0;
  for (const id of ENCHANTMENT_ORDER)
    total += ENCHANTMENT_INFO[id].weight;
  const roll = rng.float(0, total);
  let acc = 0;
  for (const id of ENCHANTMENT_ORDER) {
    acc += ENCHANTMENT_INFO[id].weight;
    if (roll < acc)
      return id;
  }
  return ENCHANTMENT_ORDER[ENCHANTMENT_ORDER.length - 1];
}
function immune(ch, kind) {
  return ch.immunities.includes(kind);
}
function affectBuff(ch, kind, duration, extra) {
  if (immune(ch, kind))
    return;
  const b = ch.buffs[kind];
  if (b) {
    b.left += duration;
    if (extra?.sourceId !== undefined)
      b.sourceId = extra.sourceId;
    if (extra?.amount !== undefined)
      b.amount = extra.amount;
  } else {
    ch.buffs[kind] = { kind, left: duration, ...extra };
  }
}
function prolongBuff(ch, kind, duration, extra) {
  if (immune(ch, kind))
    return;
  const b = ch.buffs[kind];
  if (b) {
    if (b.left < duration)
      b.left = duration;
    if (extra?.sourceId !== undefined)
      b.sourceId = extra.sourceId;
    if (extra?.amount !== undefined)
      b.amount = extra.amount;
  } else {
    ch.buffs[kind] = { kind, left: duration, ...extra };
  }
}
function reigniteBurning(ch, duration) {
  if (immune(ch, "burning"))
    return;
  ch.buffs["burning"] = { kind: "burning", left: duration };
}
var VERTIGO_DURATION = 10;
var TERROR_DURATION = 10;
var FROST_DURATION = 5;
function deathProc(fx, _attacker, defender, level) {
  if (defender.kind !== "hero" && defender.immunities.includes("death")) {
    return;
  }
  if (fx.rng.int(0, level + 100) >= 92) {
    fx.directDamage(defender, defender.hp, "death");
  }
}
function fireProc(fx, _attacker, defender, _damage, level) {
  if (fx.rng.int(0, level + 3) >= 2) {
    if (fx.rng.int(0, 2) === 0) {
      reigniteBurning(defender, 8);
    } else {
      fx.directDamage(defender, fx.rng.int(1, level + 2), "fire");
    }
  }
}
function horrorProc(fx, attacker, defender, level) {
  if (fx.rng.int(0, level + 5) >= 4) {
    if (defender.kind === "hero") {
      affectBuff(defender, "vertigo", VERTIGO_DURATION);
    } else {
      affectBuff(defender, "terror", TERROR_DURATION, {
        sourceId: attacker.id
      });
    }
  }
}
function leechProc(fx, attacker, _defender, damage, level) {
  const maxValue = Math.floor(damage * (level + 2) / (level + 6));
  const healed = fx.heal(attacker, Math.min(fx.rng.intRange(0, maxValue), attacker.ht - attacker.hp));
}
function luckProc(fx, attacker, defender, damage, level) {
  let best = damage;
  for (let i = 1;i <= level + 1; i++) {
    const roll = fx.attackerDamageRoll(attacker) - i;
    if (roll > best)
      best = roll;
  }
  if (best > damage) {
    fx.directDamage(defender, best - damage, "luck");
    fx.showStatus(defender, `+${best - damage}`);
  }
}
function paralysisProc(fx, _attacker, defender, level) {
  if (fx.rng.int(0, level + 8) >= 7) {
    prolongBuff(defender, "paralysis", fx.rng.float(1, 1.5 + level));
  }
}
function poisonProc(fx, _attacker, defender, level) {
  if (fx.rng.int(0, level + 3) >= 2) {
    if (immune(defender, "poison"))
      return;
    defender.buffs["poison"] = { kind: "poison", left: 1 * (level + 1) };
  }
}
function shockProc(fx, _attacker, defender, damage, level) {
  if (fx.rng.int(0, level + 4) >= 3) {
    const affected = new Set;
    const hit = (ch, dmg) => {
      affected.add(ch.id);
      let amount = fx.rng.int(1, Math.floor(dmg / 2));
      if (!ch.flying && fx.isWater(ch.pos)) {
        amount *= 2;
      }
      fx.directDamage(ch, amount, "lightning");
      const candidates = fx.charsAround(ch.pos).filter((c) => !affected.has(c.id));
      if (candidates.length > 0) {
        const next = candidates[fx.rng.int(0, candidates.length)];
        hit(next, fx.rng.int(Math.floor(dmg / 2), dmg));
      }
    };
    hit(defender, damage);
  }
}
function slowProc(fx, _attacker, defender, level) {
  if (fx.rng.int(0, level + 4) >= 3) {
    prolongBuff(defender, "slow", fx.rng.float(1, 1.5 + level));
  }
}
function temperingProc(weapon) {
  polish(weapon, "weapon");
}
function runEnchantment(fx, id, attacker, defender, damage, level, weapon) {
  switch (id) {
    case "death":
      deathProc(fx, attacker, defender, level);
      break;
    case "fire":
      fireProc(fx, attacker, defender, damage, level);
      break;
    case "horror":
      horrorProc(fx, attacker, defender, level);
      break;
    case "instability":
      runEnchantment(fx, randomEnchantmentId(fx.rng), attacker, defender, damage, level, weapon);
      break;
    case "leech":
      leechProc(fx, attacker, defender, damage, level);
      break;
    case "luck":
      luckProc(fx, attacker, defender, damage, level);
      break;
    case "paralysis":
      paralysisProc(fx, attacker, defender, level);
      break;
    case "poison":
      poisonProc(fx, attacker, defender, level);
      break;
    case "shock":
      shockProc(fx, attacker, defender, damage, level);
      break;
    case "slow":
      slowProc(fx, attacker, defender, level);
      break;
    case "tempering":
      temperingProc(weapon);
      break;
  }
}
function enchantWeaponInstance(rng, weapon) {
  let id = randomEnchantmentId(rng);
  let guard = 0;
  while (id === weapon.enchantment && guard++ < 100) {
    id = randomEnchantmentId(rng);
  }
  weapon.enchantment = id;
  return id;
}
function weaponAttackProc(fx, attacker, defender, damage, weapon) {
  const level = effectiveLevel(weapon);
  if (weapon.enchantment) {
    runEnchantment(fx, weapon.enchantment, attacker, defender, damage, level, weapon);
  }
  const used = useDurability(weapon, "weapon", true);
  if (used.warned) {
    fx.log(TXT_GOING_TO_BREAK.replace("%s", weapon.name));
  }
  if (used.broke) {
    fx.log(TXT_HAS_BROKEN.replace("%s", weapon.name));
  }
}

// src/content/glyphs.ts
var GLYPH_ORDER = [
  "affection",
  "antiEntropy",
  "autoRepair",
  "bounce",
  "displacement",
  "entanglement",
  "metabolism",
  "multiplicity",
  "potential",
  "stench",
  "viscosity"
];
function randomGlyphId(rng) {
  return GLYPH_ORDER[rng.int(0, GLYPH_ORDER.length)];
}
function adjacent(a, b) {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx <= 1 && dy <= 1 && (dx > 0 || dy > 0);
}
function affectionProc(fx, attacker, defender, damage, level) {
  const lvl = Math.max(0, Math.min(level, 6));
  if (adjacent(attacker, defender) && fx.rng.int(0, Math.floor(lvl / 2) + 5) >= 4) {
    let duration = fx.rng.intRange(3, 7);
    affectBuff(attacker, "charm", duration, { sourceId: defender.id });
    duration = Math.floor(duration * fx.rng.float(0.5, 1));
    affectBuff(defender, "charm", duration, { sourceId: attacker.id });
  }
  return damage;
}
function antiEntropyProc(fx, attacker, defender, damage, level) {
  if (adjacent(attacker, defender) && fx.rng.int(0, level + 6) >= 5) {
    prolongBuff(attacker, "frost", FROST_DURATION * fx.rng.float(1, 1.5));
    reigniteBurning(defender, 8);
  }
  return damage;
}
function autoRepairProc(fx, _attacker, defender, damage, armor) {
  if (defender.kind === "hero" && fx.spendGold(armor.tier)) {
    polish(armor, "armor");
  }
  return damage;
}
function bounceProc(fx, attacker, defender, damage, level, w) {
  if (adjacent(attacker, defender) && fx.rng.int(0, level + 5) >= 4) {
    const ofsX = attacker.x - defender.x;
    const ofsY = attacker.y - defender.y;
    const newPos = (attacker.y + ofsY) * w + (attacker.x + ofsX);
    if (fx.isFreeCell(newPos)) {
      attacker.pos = newPos;
      fx.pressCell(attacker);
    }
  }
  return damage;
}
function displacementProc(fx, _attacker, defender, damage, level, w, h) {
  if (fx.isBossLevel()) {
    return damage;
  }
  const nTries = (level < 0 ? 1 : level + 1) * 5;
  for (let i = 0;i < nTries; i++) {
    const pos = fx.rng.int(0, w * h);
    if (fx.isVisible(pos) && fx.isFreeCell(pos)) {
      fx.teleport(defender, pos);
      fx.pressCell(defender);
      break;
    }
  }
  return damage;
}
function entanglementProc(fx, _attacker, defender, damage, level) {
  if (fx.rng.int(0, 4) === 0) {
    prolongBuff(defender, "roots", 5 - Math.floor(level / 5));
    const armorLevel = 5 * (level + 1);
    const existing = defender.buffs["earthrootArmor"];
    if (existing) {
      if (existing.amount === undefined || existing.amount < armorLevel) {
        existing.amount = armorLevel;
      }
    } else if (!defender.immunities.includes("earthrootArmor")) {
      defender.buffs["earthrootArmor"] = {
        kind: "earthrootArmor",
        left: Number.POSITIVE_INFINITY,
        amount: armorLevel
      };
    }
  }
  return damage;
}
function metabolismProc(fx, _attacker, defender, damage, level) {
  if (defender.kind === "hero" && !fx.isStarving() && fx.rng.int(0, Math.floor(level / 2) + 5) >= 4) {
    const healing = Math.min(defender.ht - defender.hp, fx.rng.int(1, Math.floor(defender.ht / 5)));
    if (healing > 0) {
      fx.addHunger(36);
      fx.heal(defender, healing);
    }
  }
  return damage;
}
function multiplicityProc(fx, _attacker, defender, damage, level, w) {
  if (fx.rng.int(0, Math.floor(level / 2) + 6) >= 5) {
    const candidates = [];
    for (let dy = -1;dy <= 1; dy++) {
      for (let dx = -1;dx <= 1; dx++) {
        if (dx === 0 && dy === 0)
          continue;
        const pos = (defender.y + dy) * w + (defender.x + dx);
        if (fx.isFreeCell(pos))
          candidates.push(pos);
      }
    }
    if (candidates.length > 0 && fx.spawnMirrorImage(defender)) {
      fx.directDamage(defender, fx.rng.intRange(1, Math.floor(defender.ht / 6)), "multiplicity");
    }
  }
  return damage;
}
function potentialProc(fx, attacker, defender, damage, level) {
  if (adjacent(attacker, defender) && fx.rng.int(0, level + 7) >= 6) {
    const dmg = fx.rng.intRange(1, damage);
    fx.directDamage(attacker, dmg, "lightning");
    if (attacker.kind === "hero" || defender.kind === "hero") {}
    fx.directDamage(defender, fx.rng.intRange(1, dmg), "lightning");
  }
  return damage;
}
function stenchProc(fx, attacker, defender, damage, level) {
  if (adjacent(attacker, defender) && fx.rng.int(0, level + 5) >= 4) {
    fx.seedGas(attacker.pos, 20);
  }
  return damage;
}
function viscosityProc(fx, _attacker, defender, damage, level) {
  if (damage === 0) {
    return 0;
  }
  if (fx.rng.int(0, level + 7) >= 6) {
    const existing = defender.buffs["deferredDamage"];
    if (existing) {
      existing.amount = (existing.amount ?? 0) + damage;
    } else if (!defender.immunities.includes("deferredDamage")) {
      defender.buffs["deferredDamage"] = {
        kind: "deferredDamage",
        left: Number.POSITIVE_INFINITY,
        amount: damage
      };
    }
    return 0;
  }
  return damage;
}
function inscribeArmorInstance(rng, armor) {
  let id = randomGlyphId(rng);
  let guard = 0;
  while (id === armor.glyph && guard++ < 100) {
    id = randomGlyphId(rng);
  }
  armor.glyph = id;
  return id;
}
function earthrootAbsorb(armorLevel, damage) {
  if (damage >= armorLevel) {
    return { damage: damage - armorLevel, remaining: 0 };
  }
  return { damage: 0, remaining: armorLevel - damage };
}
function armorDefenseProc(fx, armor, attacker, defender, damage, w, h) {
  const level = effectiveLevel(armor);
  const earthroot = defender.buffs["earthrootArmor"];
  if (earthroot && (earthroot.amount ?? 0) > 0) {
    const absorbed = earthrootAbsorb(earthroot.amount ?? 0, damage);
    damage = absorbed.damage;
    if (absorbed.remaining <= 0) {
      delete defender.buffs["earthrootArmor"];
    } else {
      earthroot.amount = absorbed.remaining;
    }
  }
  if (armor.glyph) {
    damage = runGlyph(fx, armor.glyph, armor, attacker, defender, damage, level, w, h);
  }
  const used = useDurability(armor, "armor", true);
  if (used.warned) {
    fx.log(TXT_GOING_TO_BREAK.replace("%s", armor.name));
  }
  if (used.broke) {
    fx.log(TXT_HAS_BROKEN.replace("%s", armor.name));
  }
  return damage;
}
function runGlyph(fx, id, armor, attacker, defender, damage, level, w, h) {
  switch (id) {
    case "affection":
      return affectionProc(fx, attacker, defender, damage, level);
    case "antiEntropy":
      return antiEntropyProc(fx, attacker, defender, damage, level);
    case "autoRepair":
      return autoRepairProc(fx, attacker, defender, damage, armor);
    case "bounce":
      return bounceProc(fx, attacker, defender, damage, level, w);
    case "displacement":
      return displacementProc(fx, attacker, defender, damage, level, w, h);
    case "entanglement":
      return entanglementProc(fx, attacker, defender, damage, level);
    case "metabolism":
      return metabolismProc(fx, attacker, defender, damage, level);
    case "multiplicity":
      return multiplicityProc(fx, attacker, defender, damage, level, w);
    case "potential":
      return potentialProc(fx, attacker, defender, damage, level);
    case "stench":
      return stenchProc(fx, attacker, defender, damage, level);
    case "viscosity":
      return viscosityProc(fx, attacker, defender, damage, level);
  }
}

// src/content/itemgen.ts
var GEN_CATEGORY_WEIGHTS = [
  { cat: "weapon", weight: 15 },
  { cat: "armor", weight: 10 },
  { cat: "potion", weight: 50 },
  { cat: "scroll", weight: 40 },
  { cat: "wand", weight: 4 },
  { cat: "ring", weight: 2 },
  { cat: "seed", weight: 5 },
  { cat: "food", weight: 0 },
  { cat: "gold", weight: 50 },
  { cat: "misc", weight: 5 }
];
var dart = (min, max) => (rng) => `dart:${rng.int(min, max)}`;
var shortsword = () => "shortsword";
var GEN_CLASSES = {
  weapon: [
    { cls: "Dagger", prob: 1, m1: shortsword },
    { cls: "Knuckles", prob: 1, m1: shortsword },
    { cls: "Quarterstaff", prob: 1, m1: shortsword },
    { cls: "Spear", prob: 1, m1: shortsword },
    { cls: "Mace", prob: 1, m1: shortsword },
    { cls: "Sword", prob: 1, m1: shortsword },
    { cls: "Longsword", prob: 1, m1: shortsword },
    { cls: "BattleAxe", prob: 1, m1: shortsword },
    { cls: "WarHammer", prob: 1, m1: shortsword },
    { cls: "Glaive", prob: 1, m1: shortsword },
    { cls: "ShortSword", prob: 0, m1: shortsword },
    { cls: "Dart", prob: 0, m1: dart(5, 15) },
    { cls: "Javelin", prob: 1, m1: dart(5, 15) },
    { cls: "IncendiaryDart", prob: 1, m1: dart(3, 6) },
    { cls: "CurareDart", prob: 1, m1: dart(2, 5) },
    { cls: "Shuriken", prob: 1, m1: dart(5, 15) },
    { cls: "Boomerang", prob: 0, m1: dart(5, 15) },
    { cls: "Tamahawk", prob: 1, m1: dart(5, 12) }
  ],
  armor: [
    { cls: "ClothArmor", prob: 1, m1: () => "cloth_armor" },
    { cls: "LeatherArmor", prob: 1, m1: () => "cloth_armor" },
    { cls: "MailArmor", prob: 1, m1: () => "cloth_armor" },
    { cls: "ScaleArmor", prob: 1, m1: () => "cloth_armor" },
    { cls: "PlateArmor", prob: 1, m1: () => "cloth_armor" }
  ],
  potion: [
    { cls: "PotionOfHealing", prob: 45, m1: () => "potion_healing" },
    { cls: "PotionOfExperience", prob: 4, m1: () => "potion_experience" },
    { cls: "PotionOfToxicGas", prob: 15, m1: () => "potion_toxicgas" },
    { cls: "PotionOfParalyticGas", prob: 10, m1: () => "potion_paralyticgas" },
    { cls: "PotionOfLiquidFlame", prob: 15, m1: () => "potion_liquidflame" },
    { cls: "PotionOfLevitation", prob: 10, m1: () => "potion_levitation" },
    { cls: "PotionOfStrength", prob: 0, m1: () => "potion_strength" },
    { cls: "PotionOfMindVision", prob: 20, m1: () => "potion_mindvision" },
    { cls: "PotionOfPurity", prob: 12, m1: () => "potion_purity" },
    { cls: "PotionOfInvisibility", prob: 10, m1: () => "potion_invisibility" },
    { cls: "PotionOfMight", prob: 0, m1: () => "potion_might" },
    { cls: "PotionOfFrost", prob: 10, m1: () => "potion_frost" }
  ],
  scroll: [
    { cls: "ScrollOfIdentify", prob: 30, m1: () => "scroll_identify" },
    { cls: "ScrollOfTeleportation", prob: 10, m1: () => "scroll_teleportation" },
    { cls: "ScrollOfRemoveCurse", prob: 15, m1: () => "scroll_removecurse" },
    { cls: "ScrollOfRecharging", prob: 10, m1: () => "scroll_recharging" },
    { cls: "ScrollOfMagicMapping", prob: 15, m1: () => "scroll_magicmapping" },
    { cls: "ScrollOfChallenge", prob: 12, m1: () => "scroll_challenge" },
    { cls: "ScrollOfTerror", prob: 8, m1: () => "scroll_terror" },
    { cls: "ScrollOfLullaby", prob: 8, m1: () => "scroll_lullaby" },
    { cls: "ScrollOfPsionicBlast", prob: 4, m1: () => "scroll_psionicblast" },
    { cls: "ScrollOfMirrorImage", prob: 6, m1: () => "scroll_mirrorimage" },
    { cls: "ScrollOfUpgrade", prob: 0, m1: () => "scroll_upgrade" },
    { cls: "ScrollOfEnchantment", prob: 1, m1: () => "scroll" }
  ],
  wand: [
    { cls: "WandOfTeleportation", prob: 10, m1: () => "wand_of_teleportation" },
    { cls: "WandOfSlowness", prob: 10, m1: () => "wand_of_slowness" },
    { cls: "WandOfFirebolt", prob: 15, m1: () => "wand_of_firebolt" },
    { cls: "WandOfRegrowth", prob: 6, m1: () => "wand_of_regrowth" },
    { cls: "WandOfPoison", prob: 10, m1: () => "wand_of_poison" },
    { cls: "WandOfBlink", prob: 11, m1: () => "wand_of_blink" },
    { cls: "WandOfLightning", prob: 15, m1: () => "wand_of_lightning" },
    { cls: "WandOfAmok", prob: 10, m1: () => "wand_of_amok" },
    { cls: "WandOfReach", prob: 6, m1: () => "wand_of_reach" },
    { cls: "WandOfFlock", prob: 10, m1: () => "wand_of_flock" },
    { cls: "WandOfMagicMissile", prob: 0, m1: () => "wand_of_magic_missile" },
    { cls: "WandOfDisintegration", prob: 5, m1: () => "wand_of_disintegration" },
    { cls: "WandOfAvalanche", prob: 5, m1: () => "wand_of_avalanche" }
  ],
  ring: [
    { cls: "RingOfMending", prob: 1, m1: () => "ring_of_mending" },
    { cls: "RingOfDetection", prob: 1, m1: () => "ring_of_detection" },
    { cls: "RingOfShadows", prob: 1, m1: () => "ring_of_shadows" },
    { cls: "RingOfPower", prob: 1, m1: () => "ring_of_power" },
    { cls: "RingOfHerbalism", prob: 1, m1: () => "ring_of_herbalism" },
    { cls: "RingOfAccuracy", prob: 1, m1: () => "ring_of_accuracy" },
    { cls: "RingOfEvasion", prob: 1, m1: () => "ring_of_evasion" },
    { cls: "RingOfSatiety", prob: 1, m1: () => "ring_of_satiety" },
    { cls: "RingOfHaste", prob: 1, m1: () => "ring_of_haste" },
    { cls: "RingOfElements", prob: 1, m1: () => "ring_of_elements" },
    { cls: "RingOfHaggler", prob: 0, m1: () => "ring_of_haggler" },
    { cls: "RingOfThorns", prob: 0, m1: () => "ring_of_thorns" }
  ],
  seed: [
    { cls: "Firebloom.Seed", prob: 1, m1: () => "ration" },
    { cls: "Icecap.Seed", prob: 1, m1: () => "ration" },
    { cls: "Sorrowmoss.Seed", prob: 1, m1: () => "ration" },
    { cls: "Dreamweed.Seed", prob: 1, m1: () => "ration" },
    { cls: "Sungrass.Seed", prob: 1, m1: () => "ration" },
    { cls: "Earthroot.Seed", prob: 1, m1: () => "ration" },
    { cls: "Fadeleaf.Seed", prob: 1, m1: () => "ration" },
    { cls: "Rotberry.Seed", prob: 0, m1: () => "ration" }
  ],
  food: [
    { cls: "Food", prob: 4, m1: () => "ration" },
    { cls: "Pasty", prob: 1, m1: () => "ration" },
    { cls: "MysteryMeat", prob: 0, m1: () => "ration" }
  ],
  gold: [
    {
      cls: "Gold",
      prob: 1,
      m1: (rng, depth) => `gold:${rng.int(20 + depth * 10, 40 + depth * 20)}`
    }
  ],
  misc: [
    { cls: "Bomb", prob: 2, m1: dart(5, 15) },
    { cls: "Honeypot", prob: 1, m1: () => "honeypot" }
  ]
};
function chances(rng, entries, weight) {
  let total = 0;
  for (const e of entries)
    total += weight(e);
  const roll = rng.float(0, total);
  let acc = 0;
  for (const e of entries) {
    acc += weight(e);
    if (roll < acc)
      return e;
  }
  return entries[entries.length - 1];
}

class GeneratorBag {
  weights = new Map;
  constructor() {
    this.reset();
  }
  reset() {
    for (const { cat, weight } of GEN_CATEGORY_WEIGHTS) {
      this.weights.set(cat, weight);
    }
  }
  weightOf(cat) {
    return this.weights.get(cat);
  }
  random(rng, depth) {
    const cat = chances(rng, GEN_CATEGORY_WEIGHTS, (e) => this.weights.get(e.cat)).cat;
    return this.randomFrom(rng, cat, depth);
  }
  randomFrom(rng, cat, depth) {
    this.weights.set(cat, this.weights.get(cat) / 2);
    const cls = chances(rng, GEN_CLASSES[cat], (e) => e.prob);
    return cls.m1(rng, depth);
  }
}
function skeletonWeaponDrop(rng, depth, bag) {
  let best = "";
  let bestLvl = Number.POSITIVE_INFINITY;
  for (let i = 0;i < 3; i++) {
    const id = bag.randomFrom(rng, "weapon", depth);
    const lvl = 0;
    if (lvl < bestLvl) {
      best = id;
      bestLvl = lvl;
    }
  }
  return best;
}
var itemGenerator = new GeneratorBag;
function resetItemGenerator() {
  itemGenerator.reset();
}

// src/content/mobs.ts
var MOB_DEFS = {
  rat: {
    id: "rat",
    name: "marsupial rat",
    sprite: "mob_rat",
    hp: 8,
    atk: 8,
    def: 3,
    dmgMin: 1,
    dmgMax: 5,
    triangular: true,
    dr: 1,
    exp: MOB_EXP.rat.exp,
    maxLvl: MOB_EXP.rat.maxLvl,
    speed: 1,
    flying: false,
    ability: null,
    attackDelay: 1,
    immunities: [],
    resistances: []
  },
  gnoll: {
    id: "gnoll",
    name: "gnoll scout",
    sprite: "mob_gnoll",
    hp: 12,
    atk: 11,
    def: 4,
    dmgMin: 2,
    dmgMax: 5,
    triangular: true,
    dr: 2,
    exp: MOB_EXP.gnoll.exp,
    maxLvl: MOB_EXP.gnoll.maxLvl,
    speed: 1,
    flying: false,
    ability: null,
    attackDelay: 1,
    immunities: [],
    resistances: []
  },
  crab: {
    id: "crab",
    name: "sewer crab",
    sprite: "mob_crab",
    hp: 15,
    atk: 12,
    def: 5,
    dmgMin: 3,
    dmgMax: 6,
    triangular: true,
    dr: 4,
    exp: MOB_EXP.crab.exp,
    maxLvl: MOB_EXP.crab.maxLvl,
    speed: 2,
    flying: false,
    ability: null,
    attackDelay: 1,
    immunities: [],
    resistances: []
  },
  swarm: {
    id: "swarm",
    name: "swarm of flies",
    sprite: "mob_swarm",
    hp: 80,
    atk: 12,
    def: 5,
    dmgMin: 1,
    dmgMax: 4,
    triangular: true,
    dr: 0,
    exp: MOB_EXP.swarm.exp,
    maxLvl: MOB_EXP.swarm.maxLvl,
    speed: 1,
    flying: true,
    ability: "swarm",
    attackDelay: 1,
    immunities: [],
    resistances: []
  },
  skeleton: {
    id: "skeleton",
    name: "skeleton",
    sprite: "mob_skeleton",
    hp: 25,
    atk: 12,
    def: 9,
    dmgMin: 3,
    dmgMax: 8,
    triangular: true,
    dr: 5,
    exp: MOB_EXP.skeleton.exp,
    maxLvl: MOB_EXP.skeleton.maxLvl,
    speed: 1,
    flying: false,
    ability: "skeleton",
    attackDelay: 1,
    immunities: ["death"],
    resistances: []
  },
  thief: {
    id: "thief",
    name: "crazy thief",
    sprite: "mob_thief",
    hp: 20,
    atk: 12,
    def: 12,
    dmgMin: 1,
    dmgMax: 7,
    triangular: true,
    dr: 3,
    exp: MOB_EXP.thief.exp,
    maxLvl: MOB_EXP.thief.maxLvl,
    speed: 1,
    flying: false,
    ability: "thief",
    attackDelay: 0.5,
    immunities: [],
    resistances: []
  },
  shaman: {
    id: "shaman",
    name: "gnoll shaman",
    sprite: "mob_shaman",
    hp: 18,
    atk: 11,
    def: 8,
    dmgMin: 2,
    dmgMax: 6,
    triangular: true,
    dr: 4,
    exp: MOB_EXP.shaman.exp,
    maxLvl: MOB_EXP.shaman.maxLvl,
    speed: 1,
    flying: false,
    ability: null,
    attackDelay: 1,
    immunities: [],
    resistances: ["lightning"]
  },
  bat: {
    id: "bat",
    name: "vampire bat",
    sprite: "mob_bat",
    hp: 30,
    atk: 16,
    def: 15,
    dmgMin: 6,
    dmgMax: 12,
    triangular: true,
    dr: 4,
    exp: MOB_EXP.bat.exp,
    maxLvl: MOB_EXP.bat.maxLvl,
    speed: 2,
    flying: true,
    ability: null,
    attackDelay: 1,
    immunities: [],
    resistances: ["leech"]
  },
  brute: {
    id: "brute",
    name: "gnoll brute",
    sprite: "mob_brute",
    hp: 40,
    atk: 20,
    def: 15,
    dmgMin: 8,
    dmgMax: 18,
    triangular: true,
    dr: 8,
    exp: MOB_EXP.brute.exp,
    maxLvl: MOB_EXP.brute.maxLvl,
    speed: 1,
    flying: false,
    ability: null,
    attackDelay: 1,
    immunities: ["terror"],
    resistances: []
  },
  albino: {
    id: "albino",
    name: "albino rat",
    sprite: "mob_albino",
    hp: 15,
    atk: 8,
    def: 3,
    dmgMin: 1,
    dmgMax: 5,
    triangular: true,
    dr: 1,
    exp: MOB_EXP.albino.exp,
    maxLvl: MOB_EXP.albino.maxLvl,
    speed: 1,
    flying: false,
    ability: null,
    attackDelay: 1,
    immunities: [],
    resistances: []
  },
  bandit: {
    id: "bandit",
    name: "crazy bandit",
    sprite: "mob_bandit",
    hp: 20,
    atk: 12,
    def: 12,
    dmgMin: 1,
    dmgMax: 7,
    triangular: true,
    dr: 3,
    exp: MOB_EXP.bandit.exp,
    maxLvl: MOB_EXP.bandit.maxLvl,
    speed: 1,
    flying: false,
    ability: "thief",
    attackDelay: 0.5,
    immunities: [],
    resistances: []
  },
  shielded: {
    id: "shielded",
    name: "shielded brute",
    sprite: "mob_shielded",
    hp: 40,
    atk: 20,
    def: 20,
    dmgMin: 8,
    dmgMax: 18,
    triangular: true,
    dr: 10,
    exp: MOB_EXP.shielded.exp,
    maxLvl: MOB_EXP.shielded.maxLvl,
    speed: 1,
    flying: false,
    ability: null,
    attackDelay: 1,
    immunities: ["terror"],
    resistances: []
  },
  spinner: {
    id: "spinner",
    name: "cave spinner",
    sprite: "mob_spinner",
    hp: 50,
    atk: 20,
    def: 14,
    dmgMin: 12,
    dmgMax: 16,
    triangular: true,
    dr: 6,
    exp: MOB_EXP.spinner.exp,
    maxLvl: MOB_EXP.spinner.maxLvl,
    speed: 1,
    flying: false,
    ability: null,
    attackDelay: 1,
    immunities: ["roots"],
    resistances: ["poison"]
  },
  elemental: {
    id: "elemental",
    name: "fire elemental",
    sprite: "mob_elemental",
    hp: 65,
    atk: 25,
    def: 20,
    dmgMin: 16,
    dmgMax: 20,
    triangular: true,
    dr: 5,
    exp: MOB_EXP.elemental.exp,
    maxLvl: MOB_EXP.elemental.maxLvl,
    speed: 1,
    flying: true,
    ability: null,
    attackDelay: 1,
    immunities: ["burning", "fire", "firebolt", "psionic_blast"],
    resistances: []
  },
  monk: {
    id: "monk",
    name: "dwarf monk",
    sprite: "mob_monk",
    hp: 70,
    atk: 30,
    def: 30,
    dmgMin: 12,
    dmgMax: 16,
    triangular: true,
    dr: 2,
    exp: MOB_EXP.monk.exp,
    maxLvl: MOB_EXP.monk.maxLvl,
    speed: 1,
    flying: false,
    ability: null,
    attackDelay: 0.5,
    immunities: ["amok", "terror"],
    resistances: []
  }
};
var mobIdCounter = 1;
function nextMobId() {
  return mobIdCounter++;
}
function chebyshevPos(a, b, w) {
  return Math.max(Math.abs(a % w - b % w), Math.abs(Math.floor(a / w) - Math.floor(b / w)));
}
function buffTarget(ch) {
  return {
    hp: ch.hp,
    ht: ch.ht,
    paralysed: ch.paralysed,
    immunities: ch.immunities,
    resistances: ch.resistances
  };
}
function tickBuffs(rng, level, ch, log) {
  const inWater = level.getAt(ch.pos) === 9 /* WATER */;
  const b = ch.buffs;
  const hero = ch.kind === "hero" ? ch : null;
  const logBuffDeath = (kind) => {
    if (hero && !hero.isAlive()) {
      const msg = buffDeathMessage(kind);
      if (msg)
        log(msg);
    }
  };
  if (b.burning && ch.isAlive()) {
    const t = burningTick(rng, ch.hp, ch.ht, b.burning.left, inWater, ch.flying);
    const applied = applyDamage(rng, buffTarget(ch), t.damage, "burning");
    ch.hp = applied.hp;
    if (hero) {
      const burn = burningInventoryTick(rng, hero.inventory, (id) => getItem(id).type === "scroll", (id) => id === "mystery_meat");
      if (burn) {
        const stack = hero.inventory[burn.stackIndex];
        if (stack) {
          const name = getItem(stack.itemId).name;
          removeFromInventory(hero, burn.stackIndex, 1);
          if (burn.cookedId !== null && burn.cookedId in ITEMS) {
            addToInventory(hero, burn.cookedId, 1);
          }
          log(burnsUpMessage(name));
        }
      }
    }
    logBuffDeath("burning");
    if (t.detached)
      delete b.burning;
    else
      b.burning.left = t.left;
    if (applied.paralysisBroken) {
      ch.paralysed = false;
      delete b.paralysis;
    }
  }
  if (b.poison && ch.isAlive()) {
    const t = poisonTick(b.poison.left);
    const applied = applyDamage(rng, buffTarget(ch), t.damage, "poison");
    ch.hp = applied.hp;
    logBuffDeath("poison");
    if (t.detached)
      delete b.poison;
    else
      b.poison.left = t.left;
    if (applied.paralysisBroken) {
      ch.paralysed = false;
      delete b.paralysis;
    }
  }
  if (b.ooze && ch.isAlive()) {
    const t = oozeTick(inWater);
    const applied = applyDamage(rng, buffTarget(ch), t.damage, "ooze");
    ch.hp = applied.hp;
    logBuffDeath("ooze");
    if (t.detached)
      delete b.ooze;
    if (applied.paralysisBroken) {
      ch.paralysed = false;
      delete b.paralysis;
    }
  }
  if (b.bleeding && ch.isAlive()) {
    const t = bleedingTick(rng, b.bleeding.level ?? 0);
    if (t.detached) {
      delete b.bleeding;
    } else {
      b.bleeding.level = t.level;
      const applied = applyDamage(rng, buffTarget(ch), t.level, "bleeding");
      ch.hp = applied.hp;
      logBuffDeath("bleeding");
      if (applied.paralysisBroken) {
        ch.paralysed = false;
        delete b.paralysis;
      }
    }
  } else if (b.bleeding) {
    delete b.bleeding;
  }
  if (b.paralysis) {
    b.paralysis.left -= 1;
    if (b.paralysis.left <= 0) {
      delete b.paralysis;
      ch.paralysed = false;
    }
  }
  if (b.cripple) {
    b.cripple.left -= 1;
    if (b.cripple.left <= 0)
      delete b.cripple;
  }
  if (b.roots) {
    b.roots.left -= 1;
    if (b.roots.left <= 0) {
      delete b.roots;
      ch.rooted = false;
    } else {
      ch.rooted = true;
    }
  }
  if (b.blindness) {
    b.blindness.left -= 1;
    if (b.blindness.left <= 0)
      delete b.blindness;
  }
  if (b.deferredDamage && ch.isAlive()) {
    const pool = Math.floor(b.deferredDamage.amount ?? 0);
    if (pool <= 0) {
      delete b.deferredDamage;
    } else {
      b.deferredDamage.amount = pool - 1;
      const applied = applyDamage(rng, buffTarget(ch), 1, "deferredDamage");
      ch.hp = applied.hp;
      if (applied.died)
        delete b.deferredDamage;
      else if ((b.deferredDamage.amount ?? 0) <= 0)
        delete b.deferredDamage;
      logBuffDeath("deferredDamage");
      if (applied.paralysisBroken) {
        ch.paralysed = false;
        delete b.paralysis;
      }
    }
  }
  if (b.slow) {
    b.slow.left -= 1;
    if (b.slow.left <= 0)
      delete b.slow;
  }
  if (b.vertigo) {
    b.vertigo.left -= 1;
    if (b.vertigo.left <= 0)
      delete b.vertigo;
  }
  if (b.charm) {
    b.charm.left -= 1;
    if (b.charm.left <= 0)
      delete b.charm;
  }
  tickPotionBuffs(b, ch, () => {
    const m = ch;
    if (m.aiState === "sleeping")
      m.aiState = "wandering";
  });
}
function heroOf(ctx) {
  return ctx.hero;
}
function mobAtCell(ctx, x, y, self) {
  return ctx.mobs.find((m) => m !== self && m.x === x && m.y === y && m.isAlive());
}
function charAtPos(ctx, pos, self) {
  const hero = heroOf(ctx);
  if (hero.isAlive() && hero.pos === pos)
    return hero;
  const w = ctx.level.w;
  const m = mobAtCell(ctx, pos % w, Math.floor(pos / w), self);
  return m;
}
function tileWalkableFor(level, x, y) {
  return level.isPassable(x, y);
}
function stepToward(ctx, mob, tx, ty) {
  const level = ctx.level;
  const w = level.w;
  const sx = mob.x;
  const sy = mob.y;
  if (Math.max(Math.abs(tx - sx), Math.abs(ty - sy)) <= 1) {
    if (!charAtPos(ctx, ty * w + tx, mob) && tileWalkableFor(level, tx, ty)) {
      return ty * w + tx;
    }
    return -1;
  }
  const path = findPath(level, (x, y) => {
    if (x === tx && y === ty)
      return tileWalkableFor(level, x, y);
    return tileWalkableFor(level, x, y) && !charAtPos(ctx, y * w + x, mob);
  }, sx, sy, tx, ty);
  if (!path || path.length === 0)
    return -1;
  const s = path[0];
  if (charAtPos(ctx, s.y * w + s.x, mob))
    return -1;
  return s.y * w + s.x;
}
function stepAway(ctx, mob, fx, fy) {
  const level = ctx.level;
  const w = level.w;
  let best = -1;
  let bestD = -1;
  for (let dy = -1;dy <= 1; dy++) {
    for (let dx = -1;dx <= 1; dx++) {
      if (dx === 0 && dy === 0)
        continue;
      const nx = mob.x + dx;
      const ny = mob.y + dy;
      if (!tileWalkableFor(level, nx, ny))
        continue;
      if (charAtPos(ctx, ny * w + nx, mob))
        continue;
      const d = Math.max(Math.abs(nx - fx), Math.abs(ny - fy));
      if (d > bestD) {
        bestD = d;
        best = ny * w + nx;
      }
    }
  }
  return best;
}
function randomDestination(rng, level) {
  for (let i = 0;i < 50; i++) {
    const pos = rng.int(0, level.w * level.h);
    if (level.isPassable(pos % level.w, Math.floor(pos / level.w)))
      return pos;
  }
  return -1;
}
function dropItemAt(ctx, pos, itemId) {
  ctx.level.items.push({ pos, itemId, sprite: getItem(itemId).sprite });
  if (ctx.level.depth === 10) {
    onItemDropped(ctx.level, itemId);
  } else if (ctx.level.depth === 15) {
    onItemDropped2(ctx.level, itemId);
  }
}
function runAttackSequence(rng, sides) {
  if (!hitRoll(rng, sides.accuracy, sides.evasion)) {
    return { hit: false, damageDealt: 0 };
  }
  const dr = rng.intRange(0, sides.defenderDr);
  const dmg = sides.damageRoll(rng);
  let effective = Math.max(dmg - dr, 0);
  effective = sides.onAttackProc ? sides.onAttackProc(rng, effective) : effective;
  effective = sides.onDefenseProc ? sides.onDefenseProc(rng, effective) : effective;
  return { hit: true, damageDealt: effective };
}

class ContentMob extends Actor {
  id;
  def;
  pos;
  w;
  hp;
  ht;
  name;
  sprite;
  hostile = true;
  state = "sleeping";
  enemySeen = false;
  target = -1;
  justAlerted = false;
  paralysed = false;
  rooted = false;
  flying;
  buffs = {};
  immunities;
  resistances;
  generation = 0;
  stolen = null;
  invulnerable = false;
  constructor(id, def, pos, w) {
    super();
    this.id = id;
    this.def = def;
    this.pos = pos;
    this.w = w;
    this.hp = def.hp;
    this.ht = def.hp;
    this.name = def.name;
    this.sprite = def.sprite;
    this.flying = def.flying;
    this.immunities = [...def.immunities];
    this.resistances = [...def.resistances];
  }
  get x() {
    return this.pos % this.w;
  }
  set x(v) {
    this.pos = this.y * this.w + v;
  }
  get y() {
    return Math.floor(this.pos / this.w);
  }
  set y(v) {
    this.pos = v * this.w + this.x;
  }
  getSpeed() {
    return this.def.speed * crippleFactor(this);
  }
  getTimeScale() {
    return charTimeScale(this);
  }
  isAlive() {
    return this.hp > 0;
  }
  attackDelay() {
    return this.def.attackDelay;
  }
  mobDefenseSkill() {
    return this.enemySeen && !this.paralysed ? this.def.def : 0;
  }
  defenseVerb() {
    return "dodged";
  }
  mobDamageRoll(rng) {
    return rng.normalIntRange(this.def.dmgMin, this.def.dmgMax);
  }
  act() {
    throw new Error("ContentMob.act: route through MechanicsHooks.actMob -> takeTurn(ctx)");
  }
  moveCost() {
    return 1;
  }
  waitCost() {
    return this.getSpeed();
  }
  attackCost() {
    return this.attackDelay() * this.getSpeed();
  }
  takeTurn(ctx) {
    const rng = ctx.rng;
    if (!this.isAlive()) {
      killMob(ctx, this, {});
      return this.waitCost();
    }
    const justAlerted = this.justAlerted;
    this.justAlerted = false;
    if (this.paralysed) {
      this.enemySeen = false;
      return this.waitCost();
    }
    const enemy = this.selectEnemy(ctx);
    const enemyInFOV = enemy != null && enemy.isAlive() && this.canSee(ctx, enemy.pos);
    const enemyPos = enemy != null ? enemy.pos : -1;
    switch (this.state) {
      case "sleeping":
        return this.actSleeping(ctx, enemyPos, enemyInFOV);
      case "wandering":
        return this.actWandering(ctx, enemyPos, enemyInFOV, justAlerted);
      case "hunting":
        return this.actHunting(ctx, enemy, enemyInFOV);
      case "fleeing":
        return this.actFleeing(ctx, enemyPos, enemyInFOV);
      case "passive":
      default:
        this.enemySeen = false;
        return this.waitCost();
    }
  }
  selectEnemy(ctx) {
    return heroOf(ctx);
  }
  onNotice(_ctx) {}
  notice(ctx) {
    this.onNotice(ctx);
  }
  afterMove(ctx, oldPos) {
    const level = ctx.level;
    const ox = oldPos % level.w;
    const oy = Math.floor(oldPos / level.w);
    if (level.get(ox, oy) === 40 /* OPEN_DOOR */) {
      if (!level.items.some((it) => it.pos === oldPos)) {
        level.set(ox, oy, 2 /* DOOR */);
      }
    }
    if (level.get(this.x, this.y) === 2 /* DOOR */) {
      level.set(this.x, this.y, 40 /* OPEN_DOOR */);
    }
  }
  onDeath(_ctx) {}
  canAttack(_ctx, targetPos) {
    return chebyshevPos(this.pos, targetPos, this.w) <= 1;
  }
  canSee(ctx, pos) {
    const level = ctx.level;
    const out = new Uint8Array(level.w * level.h);
    computeFov(level, (x, y) => level.isOpaque(x, y), this.x, this.y, 8, out);
    return out[pos] === 1;
  }
  actSleeping(ctx, heroPos, enemyInFOV) {
    const rng = ctx.rng;
    if (enemyInFOV) {
      const dist = chebyshevPos(this.pos, heroPos, this.w);
      const hero = heroOf(ctx);
      if (rng.int(0, dist + (hero.flying ? 2 : 0)) === 0) {
        this.enemySeen = true;
        this.onNotice(ctx);
        this.state = "hunting";
        this.target = heroPos;
        return this.waitCost();
      }
    }
    this.enemySeen = false;
    return this.waitCost();
  }
  actWandering(ctx, heroPos, enemyInFOV, justAlerted) {
    const rng = ctx.rng;
    if (enemyInFOV) {
      const dist = chebyshevPos(this.pos, heroPos, this.w);
      if (justAlerted || rng.int(0, Math.floor(dist / 2)) === 0) {
        this.enemySeen = true;
        this.onNotice(ctx);
        this.state = "hunting";
        this.target = heroPos;
        return 0;
      }
    }
    this.enemySeen = false;
    const oldPos = this.pos;
    if (this.target !== -1 && this.getCloser(ctx, this.target)) {
      this.afterMove(ctx, oldPos);
      return this.moveCost();
    }
    this.target = randomDestination(rng, ctx.level);
    return this.waitCost();
  }
  actHunting(ctx, hero, enemyInFOV) {
    this.enemySeen = enemyInFOV;
    if (enemyInFOV && hero != null && this.canAttack(ctx, hero.pos)) {
      return this.doAttack(ctx, hero);
    }
    if (enemyInFOV && hero != null) {
      this.target = hero.pos;
    }
    const oldPos = this.pos;
    if (this.target !== -1 && this.getCloser(ctx, this.target)) {
      this.afterMove(ctx, oldPos);
      return this.moveCost();
    }
    this.state = "wandering";
    this.target = randomDestination(ctx.rng, ctx.level);
    return this.waitCost();
  }
  actFleeing(ctx, heroPos, enemyInFOV) {
    this.enemySeen = enemyInFOV;
    if (enemyInFOV) {
      this.target = heroPos;
    }
    const oldPos = this.pos;
    if (this.target !== -1 && this.getFurther(ctx, this.target)) {
      this.afterMove(ctx, oldPos);
      return this.moveCost();
    }
    this.nowhereToRun(ctx);
    return this.waitCost();
  }
  nowhereToRun(_ctx) {}
  getCloser(ctx, target) {
    if (this.rooted)
      return false;
    const step = stepToward(ctx, this, target % this.w, Math.floor(target / this.w));
    if (step === -1)
      return false;
    this.pos = step;
    return true;
  }
  getFurther(ctx, target) {
    const step = stepAway(ctx, this, target % this.w, Math.floor(target / this.w));
    if (step === -1)
      return false;
    this.pos = step;
    return true;
  }
  doAttack(ctx, hero) {
    strikeMobVsHero(ctx, this, hero, this.def.atk, (rng) => this.mobDamageRoll(rng), (_rng, damage) => this.attackProc(ctx, hero, damage));
    return this.attackCost();
  }
  attackProc(_ctx, _hero, damage) {
    return damage;
  }
  onDamaged(_ctx) {}
}
function rangedCanAttack(ctx, self, targetPos) {
  const level = ctx.level;
  const w = level.w;
  if (targetPos === self.pos)
    return true;
  const x0 = self.pos % w;
  const y0 = Math.floor(self.pos / w);
  const x1 = targetPos % w;
  const y1 = Math.floor(targetPos / w);
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;; ) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    const cell = y * w + x;
    if (cell === self.pos)
      continue;
    if (!level.inBounds(x, y))
      return false;
    if (!level.isPassable(x, y))
      return false;
    if (level.isOpaque(x, y))
      return cell === targetPos;
    if (charAtPos(ctx, cell, self))
      return cell === targetPos;
    if (cell === targetPos)
      return true;
  }
}

class ThiefMob extends ContentMob {
  nowhereToRun(_ctx) {
    this.state = "hunting";
  }
  attackProc(ctx, hero, damage) {
    thiefSteal(ctx, this, hero);
    return damage;
  }
}

class BatMob extends ContentMob {
  defenseVerb() {
    return "evaded";
  }
  attackProc(_ctx, _hero, damage) {
    const reg = Math.min(damage, this.ht - this.hp);
    if (reg > 0)
      this.hp += reg;
    return damage;
  }
}

class ShamanMob extends ContentMob {
  canAttack(ctx, targetPos) {
    return rangedCanAttack(ctx, this, targetPos);
  }
  doAttack(ctx, hero) {
    if (chebyshevPos(this.pos, hero.pos, this.w) > 1) {
      return this.zap(ctx, hero);
    }
    return super.doAttack(ctx, hero);
  }
  zap(ctx, hero) {
    const rng = ctx.rng;
    if (hitRoll(rng, this.def.atk, heroDefenseSkill(hero), true)) {
      let dmg = rng.int(2, 12);
      if (ctx.level.getAt(hero.pos) === 9 /* WATER */ && !hero.flying) {
        dmg = Math.floor(dmg * 1.5);
      }
      const applied = applyDamage(rng, {
        hp: hero.hp,
        ht: hero.ht,
        paralysed: hero.paralysed,
        immunities: [],
        resistances: []
      }, dmg, "lightning");
      hero.hp = applied.hp;
      if (applied.paralysisBroken) {
        hero.paralysed = false;
        delete hero.buffs.paralysis;
      }
      ctx.log(`The ${this.name}'s lightning hits you for ${dmg}.`);
      if (applied.died) {
        ctx.log(`${this.name}'s lightning bolt killed you...`);
      }
    } else {
      ctx.log(`The ${this.name}'s lightning misses you.`);
    }
    return 2 * this.getSpeed();
  }
}

class BruteMob extends ContentMob {
  enraged = false;
  enrageDebt = 0;
  mobDamageRoll(rng) {
    return this.enraged ? rng.normalIntRange(10, 40) : rng.normalIntRange(8, 18);
  }
  onDamaged(ctx) {
    if (this.isAlive() && !this.enraged && this.hp < Math.floor(this.ht / 4)) {
      this.enraged = true;
      this.enrageDebt = 1;
      if (ctx.level.visible[this.pos]) {
        ctx.log(`${this.name} becomes enraged!`);
      }
    }
  }
  takeTurn(ctx) {
    const cost = super.takeTurn(ctx);
    if (this.enrageDebt > 0) {
      this.enrageDebt = 0;
      return cost + 1;
    }
    return cost;
  }
}

class ShieldedMob extends BruteMob {
  defenseVerb() {
    return "blocked";
  }
}

class AlbinoMob extends ContentMob {
  attackProc(ctx, hero, damage) {
    if (ctx.rng.int(0, 2) === 0) {
      hero.buffs.bleeding = { kind: "bleeding", left: 0, level: damage };
    }
    return damage;
  }
}

class BanditMob extends ThiefMob {
  attackProc(ctx, hero, damage) {
    if (thiefSteal(ctx, this, hero)) {
      const left = ctx.rng.int(5, 12);
      const cur = hero.buffs.blindness?.left ?? 0;
      hero.buffs.blindness = { kind: "blindness", left: Math.max(cur, left) };
    }
    return damage;
  }
}

class SpinnerMob extends ContentMob {
  attackProc(ctx, hero, damage) {
    if (ctx.rng.int(0, 2) === 0) {
      hero.buffs.poison = {
        kind: "poison",
        left: ctx.rng.int(7, 9) * 1
      };
      this.state = "fleeing";
    }
    return damage;
  }
  afterMove(ctx, oldPos) {
    if (this.state === "fleeing") {
      seedBlob(ctx.level.blobs, "web", oldPos, ctx.rng.int(5, 7), ctx.level.w * ctx.level.h);
    }
    super.afterMove(ctx, oldPos);
  }
  nowhereToRun(_ctx) {
    this.state = "hunting";
  }
  takeTurn(ctx) {
    const cost = super.takeTurn(ctx);
    if (this.state === "fleeing" && this.enemySeen) {
      const hero = heroOf(ctx);
      if (hero.isAlive() && !hero.buffs.poison) {
        this.state = "hunting";
      }
    }
    return cost;
  }
}

class ElementalMob extends ContentMob {
  attackProc(_ctx, hero, damage) {
    if (_ctx.rng.int(0, 2) === 0) {
      hero.buffs.burning = { kind: "burning", left: 8 };
    }
    return damage;
  }
}

class MonkMob extends ContentMob {
  defenseVerb() {
    return "parried";
  }
  attackProc(ctx, hero, damage) {
    if (ctx.rng.int(0, 6) === 0 && hero.weaponId !== null && hero.weaponId !== "knuckles") {
      const def = getItem(hero.weaponId);
      dropItemAt(ctx, hero.pos, hero.weaponId);
      hero.weapon = null;
      hero.weaponId = null;
      ctx.log(`${this.name} has knocked the ${def.name} from your hands!`);
    }
    return damage;
  }
}
function buildMob(mobId, id, pos, w, depth = 0) {
  if (mobId === "goo") {
    const ctor = gooCtor;
    if (!ctor)
      throw new Error("goo-boss not registered (import src/content/goo-boss.js)");
    return new ctor(id, pos, w);
  }
  if (npcBuilder) {
    const npc = npcBuilder(mobId, id, pos, w, depth);
    if (npc)
      return npc;
  }
  if (mobId === "tengu") {
    const ctor = tenguCtor;
    if (!ctor)
      throw new Error("tengu-boss not registered (import src/content/tengu-boss.js)");
    return new ctor(id, pos, w);
  }
  if (mobId === "dm300") {
    const ctor = dm300Ctor;
    if (!ctor)
      throw new Error("dm300-boss not registered (import src/content/dm300-boss.js)");
    return new ctor(id, pos, w);
  }
  const def = MOB_DEFS[mobId];
  if (!def)
    throw new Error(`unknown mob id: ${mobId}`);
  switch (mobId) {
    case "thief":
      return new ThiefMob(id, def, pos, w);
    case "shaman":
      return new ShamanMob(id, def, pos, w);
    case "bat":
      return new BatMob(id, def, pos, w);
    case "brute":
      return new BruteMob(id, def, pos, w);
    case "albino":
      return new AlbinoMob(id, def, pos, w);
    case "bandit":
      return new BanditMob(id, def, pos, w);
    case "shielded":
      return new ShieldedMob(id, def, pos, w);
    case "spinner":
      return new SpinnerMob(id, def, pos, w);
    case "elemental":
      return new ElementalMob(id, def, pos, w);
    case "monk":
      return new MonkMob(id, def, pos, w);
    default:
      return new ContentMob(id, def, pos, w);
  }
}
var gooCtor = null;
function registerGoo(ctor) {
  gooCtor = ctor;
}
var tenguCtor = null;
function registerTengu(ctor) {
  tenguCtor = ctor;
}
var dm300Ctor = null;
function registerDM300(ctor) {
  dm300Ctor = ctor;
}
var npcBuilder = null;
function registerNpcBuilder(builder) {
  npcBuilder = builder;
}
var sewersKillHook = null;
function registerSewersKillHook(fn) {
  sewersKillHook = fn;
}
function thiefSteal(ctx, thief, hero) {
  if (thief.stolen)
    return false;
  if (hero.inventory.length === 0)
    return false;
  const i = ctx.rng.int(0, hero.inventory.length);
  const stack = hero.inventory.splice(i, 1)[0];
  thief.stolen = { ...stack };
  ctx.log(`The ${thief.name} stole ${stackLabel(stack)} from you!`);
  thief.state = "fleeing";
  return true;
}
function stackLabel(stack) {
  const def = getItem(stack.itemId);
  return stack.qty > 1 ? `${stack.qty}x ${def.name}` : `your ${def.name}`;
}
function mobDefenseProc(ctx, mob, damage) {
  if (mob.def.ability === "swarm" && mob.isAlive() && mob.hp >= damage + 2) {
    const cell = findSplitCell(ctx, mob);
    if (cell !== -1) {
      const clone = new ContentMob(nextMobId(), mob.def, cell, ctx.level.w);
      clone.hp = Math.floor((mob.hp - damage) / 2);
      clone.state = "hunting";
      clone.generation = mob.generation + 1;
      if (mob.buffs.burning)
        clone.buffs.burning = { kind: "burning", left: 8 };
      if (mob.buffs.poison)
        clone.buffs.poison = { kind: "poison", left: 2 };
      mob.hp -= clone.hp;
      ctx.addMob(clone, 1);
    }
  }
  if (mob.def.ability === "thief" && mob.state === "fleeing") {
    dropItemAt(ctx, mob.pos, "gold:1");
  }
  if (mob.def.ability === "fetidrat") {
    seedBlob(ctx.level.blobs, "paralytic", mob.pos, 20, ctx.level.w * ctx.level.h);
  }
  return damage;
}
function findSplitCell(ctx, mob) {
  const level = ctx.level;
  const w = level.w;
  const x = mob.x;
  const y = mob.y;
  const candidates = [];
  const n4 = [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1]
  ];
  for (const [nx, ny] of n4) {
    const pos = ny * w + nx;
    if (tileWalkableFor(level, nx, ny) && !charAtPos(ctx, pos, mob)) {
      candidates.push(pos);
    }
  }
  if (candidates.length === 0)
    return -1;
  return ctx.rng.pick(candidates);
}
function damageMobDirect(ctx, mob, amount, sourceTag) {
  if (!mob.isAlive())
    return;
  if (mob.invulnerable)
    return;
  if (mob.state === "sleeping")
    mob.state = "wandering";
  mob.justAlerted = true;
  const applied = applyDamage(ctx.rng, {
    hp: mob.hp,
    ht: mob.ht,
    paralysed: mob.paralysed,
    immunities: mob.immunities,
    resistances: mob.resistances
  }, amount, sourceTag);
  mob.hp = applied.hp;
  if (applied.paralysisBroken) {
    mob.paralysed = false;
    delete mob.buffs.paralysis;
  }
  if (applied.died) {
    killMob(ctx, mob, {});
  } else {
    mob.onDamaged(ctx);
  }
}
function killMob(ctx, mob, _opts) {
  const hero = heroOf(ctx);
  const wasAlive = hero.isAlive();
  if (mob.def.id === "rat" || mob.def.id === "gnoll" || mob.def.id === "crab" || mob.def.id === "albino") {
    sewersKillHook?.(ctx, mob.pos);
  }
  if (wasAlive) {
    const exp = expForKill(mob.def.id, hero.lvl);
    if (exp > 0) {
      const gained = earnExp(hero, exp);
      ctx.log(`+${exp} EXP`);
      if (gained > 0)
        ctx.log(`You level up! Welcome to level ${hero.lvl}.`);
    }
  }
  if (hero.lvl <= mob.def.maxLvl + 2) {
    rollMobLoot(ctx, mob);
  }
  if (mob.stolen) {
    dropItemAt(ctx, mob.pos, mob.stolen.itemId);
    mob.stolen = null;
  }
  mob.onDeath(ctx);
  if (mob.def.ability === "skeleton") {
    skeletonBurst(ctx, mob);
  }
  ctx.log(`The ${mob.name} dies.`);
  ctx.killMob(mob);
}
function skeletonBurst(ctx, mob) {
  const level = ctx.level;
  const w = level.w;
  const hero = heroOf(ctx);
  for (let dy = -1;dy <= 1; dy++) {
    for (let dx = -1;dx <= 1; dx++) {
      if (dx === 0 && dy === 0)
        continue;
      const nx = mob.x + dx;
      const ny = mob.y + dy;
      if (!level.inBounds(nx, ny))
        continue;
      const ch = charAtPos(ctx, ny * w + nx);
      if (!ch || !ch.isAlive())
        continue;
      const victimDr = ch === hero ? heroDR(ch) : ch.def.dr;
      const dmg = skeletonDeathBurst(ctx.rng, (r) => mob.mobDamageRoll(r), victimDr);
      if (dmg <= 0)
        continue;
      if (ch === hero) {
        const applied = applyDamage(ctx.rng, { hp: hero.hp, ht: hero.ht, paralysed: hero.paralysed, immunities: [], resistances: [] }, dmg);
        hero.hp = applied.hp;
        ctx.log(`The skeleton's explosion hits you for ${dmg}.`);
        if (applied.died)
          ctx.log("You were killed by the explosion of bones...");
      } else {
        damageMobDirect(ctx, ch, dmg);
      }
    }
  }
}
function rollMobLoot(ctx, mob) {
  const rng = ctx.rng;
  const depth = ctx.level.depth;
  switch (mob.def.id) {
    case "gnoll":
      if (rng.float(0, 1) < 0.5) {
        dropItemAt(ctx, mob.pos, `gold:${rng.intRange(20 + depth * 10, 40 + depth * 20)}`);
      }
      break;
    case "swarm":
      if (rng.int(0, 5 * (mob.generation + 1)) === 0) {
        dropItemAt(ctx, mob.pos, "potion_healing");
      }
      break;
    case "skeleton": {
      if (rng.int(0, 5) === 0) {
        dropItemAt(ctx, mob.pos, skeletonWeaponDrop(rng, depth, itemGenerator));
      }
      break;
    }
    case "crab":
      if (rng.float(0, 1) < 0.167) {
        dropItemAt(ctx, mob.pos, "ration");
      }
      break;
    case "shaman": {
      if (rng.float(0, 1) < 0.33) {
        dropItemAt(ctx, mob.pos, itemGenerator.randomFrom(rng, "scroll", depth));
      }
      break;
    }
    case "bat":
      if (rng.float(0, 1) < 0.125) {
        dropItemAt(ctx, mob.pos, "potion_healing");
      }
      break;
    case "brute":
    case "shielded":
      if (rng.float(0, 1) < 0.5) {
        dropItemAt(ctx, mob.pos, `gold:${rng.intRange(20 + depth * 10, 40 + depth * 20)}`);
      }
      break;
    case "spinner":
      if (rng.float(0, 1) < 0.125) {
        dropItemAt(ctx, mob.pos, "ration");
      }
      break;
    case "elemental":
      if (rng.float(0, 1) < 0.1 && ITEMS["potion_liquid_flame"]) {
        dropItemAt(ctx, mob.pos, "potion_liquid_flame");
      }
      break;
    case "monk":
      if (rng.float(0, 1) < 0.083) {
        dropItemAt(ctx, mob.pos, "ration");
      }
      break;
    case "dm300":
      if (rng.float(0, 1) < 0.333 && ITEMS["ring_of_thorns"]) {
        dropItemAt(ctx, mob.pos, "ring_of_thorns");
      }
      break;
    default:
      break;
  }
}
function combatProcFx(ctx) {
  const level = ctx.level;
  const hero = heroOf(ctx);
  const charAtPos2 = (pos) => {
    if (hero.pos === pos && hero.isAlive())
      return hero;
    const m = ctx.mobs.find((mm) => mm.pos === pos && mm.isAlive());
    return m ?? null;
  };
  const unoccupied = (pos) => !(hero.isAlive() && hero.pos === pos) && !ctx.mobs.some((mm) => mm.isAlive() && mm.pos === pos);
  return {
    rng: ctx.rng,
    log: (msg) => ctx.log(msg),
    directDamage: (target, amount, source) => {
      if (target.hp <= 0)
        return;
      delete target.buffs.frost;
      const applied = applyDamage(ctx.rng, {
        hp: target.hp,
        ht: target.ht,
        paralysed: target.buffs.paralysis !== undefined,
        immunities: target.immunities,
        resistances: target.resistances
      }, amount, source);
      target.hp = applied.hp;
      if (applied.paralysisBroken) {
        delete target.buffs.paralysis;
      }
    },
    heal: (target, amount) => {
      const before = target.hp;
      target.hp = Math.min(target.ht, target.hp + amount);
      return target.hp - before;
    },
    attackerDamageRoll: (attacker) => {
      if (attacker.kind === "hero") {
        return heroDamageRoll(ctx.rng, hero, { ranged: false });
      }
      const mob = attacker;
      return ctx.rng.intRange(mob.def.dmgMin, mob.def.dmgMax);
    },
    showStatus: (_target, _text) => {},
    isWater: (pos) => level.getAt(pos) === 9 /* WATER */,
    charsAround: (pos) => {
      const { x, y } = level.xy(pos);
      const out = [];
      for (let dy = -1;dy <= 1; dy++) {
        for (let dx = -1;dx <= 1; dx++) {
          if (dx === 0 && dy === 0)
            continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h)
            continue;
          const ch = charAtPos2(ny * level.w + nx);
          if (ch)
            out.push(ch);
        }
      }
      return out;
    },
    isFreeCell: (pos) => {
      const { x, y } = level.xy(pos);
      return level.isPassable(x, y) && unoccupied(pos);
    },
    isVisible: (pos) => level.visible[pos] === 1,
    isBossLevel: () => level.bossLevel,
    teleport: (ch, pos) => {
      ch.pos = pos;
    },
    pressCell: (ch) => {
      const noop = () => {
        return;
      };
      if (ch.kind === "hero") {
        pressTrapCell(ctx, ch.pos, hero, noop);
      } else {
        mobPressTrapCell(ctx, ch, noop);
      }
    },
    seedGas: (pos, amount) => {
      seedBlob(level.blobs, "toxic", pos, amount, level.w * level.h);
    },
    spawnMirrorImage: (_heroChar) => {
      return false;
    },
    spendGold: (amount) => {
      if (hero.gold < amount)
        return false;
      hero.gold -= amount;
      return true;
    },
    polishHeroArmor: () => {},
    addHunger: (amount) => {
      hero.hungerLevel = satisfy(hero.hungerLevel, -amount);
    },
    isStarving: () => isStarving(hero.hungerLevel)
  };
}
function strikeHeroVsMob(ctx, hero, mob, accuracy, damageRoll) {
  const rng = ctx.rng;
  const seq = runAttackSequence(rng, {
    accuracy,
    evasion: mob.mobDefenseSkill(),
    defenderDr: mob.def.dr,
    damageRoll,
    onAttackProc: (_r, dmg) => {
      const wep = hero.rangedWeapon ?? hero.weapon;
      if (wep) {
        if (wep === hero.weapon && hero.weaponId === "pickaxe") {} else {
          const fx = combatProcFx(ctx);
          weaponAttackProc(fx, hero, mob, dmg, wep);
        }
      }
      return dmg;
    },
    onDefenseProc: (_r, dmg) => mobDefenseProc(ctx, mob, dmg)
  });
  if (!seq.hit) {
    ctx.log(`The ${mob.name} ${mob.defenseVerb()} your attack.`);
    return;
  }
  if (mob.invulnerable) {
    ctx.log(`You hit the ${mob.name}, but do no damage.`);
    return;
  }
  const applied = applyDamage(rng, {
    hp: mob.hp,
    ht: mob.ht,
    paralysed: mob.paralysed,
    immunities: mob.immunities,
    resistances: mob.resistances
  }, seq.damageDealt);
  mob.hp = applied.hp;
  if (applied.paralysisBroken) {
    mob.paralysed = false;
    delete mob.buffs.paralysis;
  }
  if (mob.state === "sleeping")
    mob.state = "wandering";
  mob.justAlerted = true;
  ctx.log(seq.damageDealt > 0 ? `You hit the ${mob.name} for ${seq.damageDealt}.` : `You hit the ${mob.name}, but do no damage.`);
  if (applied.died) {
    killMob(ctx, mob, {});
    if (mob.def.id === "bat" && hero.weaponId === "pickaxe" && hero.weapon) {
      hero.weapon.bloodStained = true;
    }
  } else {
    mob.onDamaged(ctx);
  }
}
function strikeMobVsHero(ctx, mob, hero, accuracy, damageRoll, onAttackProc) {
  const rng = ctx.rng;
  const seq = runAttackSequence(rng, {
    accuracy,
    evasion: heroDefenseSkill(hero),
    defenderDr: heroDR(hero),
    damageRoll,
    onAttackProc,
    onDefenseProc: (_r, dmg) => {
      if (!hero.armor)
        return dmg;
      return armorDefenseProc(combatProcFx(ctx), hero.armor, mob, hero, dmg, ctx.level.w, ctx.level.h);
    }
  });
  if (!seq.hit) {
    ctx.log(`The ${mob.name} misses you.`);
    return;
  }
  const applied = applyDamage(rng, { hp: hero.hp, ht: hero.ht, paralysed: hero.paralysed, immunities: [], resistances: [] }, seq.damageDealt);
  hero.hp = applied.hp;
  if (applied.paralysisBroken) {
    hero.paralysed = false;
    delete hero.buffs.paralysis;
  }
  ctx.log(seq.damageDealt > 0 ? `The ${mob.name} hits you for ${seq.damageDealt}.` : `The ${mob.name} hits you, but does no damage.`);
  if (applied.died)
    ctx.log(`You were killed by the ${mob.name}...`);
  if (!mob.isAlive()) {
    killMob(ctx, mob, {});
  }
}

class MirrorImageMob extends ContentMob {
  constructor(id, pos, w, stats) {
    super(id, {
      id: "mirrorimage",
      name: "mirror image",
      sprite: "mirror_image",
      hp: 1,
      atk: stats.attackSkill,
      def: 0,
      dmgMin: stats.damage,
      dmgMax: stats.damage,
      triangular: false,
      dr: 0,
      exp: 0,
      maxLvl: 0,
      speed: 1,
      flying: false,
      ability: null,
      attackDelay: 1,
      immunities: [],
      resistances: []
    }, pos, w);
    this.hostile = false;
    this.state = "hunting";
  }
  shatterAfterAttack() {
    this.hp = 0;
  }
}

// src/mechanics/rings.ts
var RING_SPECS = [
  {
    id: "mending",
    javaClass: "RingOfMending",
    name: "Ring of Mending",
    desc: "This ring increases the body's regenerative properties, allowing " + "one to recover lost health at an accelerated rate. Degraded rings will " + "decrease or even halt one's natural regeneration.",
    spriteKey: "item_ring_mending",
    buffKind: "ring_mending"
  },
  {
    id: "detection",
    javaClass: "RingOfDetection",
    name: "Ring of Detection",
    desc: "Wearing this ring will allow the wearer to notice hidden secrets - " + "traps and secret doors - without taking time to search. Degraded rings of detection " + "will dull your senses, making it harder to notice secrets even when actively searching for them.",
    spriteKey: "item_ring_detection",
    buffKind: "ring_detection"
  },
  {
    id: "shadows",
    javaClass: "RingOfShadows",
    name: "Ring of Shadows",
    desc: "Enemies will be less likely to notice you if you wear this ring. Degraded rings " + "of shadows will alert enemies who might otherwise not have noticed your presence.",
    spriteKey: "item_ring_shadows",
    buffKind: "ring_shadows"
  },
  {
    id: "power",
    javaClass: "RingOfPower",
    name: "Ring of Power",
    desc: "Your wands will become more powerful in the energy field " + "that radiates from this ring. Degraded rings of power will instead weaken your wands.",
    spriteKey: "item_ring_power",
    buffKind: "ring_power"
  },
  {
    id: "herbalism",
    javaClass: "RingOfHerbalism",
    name: "Ring of Herbalism",
    desc: "This ring increases your chance to gather dew and seeds from trampled grass.",
    spriteKey: "item_ring_herbalism",
    buffKind: "ring_herbalism"
  },
  {
    id: "accuracy",
    javaClass: "RingOfAccuracy",
    name: "Ring of Accuracy",
    desc: "This ring increases your chance to hit the enemy.",
    spriteKey: "item_ring_accuracy",
    buffKind: "ring_accuracy"
  },
  {
    id: "evasion",
    javaClass: "RingOfEvasion",
    name: "Ring of Evasion",
    desc: "This ring increases your chance to dodge enemy attack.",
    spriteKey: "item_ring_evasion",
    buffKind: "ring_evasion"
  },
  {
    id: "satiety",
    javaClass: "RingOfSatiety",
    name: "Ring of Satiety",
    desc: "Wearing this ring you can go without food longer. Degraded rings of satiety will cause the opposite effect.",
    spriteKey: "item_ring_satiety",
    buffKind: "ring_satiety"
  },
  {
    id: "haste",
    javaClass: "RingOfHaste",
    name: "Ring of Haste",
    desc: "This ring accelerates the wearer's flow of time, allowing one to perform all actions a little faster.",
    spriteKey: "item_ring_haste",
    buffKind: "ring_haste"
  },
  {
    id: "haggler",
    javaClass: "RingOfHaggler",
    name: "Ring of Haggler",
    desc: "In fact this ring doesn't provide any magic effect, but it demonstrates " + "to shopkeepers and vendors, that the owner of the ring is a member of " + "The Thieves' Guild. Usually they are glad to give a discount in exchange " + "for temporary immunity guarantee. Upgrading this ring won't give any additional " + "bonuses.",
    spriteKey: "item_ring_haggler",
    buffKind: "ring_haggler",
    fixedPlusOne: true
  },
  {
    id: "elements",
    javaClass: "RingOfElements",
    name: "Ring of Elements",
    desc: "This ring provides resistance to different elements, such as fire, " + "electricity, gases etc. Also it decreases duration of negative effects.",
    spriteKey: "item_ring_elements",
    buffKind: "ring_elements"
  },
  {
    id: "thorns",
    javaClass: "RingOfThorns",
    name: "Ring of Thorns",
    desc: "Though this ring doesn't provide real thorns, an enemy that attacks you " + "will itself be wounded by a fraction of the damage that it inflicts. " + "Upgrading this ring won't give any additional bonuses.",
    spriteKey: "item_ring_thorns",
    buffKind: "ring_thorns",
    fixedPlusOne: true
  }
];

// src/content/rings.ts
function ringSpec(id) {
  const spec = RING_SPECS.find((s) => s.id === id);
  if (!spec)
    throw new Error(`unknown ring id: ${id}`);
  return spec;
}
var RING_GEMS = [
  "diamond",
  "opal",
  "garnet",
  "ruby",
  "amethyst",
  "topaz",
  "onyx",
  "tourmaline",
  "emerald",
  "sapphire",
  "quartz",
  "agate"
];
var RING_PRICE_BASE = 80;
var ringStates = new Map;
function parseRingId(itemId) {
  const hash = itemId.indexOf("#");
  const base = hash === -1 ? itemId : itemId.slice(0, hash);
  if (!base.startsWith("ring_of_"))
    return null;
  const ringId = base.slice("ring_of_".length);
  if (!RING_SPECS.some((s) => s.id === ringId))
    return null;
  return { ringId, instanceId: hash === -1 ? null : itemId };
}
function isRingId(itemId) {
  return parseRingId(itemId) !== null;
}
function ringEffectiveLevel(state) {
  return state.level;
}
var localGemLabels = new Map;
var localKnown = new Set;
function ensureLocalLabels(rng) {
  if (localGemLabels.size > 0)
    return;
  const gems = [...RING_GEMS];
  const r = rng ?? { float: (a, b) => a + Math.random() * (b - a) };
  for (let i = gems.length - 1;i > 0; i--) {
    const j = Math.floor(r.float(0, i + 1));
    [gems[i], gems[j]] = [gems[j], gems[i]];
  }
  RING_SPECS.forEach((spec, i) => localGemLabels.set(spec.javaClass, gems[i]));
}
function isRingTypeKnown(ringId) {
  const spec = ringSpec(ringId);
  ensureLocalLabels();
  return localKnown.has(spec.javaClass);
}
function ringGemLabel(ringId) {
  ensureLocalLabels();
  return localGemLabels.get(ringSpec(ringId).javaClass) ?? "diamond";
}
function registerRingIdClasses() {
  registerRingClasses({
    classes: RING_SPECS.map((s) => s.javaClass),
    labels: RING_GEMS,
    images: RING_SPECS.map((s) => s.spriteKey)
  });
}
function ringDisplayName(ringId) {
  const spec = ringSpec(ringId);
  if (isRingTypeKnown(ringId))
    return spec.name;
  return `${ringGemLabel(ringId)} ring`;
}
function ringDisplayDesc(ringId) {
  const spec = ringSpec(ringId);
  if (isRingTypeKnown(ringId))
    return spec.desc;
  return `This metal band is adorned with a large ${ringGemLabel(ringId)} gem ` + "that glitters in the darkness. Who knows what effect it has when worn?";
}
function ringDisplaySprite(ringId) {
  const spec = ringSpec(ringId);
  if (isRingTypeKnown(ringId))
    return spec.spriteKey;
  return spec.spriteKey;
}
function ringPrice(state) {
  let price = RING_PRICE_BASE;
  if (state.cursed && state.cursedKnown)
    price = Math.floor(price / 2);
  const levelKnown = isRingTypeKnown(state.ringId);
  const level = ringEffectiveLevel(state);
  if (levelKnown) {
    if (level > 0) {
      price *= level + 1;
    } else if (level < 0) {
      price = Math.floor(price / (1 - level));
    }
  }
  return Math.max(1, price);
}
function ringItemDefFor(defId) {
  const parsed = parseRingId(defId);
  if (!parsed || !parsed.instanceId)
    return null;
  const st = ringStates.get(parsed.instanceId);
  if (!st)
    return null;
  return {
    id: parsed.instanceId,
    name: ringDisplayName(st.ringId),
    desc: ringDisplayDesc(st.ringId),
    sprite: ringDisplaySprite(st.ringId),
    type: "misc",
    stackable: false,
    price: ringPrice(st)
  };
}
registerRingIdClasses();

// src/content/wands.ts
var wandStates = new Map;
var wandSeq = 0;
function registerWandIdClasses() {
  const randomized = WAND_SPECS.filter((s) => s.id !== "magic_missile");
  registerWandClasses({
    classes: randomized.map((s) => s.className),
    labels: WAND_WOODS,
    images: randomized.map((s) => s.sprite)
  });
}
function parseWandId(itemId) {
  const hash = itemId.indexOf("#");
  const base = hash === -1 ? itemId : itemId.slice(0, hash);
  if (!base.startsWith("wand_of_"))
    return null;
  const wandId = base.slice("wand_of_".length);
  if (!WAND_SPECS.some((s) => s.id === wandId))
    return null;
  return {
    wandId,
    instanceId: hash === -1 ? null : itemId
  };
}
function isWandId(itemId) {
  return parseWandId(itemId) !== null;
}
function getWandState(instanceId) {
  return wandStates.get(instanceId);
}
function createWand(rng, wandId, opts = {}) {
  const spec = wandSpec(wandId);
  const instanceId = `wand_of_${wandId}#${++wandSeq}`;
  let level = 0;
  if (opts.randomize) {
    if (rng.float(0, 1) < 0.5) {
      level++;
      if (rng.float(0, 1) < 0.15)
        level++;
    }
  }
  level += opts.upgrades ?? 0;
  const maxCharges = wandMaxCharges(spec.initialCharges, level);
  wandStates.set(instanceId, {
    instanceId,
    wandId,
    level,
    levelKnown: false,
    cursed: false,
    cursedKnown: false,
    curCharges: maxCharges,
    maxCharges,
    usagesToKnow: USAGES_TO_KNOW,
    chargeKnown: false,
    rechargeAcc: 0
  });
  return instanceId;
}
var WAND_WOODS = [
  "holly",
  "yew",
  "ebony",
  "cherry",
  "teak",
  "rowan",
  "ash",
  "birch",
  "willow",
  "oak",
  "elm",
  "elder"
];
function wandDisplayName(wandId) {
  const spec = wandSpec(wandId);
  if (spec.wood === null)
    return spec.name;
  if (isWandKnown(spec.className))
    return spec.name;
  return `${wandLabel(spec.className)} wand`;
}
function wandDisplayDesc(wandId) {
  const spec = wandSpec(wandId);
  if (spec.wood === null || isWandKnown(spec.className))
    return spec.desc;
  return "This wand is of a type you don’t know yet.";
}
function wandDisplaySprite(wandId) {
  const spec = wandSpec(wandId);
  if (spec.wood === null)
    return spec.sprite;
  if (isWandKnown(spec.className))
    return spec.sprite;
  return wandImage(spec.className);
}
function wandPrice(state) {
  let price = 50;
  if (state.cursed && state.cursedKnown)
    price = Math.floor(price / 2);
  if (state.levelKnown) {
    if (state.level > 0) {
      price *= state.level + 1;
    } else if (state.level < 0) {
      price = Math.floor(price / (1 - state.level));
    }
  }
  return Math.max(1, price);
}
function wandItemDef(instanceId) {
  const parsed = parseWandId(instanceId);
  if (!parsed || !parsed.instanceId)
    return null;
  const st = wandStates.get(parsed.instanceId);
  if (!st)
    return null;
  const spec = wandSpec(st.wandId);
  return {
    id: parsed.instanceId,
    name: wandDisplayName(st.wandId),
    desc: wandDisplayDesc(st.wandId),
    sprite: wandDisplaySprite(st.wandId),
    type: "misc",
    stackable: false,
    price: wandPrice(st)
  };
}
function identifyWandType(wandId, log = () => {}) {
  const spec = wandSpec(wandId);
  if (spec.wood === null || isWandKnown(spec.className))
    return;
  knowWand(spec.className);
  log(txtWandIdentified(spec.name));
}
function createWandReward(rng, wandId) {
  return createWand(rng, wandId, { randomize: true, upgrades: 1 });
}
var sheepLifespans = new Map;
registerWandIdClasses();
function instanceItemDef(defId) {
  if (defId.startsWith("wand_of_"))
    return wandItemDef(defId);
  return ringItemDefFor(defId);
}

// src/content/hero.ts
class ContentHero extends Actor {
  kind = "hero";
  id = 0;
  pos;
  w;
  hp = 20;
  ht = 20;
  sprite = "hero_warrior";
  name = "you";
  sight = 8;
  paralysed = false;
  rooted = false;
  flying = false;
  buffs = {};
  immunities = [];
  resistances = [];
  str = 11;
  weakened = false;
  lvl = 1;
  exp = 0;
  attackSkill = 10;
  defenseSkill = 5;
  awareness = 0.1;
  weapon = null;
  weaponId = null;
  armor = null;
  armorId = null;
  rangedWeapon = null;
  darts = 0;
  inventory = [];
  gold = 0;
  hungerLevel = 0;
  hungerClock = 0;
  constructor(pos, w) {
    super();
    this.pos = pos;
    this.w = w;
  }
  get x() {
    return this.pos % this.w;
  }
  set x(v) {
    this.pos = this.y * this.w + v;
  }
  get y() {
    return Math.floor(this.pos / this.w);
  }
  set y(v) {
    this.pos = v * this.w + this.x;
  }
  getSpeed() {
    return heroSpeed(this);
  }
  getTimeScale() {
    return charTimeScale(this);
  }
  isAlive() {
    return this.hp > 0;
  }
  act() {
    throw new Error("ContentHero.act: route through MechanicsHooks.handleHeroIntent");
  }
}
function createStarterHero(pos, w) {
  const hero = new ContentHero(pos, w);
  const sword = getItem("shortsword");
  const armor = getItem("cloth_armor");
  hero.weapon = sword.weapon ? { ...sword.weapon } : null;
  hero.weaponId = "shortsword";
  hero.armor = armor.armor ? { ...armor.armor } : null;
  hero.armorId = "cloth_armor";
  hero.inventory.push({ itemId: "ration", qty: 1 });
  hero.inventory.push({ itemId: "dart", qty: 8 });
  syncDarts(hero);
  return hero;
}
function syncDarts(hero) {
  hero.darts = hero.inventory.find((s) => s.itemId === "dart")?.qty ?? 0;
}
function addToInventory(hero, itemId, qty, gear) {
  const def = instanceItemDef(itemId) ?? getItem(itemId);
  if (qty <= 0)
    return;
  if (def.stackable) {
    const existing = hero.inventory.find((s) => s.itemId === itemId);
    if (existing) {
      existing.qty += qty;
    } else {
      hero.inventory.push({ itemId, qty });
    }
  } else {
    for (let i = 0;i < qty; i++) {
      const stack = { itemId, qty: 1 };
      if (def.weapon || def.armor) {
        const inst = gear && i === 0 ? gear : {
          weapon: def.weapon ? { ...def.weapon } : undefined,
          armor: def.armor ? { ...def.armor } : undefined
        };
        if (inst.weapon && inst.weapon.durability === undefined) {
          initDurability(inst.weapon, "weapon");
        }
        if (inst.armor && inst.armor.durability === undefined) {
          initDurability(inst.armor, "armor");
        }
        stack.gear = inst;
      }
      hero.inventory.push(stack);
    }
  }
  syncDarts(hero);
}
function ensureStackGear(stack) {
  const def = getItem(stack.itemId);
  if (!def.weapon && !def.armor)
    return null;
  if (!stack.gear) {
    stack.gear = {
      weapon: def.weapon ? { ...def.weapon } : undefined,
      armor: def.armor ? { ...def.armor } : undefined
    };
  }
  const g = stack.gear;
  if (g.weapon && g.weapon.durability === undefined) {
    initDurability(g.weapon, "weapon");
  }
  if (g.armor && g.armor.durability === undefined) {
    initDurability(g.armor, "armor");
  }
  return g;
}
function removeFromInventory(hero, slot, qty = 1) {
  const stack = hero.inventory[slot];
  if (!stack || qty <= 0)
    return null;
  const take = Math.min(qty, stack.qty);
  const removed = { itemId: stack.itemId, qty: take };
  if (stack.gear && take >= stack.qty) {
    removed.gear = stack.gear;
  }
  stack.qty -= take;
  if (stack.qty <= 0) {
    hero.inventory.splice(slot, 1);
  }
  syncDarts(hero);
  return removed;
}

// src/content/potions.ts
function affectBuff2(buffs, kind, duration) {
  const cur = buffs[kind];
  buffs[kind] = cur ? { ...cur, left: cur.left + duration } : { kind, left: duration };
}
function prolongBuff2(buffs, kind, duration, extra) {
  const cur = buffs[kind];
  const next = cur ? { ...cur, left: Math.max(cur.left, duration) } : { kind, left: duration };
  if (extra?.sourceId !== undefined)
    next.sourceId = extra.sourceId;
  buffs[kind] = next;
}
var POTION_CLASS_ORDER = [
  "potion_healing",
  "potion_experience",
  "potion_toxicgas",
  "potion_liquidflame",
  "potion_strength",
  "potion_paralyticgas",
  "potion_levitation",
  "potion_mindvision",
  "potion_purity",
  "potion_invisibility",
  "potion_might",
  "potion_frost"
];
var POTION_ID_SET = new Set(POTION_CLASS_ORDER);
function isPotionId(id) {
  return POTION_ID_SET.has(id);
}
function def(id, name, sprite, desc) {
  return {
    id,
    name,
    sprite,
    type: "potion",
    stackable: true,
    desc,
    price: 20
  };
}
var POTION_DEFS = {
  potion_experience: def("potion_experience", "Potion of Experience", "item_potion_experience", "The storied experiences of multitudes of battles reduced to vapours, " + "this draught will instantly raise your experience level."),
  potion_toxicgas: def("potion_toxicgas", "Potion of Toxic Gas", "item_potion_toxicgas", "Uncorking or shattering this pressurized glass will cause its contents " + "to explode into a deadly cloud of toxic green gas. You might choose " + "to fling this potion at distant enemies instead of uncorking it by hand."),
  potion_liquidflame: def("potion_liquidflame", "Potion of Liquid Flame", "item_potion_liquidflame", "This flask contains an unstable compound which will burst violently " + "into flame upon exposure to open air."),
  potion_paralyticgas: def("potion_paralyticgas", "Potion of Paralytic Gas", "item_potion_paralyticgas", "Uncorking or shattering this pressurized glass will cause its contents " + "to explode into a cloud of paralyzing gas. You might choose to fling " + "this potion at distant enemies instead of uncorking it by hand."),
  potion_levitation: def("potion_levitation", "Potion of Levitation", "item_potion_levitation", "This curious solution will fill you with buoyancy. If you drink it, " + "you will begin to float."),
  potion_mindvision: def("potion_mindvision", "Potion of Mind Vision", "item_potion_mindvision", "After drinking this, your mind will become attuned to the psychic " + "signature of distant creatures, enabling you to sense biological " + "presences through walls. Also this potion will permit you to see " + "through nearby walls and darkness."),
  potion_purity: def("potion_purity", "Potion of Purification", "item_potion_purity", "This cloudy fluid will disperse any noxious clouds of gas which may be " + "plaguing your vicinity. When you drink it, any gas effects afflicting " + "you will be neutralized."),
  potion_invisibility: def("potion_invisibility", "Potion of Invisibility", "item_potion_invisibility", "Drinking this potion will render you temporarily invisible. Enemies " + "will be unable to see you, although any action you take (such as " + "attacking) will dispel the effect."),
  potion_might: def("potion_might", "Potion of Might", "item_potion_might", "This powerful liquid will course through your muscles, permanently " + "increasing your strength by one point and health by five points."),
  potion_frost: def("potion_frost", "Potion of Frost", "item_potion_frost", "Upon exposure to open air, the fluid will evaporate, releasing an icy " + "blast.")
};
function potionSprite(id, fallback) {
  return identificationReady() ? potionImage(id) : fallback;
}
function potionUiInfo(id, knownName, catalogSprite) {
  if (!isPotionId(id))
    return null;
  const known = identificationReady() && isPotionKnown(id);
  return {
    name: known ? knownName : `${potionLabel(id)} potion`,
    sprite: identificationReady() ? potionImage(id) : catalogSprite,
    identified: known
  };
}
var HARMFUL_DRINK_IDS = new Set([
  "potion_liquidflame",
  "potion_toxicgas",
  "potion_paralyticgas"
]);
var BENEFICIAL_THROW_IDS = new Set([
  "potion_experience",
  "potion_healing",
  "potion_levitation",
  "potion_mindvision",
  "potion_strength",
  "potion_invisibility",
  "potion_might"
]);
var pendingConfirm = null;
var TIME_TO_DRINK = 1;
function isKnownSafe(id) {
  return identificationReady() && isPotionKnown(id);
}
function drinkPotion(ctx, hero, slot) {
  const stack = hero.inventory[slot];
  if (!stack || !isPotionId(stack.itemId)) {
    ctx.log("Nothing in that slot.");
    return 1;
  }
  if (isKnownSafe(stack.itemId) && HARMFUL_DRINK_IDS.has(stack.itemId)) {
    pendingConfirm = {
      slot,
      itemId: stack.itemId,
      mode: "drink",
      cell: -1,
      title: "Harmful potion!",
      question: "Are you sure you want to drink it?"
    };
    ctx.log("Harmful potion! Are you sure you want to drink it?");
    return 0;
  }
  return drinkPotionConfirmed(ctx, hero, slot);
}
function drinkPotionConfirmed(ctx, hero, slot) {
  const stack = hero.inventory[slot];
  if (!stack || !isPotionId(stack.itemId))
    return 1;
  const id = stack.itemId;
  removeFromInventory(hero, slot, 1);
  applyDrinkEffect(ctx, hero, id);
  return TIME_TO_DRINK;
}
function applyDrinkEffect(ctx, hero, id) {
  switch (id) {
    case "potion_healing": {
      hero.hp = hero.ht;
      delete hero.buffs.poison;
      delete hero.buffs.cripple;
      delete hero.buffs.bleeding;
      hero.weakened = false;
      ctx.log("Your wounds heal completely.");
      break;
    }
    case "potion_strength": {
      hero.str += 1;
      ctx.log("Newfound strength surges through your body.");
      break;
    }
    case "potion_experience": {
      const need2 = maxExp(hero.lvl) - hero.exp;
      earnExp(hero, need2);
      ctx.log("You feel more experienced.");
      break;
    }
    case "potion_might": {
      hero.str += 1;
      hero.ht += 5;
      hero.hp += 5;
      ctx.log("You feel stronger.");
      break;
    }
    case "potion_mindvision": {
      affectBuff2(hero.buffs, "mindvision", 20);
      break;
    }
    case "potion_levitation": {
      affectBuff2(hero.buffs, "levitation", 20);
      hero.flying = true;
      delete hero.buffs.roots;
      ctx.log("You float into the air!");
      break;
    }
    case "potion_invisibility": {
      affectBuff2(hero.buffs, "invisibility", 15);
      ctx.log("You vanish!");
      break;
    }
    case "potion_purity": {
      affectBuff2(hero.buffs, "gasesimmunity", 5);
      ctx.log("You feel cleansed of impurities.");
      break;
    }
    default: {
      shatterPotionAt(ctx, hero, hero.pos, id);
      break;
    }
  }
  knowPotion(id);
}
var TIME_TO_THROW = 1;
function throwPotion(ctx, hero, slot, cell) {
  const stack = hero.inventory[slot];
  if (!stack || !isPotionId(stack.itemId)) {
    ctx.log("Nothing in that slot.");
    return 1;
  }
  if (isKnownSafe(stack.itemId) && BENEFICIAL_THROW_IDS.has(stack.itemId)) {
    pendingConfirm = {
      slot,
      itemId: stack.itemId,
      mode: "throw",
      cell,
      title: "Beneficial potion",
      question: "Are you sure you want to shatter it?"
    };
    ctx.log("Beneficial potion. Are you sure you want to shatter it?");
    return 0;
  }
  return throwPotionConfirmed(ctx, hero, slot, cell);
}
function throwPotionConfirmed(ctx, hero, slot, cell) {
  const stack = hero.inventory[slot];
  if (!stack || !isPotionId(stack.itemId))
    return 1;
  const id = stack.itemId;
  removeFromInventory(hero, slot, 1);
  const w = ctx.level.w;
  const x = cell % w;
  const y = Math.floor(cell / w);
  const tile = ctx.level.get(x, y);
  if (cell === hero.pos) {
    applyDrinkEffect(ctx, hero, id);
  } else if (tile === 12 /* WELL */ || tile === 8 /* CHASM */) {
    const fallback = POTION_DEFS[id]?.sprite ?? "potion_red";
    ctx.level.items.push({
      pos: cell,
      itemId: id,
      sprite: potionSprite(id, fallback)
    });
  } else {
    shatterPotionAt(ctx, hero, cell, id);
  }
  return TIME_TO_THROW;
}
function shatterPotionAt(ctx, hero, cell, id) {
  const visible = isCellVisible(ctx, cell);
  switch (id) {
    case "potion_toxicgas": {
      if (visible)
        knowPotion(id);
      seedBlob(ctx.level.blobs, "toxic", cell, 1000, ctx.level.w * ctx.level.h);
      break;
    }
    case "potion_paralyticgas": {
      if (visible)
        knowPotion(id);
      seedBlob(ctx.level.blobs, "paralytic", cell, 1000, ctx.level.w * ctx.level.h);
      break;
    }
    case "potion_liquidflame": {
      if (visible)
        knowPotion(id);
      seedBlob(ctx.level.blobs, "fire", cell, 2, ctx.level.w * ctx.level.h);
      break;
    }
    case "potion_frost": {
      const affected = cellsWithin2(ctx, cell);
      const anyVisible = affected.some((c) => isCellVisible(ctx, c));
      if (anyVisible)
        knowPotion(id);
      for (const c of affected) {
        const ch = charAtCell(ctx, hero, c);
        if (ch) {
          prolongBuff2(ch.buffs, "frost", 5 * ctx.rng.float(1, 1.5));
          ch.paralysed = true;
          delete ch.buffs.burning;
        }
      }
      const fire = ctx.level.blobs.find((b) => b.kind === "fire");
      if (fire)
        for (const c of affected)
          fire.cur[c] = 0;
      break;
    }
    case "potion_purity": {
      for (const c of cellsWithin2(ctx, cell)) {
        for (const kind of ["toxic", "paralytic"]) {
          const blob = ctx.level.blobs.find((b) => b.kind === kind);
          if (blob && blob.cur[c] > 0) {
            blob.volume -= blob.cur[c];
            blob.cur[c] = 0;
          }
        }
      }
      break;
    }
    default:
      break;
  }
}
function cellsWithin2(ctx, cell) {
  const w = ctx.level.w;
  const h = ctx.level.h;
  const out = [];
  const dist = new Int32Array(w * h).fill(-1);
  dist[cell] = 0;
  const queue = [cell];
  while (queue.length > 0) {
    const c = queue.shift();
    if (dist[c] >= 2)
      continue;
    const cx = c % w;
    const cy = Math.floor(c / w);
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1]
    ];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h)
        continue;
      const n = ny * w + nx;
      if (dist[n] !== -1)
        continue;
      if (isOpaque(ctx, nx, ny))
        continue;
      dist[n] = dist[c] + 1;
      queue.push(n);
    }
  }
  for (let i = 0;i < w * h; i++) {
    if (dist[i] !== -1)
      out.push(i);
  }
  return out;
}
function isOpaque(ctx, x, y) {
  const t = ctx.level.get(x, y);
  return t === 0 /* WALL */ || t === 2 /* DOOR */ || t === 4 /* DOOR_SECRET */ || t === 37 /* BARRICADE */;
}
function isCellVisible(ctx, cell) {
  return !!ctx.level.visible[cell];
}
function charAtCell(ctx, hero, cell) {
  if (hero.pos === cell)
    return hero;
  const w = ctx.level.w;
  for (const m of ctx.mobs) {
    if (m.isAlive() && m.y * w + m.x === cell) {
      return m;
    }
  }
  return null;
}
function tickFlavourBuff(buffs, kind) {
  const b = buffs[kind];
  if (!b)
    return false;
  b.left -= 1;
  if (b.left <= 0) {
    delete buffs[kind];
    return false;
  }
  return true;
}
function tickPotionBuffs(buffs, flags, onSleepEnd) {
  const hadSleep = !!buffs.sleep;
  for (const kind of [
    "frost",
    "levitation",
    "invisibility",
    "mindvision",
    "gasesimmunity",
    "terror",
    "rage",
    "sleep"
  ]) {
    tickFlavourBuff(buffs, kind);
  }
  if (hadSleep && !buffs.sleep && onSleepEnd)
    onSleepEnd();
  if (!buffs.frost && flags.paralysed) {
    if (!buffs.paralysis)
      flags.paralysed = false;
  }
  if (!buffs.levitation)
    flags.flying = false;
}
function takeFromSlot(hero, slot, n) {
  const stack = hero.inventory[slot];
  if (!stack || stack.qty < n)
    return false;
  removeFromInventory(hero, slot, n);
  return true;
}

// src/content/scrolls.ts
var SCROLL_CLASS_ORDER = [
  "scroll_identify",
  "scroll_magicmapping",
  "scroll_recharging",
  "scroll_removecurse",
  "scroll_teleportation",
  "scroll_challenge",
  "scroll_terror",
  "scroll_lullaby",
  "scroll_psionicblast",
  "scroll_mirrorimage",
  "scroll_upgrade",
  "scroll_enchantment"
];
var SCROLL_ID_SET = new Set(SCROLL_CLASS_ORDER);
function isScrollId(id) {
  return SCROLL_ID_SET.has(id);
}
function def2(id, name, sprite, desc) {
  return {
    id,
    name,
    sprite,
    type: "scroll",
    stackable: true,
    desc,
    price: 15
  };
}
var SCROLL_DEFS = {
  scroll_identify: def2("scroll_identify", "Scroll of Identify", "item_scroll_identify", "Permanently reveals all of the secrets of a single item."),
  scroll_teleportation: def2("scroll_teleportation", "Scroll of Teleportation", "item_scroll_teleportation", "The spell on this parchment will teleport the reader to a random " + "location on the current level."),
  scroll_removecurse: def2("scroll_removecurse", "Scroll of Remove Curse", "item_scroll_removecurse", "The incantation on this scroll will instantly strip from the reader's " + "weapon, armor, rings and carried items any evil enchantments that " + "might prevent the wearer from removing them."),
  scroll_recharging: def2("scroll_recharging", "Scroll of Recharging", "item_scroll_recharging", "The spell on this scroll will instantly recharge all of the wands " + "the reader has."),
  scroll_magicmapping: def2("scroll_magicmapping", "Scroll of Magic Mapping", "item_scroll_magicmapping", "When this scroll is read, an image of crystal clarity will be etched " + "into your memory, alerting you to the precise layout of the level " + "and revealing all hidden secrets. The locations of items and " + "creatures will remain unknown."),
  scroll_challenge: def2("scroll_challenge", "Scroll of Challenge", "item_scroll_challenge", "When this scroll is read, it lets out a challenging cry that " + "compels all of the creatures on the level to pay attention to the " + "reader."),
  scroll_terror: def2("scroll_terror", "Scroll of Terror", "item_scroll_terror", "A fearsome magic will course through your enemies when this scroll " + "is read, causing them to flee from your presence in terror."),
  scroll_lullaby: def2("scroll_lullaby", "Scroll of Lullaby", "item_scroll_lullaby", "Soothing notes will drift from this scroll, sending all nearby " + "creatures into a deep slumber."),
  scroll_psionicblast: def2("scroll_psionicblast", "Scroll of Psionic Blast", "item_scroll_psionicblast", "This scroll contains a devastating blast of psychic energy. It will " + "damage and stun all creatures on the level that can see the reader, " + "but it will also blind and damage the reader."),
  scroll_mirrorimage: def2("scroll_mirrorimage", "Scroll of Mirror Image", "item_scroll_mirrorimage", "The incantation on this scroll will create illusory duplicates of " + "the reader, which will needle and distract the enemies."),
  scroll_enchantment: def2("scroll_enchantment", "Scroll of Enchantment", "item_scroll_enchantment", "This scroll is able to imbue a weapon or a suit of armor with a " + "magical enchantment, or to strengthen an enchantment which " + "already exists on the item.")
};
function scrollUiInfo(id, knownName, catalogSprite) {
  if (!isScrollId(id))
    return null;
  const known = identificationReady() && isScrollKnown(id);
  return {
    name: known ? knownName : `scroll "${scrollRune(id)}"`,
    sprite: identificationReady() ? scrollImage(id) : catalogSprite,
    identified: known
  };
}
var TIME_TO_READ = 1;
function readScroll(ctx, hero, slot) {
  const stack = hero.inventory[slot];
  if (!stack || !isScrollId(stack.itemId)) {
    ctx.log("Nothing in that slot.");
    return 1;
  }
  const id = stack.itemId;
  if (hero.buffs.blindness) {
    ctx.log("You can't read a scroll while blind!");
    return 1;
  }
  if (id === "scroll_upgrade")
    return readUpgradeScroll(ctx, hero, slot);
  if (id === "scroll_identify" || id === "scroll_enchantment") {
    return openInventoryScroll(ctx, hero, slot, id);
  }
  removeFromInventory(hero, slot, 1);
  doReadEffect(ctx, hero, id);
  knowScroll(id);
  return TIME_TO_READ;
}
var pendingSelect = null;
function openInventoryScroll(ctx, hero, slot, id) {
  const kind = id === "scroll_identify" ? "identify" : "enchant";
  removeFromInventory(hero, slot, 1);
  knowScroll(id);
  const candidates = inventoryScrollCandidates(hero, kind);
  if (candidates.length === 0) {
    ctx.log(kind === "identify" ? "You have nothing to identify." : "You have nothing to enchant.");
    return TIME_TO_READ;
  }
  pendingSelect = {
    kind,
    candidates,
    title: kind === "identify" ? "Select an item to identify" : "Select an enchantable item"
  };
  return TIME_TO_READ;
}
function inventoryScrollCandidates(hero, kind) {
  const out = [];
  hero.inventory.forEach((stack, slot) => {
    if (kind === "identify") {
      if (isItemUnidentified(stack.itemId))
        out.push(slot);
    } else {
      const t = itemTypeOf(stack.itemId);
      if (t === "weapon" || t === "armor")
        out.push(slot);
    }
  });
  return out;
}
var itemTypeLookup = () => null;
function itemTypeOf(id) {
  return itemTypeLookup(id);
}
function isItemUnidentified(id) {
  if (!identificationReady())
    return false;
  if (isPotionId(id))
    return !isPotionKnown(id);
  if (isScrollId(id))
    return !isScrollKnown(id);
  if (isWandRegistered()) {
    try {
      return !isWandKnown(id);
    } catch {
      return false;
    }
  }
  return false;
}
function uncurseItemId(hero, itemId) {
  let cleared = false;
  for (const stack of hero.inventory) {
    if (stack.itemId !== itemId)
      continue;
    const g = ensureStackGear(stack);
    if (g?.weapon?.cursed) {
      g.weapon.cursed = false;
      cleared = true;
    }
    if (g?.armor?.cursed) {
      g.armor.cursed = false;
      cleared = true;
    }
  }
  if (hero.weaponId === itemId && hero.weapon?.cursed) {
    hero.weapon.cursed = false;
    cleared = true;
  }
  if (hero.armorId === itemId && hero.armor?.cursed) {
    hero.armor.cursed = false;
    cleared = true;
  }
  return cleared;
}
var defaultEnchantHooks = {
  uncurse: uncurseItemId,
  enchantWeapon: (ctx, hero, slot) => {
    const stack = hero.inventory[slot];
    const g = stack ? ensureStackGear(stack) : null;
    if (g?.weapon)
      enchantWeaponInstance(ctx.rng, g.weapon);
  },
  inscribeArmor: (ctx, hero, slot) => {
    const stack = hero.inventory[slot];
    const g = stack ? ensureStackGear(stack) : null;
    if (g?.armor)
      inscribeArmorInstance(ctx.rng, g.armor);
  },
  fixItem: (hero, slot) => {
    const stack = hero.inventory[slot];
    const g = stack ? ensureStackGear(stack) : null;
    if (g?.weapon)
      fixDurability(g.weapon, "weapon");
    if (g?.armor)
      fixDurability(g.armor, "armor");
  }
};
var enchantHooks = defaultEnchantHooks;
var rechargeImpl = null;
function readUpgradeScroll(ctx, hero, slot) {
  knowScroll("scroll_upgrade");
  const weapon = hero.weapon;
  const armor = hero.armor;
  if (!weapon && !armor) {
    ctx.log("You have nothing to upgrade.");
    return TIME_TO_READ;
  }
  removeFromInventory(hero, slot, 1);
  if (weapon) {
    if (isBroken(weapon)) {
      fixDurability(weapon, "weapon");
    } else {
      upgradeWeapon(weapon, ctx.rng, { log: (m) => ctx.log(m) });
    }
    ctx.log(`your ${gearDisplayName(weapon)} certainly looks better now`);
  } else {
    if (isBroken(armor)) {
      fixDurability(armor, "armor");
    } else {
      upgradeArmor(armor, ctx.rng, { log: (m) => ctx.log(m) });
    }
    ctx.log(`your ${gearDisplayName(armor)} certainly looks better now`);
  }
  return TIME_TO_READ;
}
function doReadEffect(ctx, hero, id) {
  switch (id) {
    case "scroll_removecurse":
      doRemoveCurse(ctx, hero);
      break;
    case "scroll_magicmapping":
      doMagicMapping(ctx, hero);
      break;
    case "scroll_teleportation":
      doTeleportation(ctx, hero);
      break;
    case "scroll_recharging":
      doRecharging(ctx, hero);
      break;
    case "scroll_challenge":
      doChallenge(ctx, hero);
      break;
    case "scroll_terror":
      doTerror(ctx, hero);
      break;
    case "scroll_lullaby":
      doLullaby(ctx, hero);
      break;
    case "scroll_psionicblast":
      doPsionicBlast(ctx, hero);
      break;
    case "scroll_mirrorimage":
      doMirrorImage(ctx, hero);
      break;
    default:
      break;
  }
}
function doRemoveCurse(ctx, hero) {
  delete hero.buffs.invisibility;
  let procced = false;
  for (const stack of hero.inventory) {
    if (enchantHooks.uncurse(hero, stack.itemId))
      procced = true;
  }
  if (hero.weaponId && enchantHooks.uncurse(hero, hero.weaponId))
    procced = true;
  if (hero.armorId && enchantHooks.uncurse(hero, hero.armorId))
    procced = true;
  hero.weakened = false;
  ctx.log(procced ? "Your pack glows with a cleansing light." : "Your pack glows with a cleansing light, but nothing happens.");
}
function doMagicMapping(ctx, _hero) {
  const level = ctx.level;
  const n = level.w * level.h;
  for (let i = 0;i < n; i++) {
    const t = level.getAt(i);
    if (t === 0 /* WALL */ || t === 8 /* CHASM */) {
      continue;
    }
    level.explored[i] = 1;
  }
  for (let i = 0;i < n; i++) {
    const x = i % level.w;
    const y = Math.floor(i / level.w);
    level.revealSecretDoor(x, y);
    level.revealTrap(x, y);
  }
  ctx.log("You feel fully aware of your surroundings.");
}
function doTeleportation(ctx, hero) {
  const level = ctx.level;
  for (let i = 0;i < 10; i++) {
    const cell = randomRespawnCell(ctx, hero);
    if (cell !== -1) {
      hero.pos = cell;
      ctx.log("You teleport!");
      return;
    }
  }
  ctx.log("The scroll fizzles.");
}
function randomRespawnCell(ctx, hero) {
  const level = ctx.level;
  const n = level.w * level.h;
  for (let i = 0;i < 10; i++) {
    const cell = ctx.rng.int(0, n);
    const x = cell % level.w;
    const y = Math.floor(cell / level.w);
    if (!level.isPassable(x, y))
      continue;
    if (level.visible[cell])
      continue;
    if (hero.pos === cell)
      continue;
    if (charAtPos(ctx, cell))
      continue;
    return cell;
  }
  return -1;
}
function doRecharging(_ctx, hero) {
  if (rechargeImpl)
    rechargeImpl(hero);
}
function doChallenge(ctx, hero) {
  const w = ctx.level.w;
  for (const m of ctx.mobs) {
    const mob = m;
    if (typeof mob.beckon === "function")
      mob.beckon(hero.pos);
    else
      mob.beckonedTo = hero.pos;
    if (isMobVisible(ctx, mob.pos)) {
      const d = chebyshev(hero.pos, mob.pos, w);
      prolongBuff2(mob.buffs, "rage", d);
    }
  }
  ctx.log("You let out a challenging cry!");
}
function doTerror(ctx, hero) {
  for (const m of ctx.mobs) {
    const mob = m;
    if (isMobVisible(ctx, mob.pos)) {
      prolongBuff2(mob.buffs, "terror", 10, { sourceId: hero.id });
      mob.terrorFrom = hero.pos;
    }
  }
  ctx.log("You unleash a terrifying scream!");
}
function doLullaby(ctx, hero) {
  for (const m of ctx.mobs) {
    const mob = m;
    if (isMobVisible(ctx, mob.pos)) {
      affectBuff2(mob.buffs, "sleep", 1.5);
      mob.putToSleep = true;
    }
  }
  ctx.log("A soothing melody drifts through the air.");
}
function doPsionicBlast(ctx, hero) {
  const rng = ctx.rng;
  const blindFor = rng.int(3, 6);
  for (const m of ctx.mobs) {
    const mob = m;
    if (!isMobVisible(ctx, mob.pos))
      continue;
    affectBuff2(mob.buffs, "blindness", blindFor);
    const dmg = rng.intRange(1, Math.floor(mob.ht * 2 / 3));
    damageMobDirect(ctx, mob, dmg);
  }
  affectBuff2(hero.buffs, "blindness", blindFor);
  const heroDmg = rng.intRange(1, Math.floor(hero.ht * 2 / 3));
  hero.hp -= heroDmg;
  ctx.log("A blast of psionic energy erupts!");
}
var MIRROR_IMAGE_COUNT = 3;
function doMirrorImage(ctx, hero) {
  const rng = ctx.rng;
  const w = ctx.level.w;
  const spawned = [];
  const candidates = [];
  const hx = hero.pos % w;
  const hy = Math.floor(hero.pos / w);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1]
  ]) {
    const nx = hx + dx;
    const ny = hy + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= ctx.level.h)
      continue;
    const c = ny * w + nx;
    const t = ctx.level.get(nx, ny);
    const okTile = ctx.level.isPassable(nx, ny) || ctx.level.isAvoid(nx, ny);
    if (!okTile)
      continue;
    if (hero.pos === c || charAtPos(ctx, c))
      continue;
    candidates.push(c);
  }
  const stats = {
    attackSkill: hero.attackSkill,
    damage: heroDamageForMirror(rng, hero)
  };
  let nImages = 0;
  while (nImages < MIRROR_IMAGE_COUNT && candidates.length > 0) {
    const idx = rng.int(0, candidates.length);
    const cell = candidates.splice(idx, 1)[0];
    const img = new MirrorImageMob(nextMobId2(), cell, w, stats);
    ctx.addMob(img, cell);
    spawned.push(cell);
    nImages++;
  }
  if (nImages === 0)
    knowScroll("scroll_mirrorimage");
  else
    ctx.log("Mirror images shimmer into being!");
}
function heroDamageForMirror(rng, hero) {
  const weapon = hero.weapon;
  if (weapon) {
    const min = weapon.min ?? 1;
    const max = weapon.max ?? min;
    return Math.max(1, Math.round((min + max) / 2));
  }
  return 1;
}
var mirrorIdCounter = -1e5;
function nextMobId2() {
  return mirrorIdCounter--;
}
function isMobVisible(ctx, pos) {
  return !!ctx.level.visible[pos];
}
function chebyshev(a, b, w) {
  const dx = Math.abs(a % w - b % w);
  const dy = Math.abs(Math.floor(a / w) - Math.floor(b / w));
  return Math.max(dx, dy);
}

// src/content/honeypot.ts
var HONEYPOT_ID = "honeypot";
var HONEYPOT_THROW_TIME = 1;
var HONEYPOT_DEF = {
  id: HONEYPOT_ID,
  name: "honeypot",
  sprite: "item_honeypot",
  type: "misc",
  stackable: true,
  desc: "There is not much honey in this small honeypot, but there is a golden bee there and it doesn't want to leave it.",
  price: 50
};
var summonBeeImpl = null;
function shatterHoneypotAt(ctx, hero, cell) {
  const w = ctx.level.w;
  const occupied = (c) => {
    if (hero.pos === c)
      return true;
    for (const m of ctx.mobs) {
      if (m.isAlive() && m.y * w + m.x === c)
        return true;
    }
    return false;
  };
  let newPos = cell;
  if (occupied(cell)) {
    const candidates = [];
    const cx = cell % w;
    const cy = Math.floor(cell / w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!ctx.level.inBounds(nx, ny))
        continue;
      if (!ctx.level.isPassable(nx, ny))
        continue;
      const c = ny * w + nx;
      if (!occupied(c))
        candidates.push(c);
    }
    newPos = candidates.length > 0 ? ctx.rng.pick(candidates) : -1;
  }
  if (newPos !== -1 && summonBeeImpl) {
    summonBeeImpl(newPos);
  }
}
function shatterHoneypotInHands(ctx, hero, slot) {
  const stack = hero.inventory[slot];
  if (!stack || stack.itemId !== HONEYPOT_ID) {
    ctx.log("Nothing in that slot.");
    return 1;
  }
  shatterHoneypotAt(ctx, hero, hero.pos);
  takeFromSlot(hero, slot, 1);
  return HONEYPOT_THROW_TIME;
}
function throwHoneypot(ctx, hero, slot, cell) {
  const stack = hero.inventory[slot];
  if (!stack || stack.itemId !== HONEYPOT_ID) {
    ctx.log("Nothing in that slot.");
    return 1;
  }
  takeFromSlot(hero, slot, 1);
  const x = cell % ctx.level.w;
  const y = Math.floor(cell / ctx.level.w);
  const tile = ctx.level.get(x, y);
  if (tile === 8 /* CHASM */) {
    dropItemAt(ctx, cell, HONEYPOT_ID);
  } else {
    shatterHoneypotAt(ctx, hero, cell);
  }
  return HONEYPOT_THROW_TIME;
}

// src/content/items.ts
var DARK_GOLD = {
  id: "darkgold",
  name: "dark gold ore",
  sprite: "item_darkgold",
  type: "misc",
  stackable: true,
  desc: "A chunk of dark gold ore, prized by the blacksmith of the caves.",
  price: 1
};
var PICKAXE = {
  id: "pickaxe",
  name: "pickaxe",
  sprite: "item_pickaxe",
  type: "weapon",
  stackable: false,
  desc: "A sturdy pickaxe, useful for mining dark gold veins.",
  weapon: {
    name: "pickaxe",
    tier: 1,
    level: 0,
    min: 3,
    max: 12,
    str: 14,
    acu: 1,
    dly: 1,
    missile: false,
    bloodStained: false,
    upgradable: false
  },
  price: 0
};
var SHORT_SWORD = {
  id: "shortsword",
  name: "short sword",
  sprite: "shortsword",
  type: "weapon",
  stackable: false,
  desc: "It is indeed quite short, just a few inches longer than a dagger.",
  weapon: { name: "short sword", tier: 1, level: 0, min: 1, max: 12, str: 11, acu: 1, dly: 1, missile: false },
  price: 20
};
var DART2 = {
  id: "dart",
  name: "dart",
  sprite: "dart",
  type: "missile",
  stackable: true,
  desc: "These simple metal spikes are weighted to fly true and sting their prey with a flick of the wrist.",
  weapon: { name: "dart", tier: 1, level: 0, min: 1, max: 4, str: 10, acu: 1, dly: 1, missile: true },
  price: 2
};
var CLOTH_ARMOR = {
  id: "cloth_armor",
  name: "cloth armor",
  sprite: "armor_cloth",
  type: "armor",
  stackable: false,
  desc: "This lightweight armor offers basic protection.",
  armor: { name: "cloth armor", level: 0, tier: 1, str: 9, dr: 2 },
  price: 10
};
var POTION_HEALING = {
  id: "potion_healing",
  name: "potion of healing",
  sprite: "potion_red",
  type: "potion",
  stackable: true,
  desc: "An elixir that will instantly return you to full health and cure poison.",
  price: 20
};
var POTION_STRENGTH = {
  id: "potion_strength",
  name: "potion of strength",
  sprite: "potion_strength",
  type: "potion",
  stackable: true,
  desc: "This powerful liquid will course through your muscles, permanently increasing your strength by one point.",
  price: 20
};
var RATION = {
  id: "ration",
  name: "ration of food",
  sprite: "ration",
  type: "food",
  stackable: true,
  desc: "Nothing fancy here: dried meat, some biscuits - things like that.",
  energy: 260,
  price: 10
};
var SCROLL = {
  id: "scroll",
  name: "scroll",
  sprite: "scroll",
  type: "scroll",
  stackable: true,
  desc: "A scroll covered in indecipherable runes.",
  price: 15
};
var SCROLL_UPGRADE = {
  id: "scroll_upgrade",
  name: "Scroll of Upgrade",
  sprite: "scroll_upgrade",
  type: "scroll",
  stackable: true,
  desc: "This scroll will upgrade a single item, improving its quality. A weapon will inflict more damage; a suit of armor will deflect additional blows. Weapons and armor will also require less strength to use.",
  price: 15
};
var GOLD = {
  id: "gold",
  name: "gold",
  sprite: "gold",
  type: "gold",
  stackable: true,
  desc: "Collect gold coins to spend them later in a shop.",
  price: 0
};
var IRON_KEY = {
  id: "iron_key",
  name: "iron key",
  sprite: "key_iron",
  type: "key",
  stackable: true,
  desc: "The notches on this ancient iron key are well worn.",
  price: 0
};
var SKELETON_KEY = {
  id: "skeleton_key",
  name: "skeleton key",
  sprite: "key_skeleton",
  type: "key",
  stackable: true,
  desc: "A key carved from bone. It must open the way down.",
  price: 0
};
var GOLDEN_KEY = {
  id: "golden_key",
  name: "golden key",
  sprite: "key_gold",
  type: "key",
  stackable: true,
  desc: "The notches on this golden key are tiny and intricate. Maybe it can open some chest lock?",
  price: 0
};
var DEWDROP = {
  id: "dewdrop",
  name: "dewdrop",
  sprite: "dewdrop",
  type: "dewdrop",
  stackable: true,
  desc: "A crystal clear dewdrop.",
  price: 0
};
var SEED = {
  id: "seed",
  name: "seed",
  sprite: "seed",
  type: "seed",
  stackable: true,
  desc: "A strange seed. Perhaps it can be planted.",
  price: 0
};
var DRIED_ROSE = {
  id: "dried_rose",
  name: "dried rose",
  sprite: "rose",
  type: "quest",
  stackable: false,
  desc: "The rose has dried long ago, but it has kept all its petals somehow."
};
var RAT_SKULL = {
  id: "rat_skull",
  name: "giant rat skull",
  sprite: "skull",
  type: "quest",
  stackable: false,
  desc: "It could be a nice hunting trophy, but it smells too bad to place it on a wall.",
  price: 100
};
var CORPSE_DUST = {
  id: "corpse_dust",
  name: "corpse dust",
  sprite: "dust",
  type: "quest",
  stackable: false,
  desc: "The ball of corpse dust doesn't differ outwardly from a regular dust ball. " + "However, you know somehow that it's better to get rid of it as soon as possible."
};
var PHANTOM_FISH = {
  id: "phantom_fish",
  name: "phantom fish",
  sprite: "phantom",
  type: "quest",
  stackable: false,
  desc: "You can barely see this tiny translucent fish in the air. " + "In the water it becomes effectively invisible."
};
var ROTBERRY_SEED = {
  id: "rotberry_seed",
  name: "seed of Rotberry",
  sprite: "seed_rotberry",
  type: "quest",
  stackable: false,
  desc: "A strange seed. Perhaps it can be planted."
};
var QUARTERSTAFF = {
  id: "quarterstaff",
  name: "quarterstaff",
  sprite: "weapon_quarterstaff",
  type: "weapon",
  stackable: false,
  desc: "A staff of hardwood, its ends are shod with iron.",
  weapon: { name: "quarterstaff", tier: 2, level: 0, min: 2, max: 12, str: 12, acu: 1, dly: 1, missile: false },
  price: 40
};
var SPEAR = {
  id: "spear",
  name: "spear",
  sprite: "weapon_spear",
  type: "weapon",
  stackable: false,
  desc: "A slender wooden rod tipped with sharpened iron.",
  weapon: { name: "spear", tier: 2, level: 0, min: 2, max: 18, str: 12, acu: 1, dly: 1.5, missile: false },
  price: 40
};
var SWORD = {
  id: "sword",
  name: "sword",
  sprite: "weapon_sword",
  type: "weapon",
  stackable: false,
  desc: "The razor-sharp length of steel blade shines reassuringly.",
  weapon: { name: "sword", tier: 3, level: 0, min: 3, max: 16, str: 14, acu: 1, dly: 1, missile: false },
  price: 80
};
var MACE = {
  id: "mace",
  name: "mace",
  sprite: "weapon_mace",
  type: "weapon",
  stackable: false,
  desc: "The iron head of this weapon inflicts substantial damage.",
  weapon: { name: "mace", tier: 3, level: 0, min: 3, max: 12, str: 14, acu: 1, dly: 0.8, missile: false },
  price: 80
};
var LONGSWORD = {
  id: "longsword",
  name: "longsword",
  sprite: "weapon_longsword",
  type: "weapon",
  stackable: false,
  desc: "This towering blade inflicts heavy damage by investing its heft into every cut.",
  weapon: { name: "longsword", tier: 4, level: 0, min: 4, max: 22, str: 16, acu: 1, dly: 1, missile: false },
  price: 160
};
var BATTLE_AXE = {
  id: "battle_axe",
  name: "battle axe",
  sprite: "weapon_battle_axe",
  type: "weapon",
  stackable: false,
  desc: "The enormous steel head of this battle axe puts considerable heft behind each stroke.",
  weapon: { name: "battle axe", tier: 4, level: 0, min: 4, max: 18, str: 16, acu: 1.2, dly: 1, missile: false },
  price: 160
};
var GLAIVE = {
  id: "glaive",
  name: "glaive",
  sprite: "weapon_glaive",
  type: "weapon",
  stackable: false,
  desc: "A polearm consisting of a sword blade on the end of a pole.",
  weapon: { name: "glaive", tier: 5, level: 0, min: 5, max: 30, str: 18, acu: 1, dly: 1, missile: false },
  price: 320
};
var WAR_HAMMER = {
  id: "war_hammer",
  name: "war hammer",
  sprite: "weapon_war_hammer",
  type: "weapon",
  stackable: false,
  desc: "Few creatures can withstand the crushing blow of this towering mass of lead and steel, but only the strongest of adventurers can use it effectively.",
  weapon: { name: "war hammer", tier: 5, level: 0, min: 5, max: 25, str: 18, acu: 1.2, dly: 1, missile: false },
  price: 320
};
var LEATHER_ARMOR = {
  id: "leather_armor",
  name: "leather armor",
  sprite: "armor_leather",
  type: "armor",
  stackable: false,
  desc: "Armor made from tanned monster hide. Not as light as cloth armor but provides better protection.",
  armor: { name: "leather armor", level: 0, tier: 2, str: 11, dr: 4 },
  price: 20
};
var MAIL_ARMOR = {
  id: "mail_armor",
  name: "mail armor",
  sprite: "armor_mail",
  type: "armor",
  stackable: false,
  desc: "Interlocking metal links make for a tough but flexible suit of armor.",
  armor: { name: "mail armor", level: 0, tier: 3, str: 13, dr: 6 },
  price: 40
};
var SCALE_ARMOR = {
  id: "scale_armor",
  name: "scale armor",
  sprite: "armor_scale",
  type: "armor",
  stackable: false,
  desc: "The metal scales sewn onto a leather vest create a flexible, yet protective armor.",
  armor: { name: "scale armor", level: 0, tier: 4, str: 15, dr: 8 },
  price: 80
};
var PLATE_ARMOR = {
  id: "plate_armor",
  name: "plate armor",
  sprite: "armor_plate",
  type: "armor",
  stackable: false,
  desc: "Enormous plates of metal are joined together into a suit that provides unmatched protection to any adventurer strong enough to bear its staggering weight.",
  armor: { name: "plate armor", level: 0, tier: 5, str: 17, dr: 10 },
  price: 160
};
var SEED_POUCH = {
  id: "seed_pouch",
  name: "seed pouch",
  sprite: "seed_pouch",
  type: "bag",
  stackable: false,
  desc: "This small velvet pouch allows you to store any number of seeds in it. Very convenient.",
  price: 50
};
var SCROLL_HOLDER = {
  id: "scroll_holder",
  name: "scroll holder",
  sprite: "scroll_holder",
  type: "bag",
  stackable: false,
  desc: "You can place any number of scrolls into this tubular container. It saves room in your backpack and protects scrolls from fire.",
  price: 50
};
var WAND_HOLSTER = {
  id: "wand_holster",
  name: "wand holster",
  sprite: "wand_holster",
  type: "bag",
  stackable: false,
  desc: "This slim holder is made of leather of some exotic animal. It allows to compactly carry up to 12 wands.",
  price: 50
};
var WEIGHTSTONE = {
  id: "weightstone",
  name: "weightstone",
  sprite: "weightstone",
  type: "misc",
  stackable: true,
  desc: "Using a weightstone, you can balance your melee weapon to increase its speed or accuracy.",
  price: 40
};
var TORCH = {
  id: "torch",
  name: "torch",
  sprite: "torch",
  type: "misc",
  stackable: true,
  desc: "It's an indispensable item in The Demon Halls, which are notorious for their poor ambient lighting.",
  price: 10
};
var ANKH = {
  id: "ankh",
  name: "Ankh",
  sprite: "ankh",
  type: "misc",
  stackable: true,
  desc: "The ancient symbol of immortality grants an ability to return to life after death. Upon resurrection all non-equipped items are lost.",
  price: 50
};
var OVERPRICED_RATION = {
  id: "overpriced_ration",
  name: "overpriced food ration",
  sprite: "overpriced_ration",
  type: "food",
  stackable: true,
  desc: "It looks exactly like a standard ration of food but smaller.",
  energy: 100,
  price: 20
};
var WAND_BASE_DEFS = {};
for (const spec of WAND_SPECS) {
  const id = `wand_of_${spec.id}`;
  WAND_BASE_DEFS[id] = {
    id,
    name: spec.name,
    sprite: spec.sprite,
    type: "wand",
    stackable: false,
    desc: spec.desc,
    price: 50
  };
}
var RING_BASE_DEFS = {};
for (const spec of RING_SPECS) {
  const id = `ring_of_${spec.id}`;
  RING_BASE_DEFS[id] = {
    id,
    name: spec.name,
    sprite: spec.spriteKey,
    type: "ring",
    stackable: false,
    desc: spec.desc,
    price: 80
  };
}
var ITEMS = {
  shortsword: SHORT_SWORD,
  dart: DART2,
  cloth_armor: CLOTH_ARMOR,
  potion_healing: POTION_HEALING,
  potion_strength: POTION_STRENGTH,
  ration: RATION,
  scroll: SCROLL,
  scroll_upgrade: SCROLL_UPGRADE,
  gold: GOLD,
  iron_key: IRON_KEY,
  skeleton_key: SKELETON_KEY,
  golden_key: GOLDEN_KEY,
  dewdrop: DEWDROP,
  seed: SEED,
  dried_rose: DRIED_ROSE,
  rat_skull: RAT_SKULL,
  corpse_dust: CORPSE_DUST,
  phantom_fish: PHANTOM_FISH,
  rotberry_seed: ROTBERRY_SEED,
  quarterstaff: QUARTERSTAFF,
  spear: SPEAR,
  sword: SWORD,
  mace: MACE,
  longsword: LONGSWORD,
  battle_axe: BATTLE_AXE,
  glaive: GLAIVE,
  war_hammer: WAR_HAMMER,
  leather_armor: LEATHER_ARMOR,
  mail_armor: MAIL_ARMOR,
  scale_armor: SCALE_ARMOR,
  plate_armor: PLATE_ARMOR,
  seed_pouch: SEED_POUCH,
  scroll_holder: SCROLL_HOLDER,
  wand_holster: WAND_HOLSTER,
  weightstone: WEIGHTSTONE,
  torch: TORCH,
  ankh: ANKH,
  overpriced_ration: OVERPRICED_RATION,
  ...POTION_DEFS,
  ...SCROLL_DEFS,
  honeypot: HONEYPOT_DEF,
  darkgold: DARK_GOLD,
  pickaxe: PICKAXE,
  ...WAND_BASE_DEFS,
  ...RING_BASE_DEFS
};
function getItem(id) {
  const { defId } = parseItemId(id);
  const def3 = ITEMS[defId];
  if (!def3)
    throw new Error(`unknown item id: ${id}`);
  return def3;
}
function parseItemId(id) {
  const colon = id.indexOf(":");
  if (colon === -1)
    return { defId: id, qty: 1 };
  const n = parseInt(id.slice(colon + 1), 10);
  return {
    defId: id.slice(0, colon),
    qty: Number.isFinite(n) && n > 0 ? n : 1
  };
}

// src/content/actions.ts
function pickupAt(ctx, hero) {
  const level = ctx.level;
  const item = level.items.find((it) => it.pos === hero.pos);
  if (!item) {
    ctx.log("There is nothing here to pick up.");
    return 1;
  }
  level.items = level.items.filter((it) => it !== item);
  const { defId, qty } = parseItemId(item.itemId);
  if (defId === "dewdrop")
    return pickupDewdrop(ctx, hero, qty);
  if (item.lockedChest)
    return openLockedChest(ctx, hero, item);
  const def3 = getItem(defId);
  if (def3.type === "gold") {
    hero.gold += qty;
    ctx.log(`You pick up ${qty} gold.`);
  } else {
    addToInventory(hero, defId, qty);
    const label = qty > 1 ? `${qty}x ${def3.name}` : def3.name;
    ctx.log(`You pick up the ${label}.`);
  }
  return 1;
}
function useInventorySlot(ctx, hero, slot) {
  const stack = hero.inventory[slot];
  if (!stack) {
    ctx.log("Nothing in that slot.");
    return 1;
  }
  const def3 = getItem(stack.itemId);
  if (isWandId(stack.itemId) || isRingId(stack.itemId)) {
    ctx.log("Nothing happens.");
    return 1;
  }
  switch (def3.type) {
    case "potion":
      return drinkPotion2(ctx, hero, slot, stack);
    case "food":
      return eatFood(ctx, hero, slot, stack);
    case "scroll":
      return readScroll2(ctx, hero, slot, stack);
    case "weapon":
      return equipWeaponFromInventory(ctx, hero, slot, stack);
    case "armor":
      return equipArmorFromInventory(ctx, hero, slot, stack);
    case "missile":
      ctx.log("Choose a target to throw the dart at.");
      return 0;
    case "key":
      return useKey(ctx, hero, slot, stack);
    case "gold":
      return 1;
    case "dewdrop":
    case "seed":
      return 1;
    case "bag":
    case "misc":
    case "quest":
      return 1;
    case "wand":
    case "ring":
      return 1;
  }
}
function drinkPotion2(ctx, hero, slot, _stack) {
  return drinkPotion(ctx, hero, slot);
}
function readScroll2(ctx, hero, slot, _stack) {
  return readScroll(ctx, hero, slot);
}
function eatFood(ctx, hero, slot, stack) {
  const def3 = getItem(stack.itemId);
  removeFromInventory(hero, slot, 1);
  hero.hungerLevel = satisfy(hero.hungerLevel, def3.energy ?? 260);
  if (hero.hp < hero.ht) {
    hero.hp = Math.min(hero.hp + 5, hero.ht);
  }
  ctx.log("That food tasted delicious!");
  return 3;
}
function equipWeaponFromInventory(ctx, hero, slot, stack) {
  const def3 = getItem(stack.itemId);
  if (!def3.weapon) {
    ctx.log("You can't wield that.");
    return 1;
  }
  if (hero.weapon?.cursed) {
    ctx.log(TXT_UNEQUIP_CURSED.replace("%s", hero.weapon.name));
    return 1;
  }
  const oldWeapon = hero.weapon;
  const oldId = hero.weaponId;
  const inst = stack.gear?.weapon ? { ...stack.gear.weapon } : { ...def3.weapon };
  if (inst.durability === undefined)
    initDurability(inst, "weapon");
  removeFromInventory(hero, slot, 1);
  hero.weapon = inst;
  hero.weaponId = def3.id;
  hero.weapon.cursedKnown = true;
  if (oldId && oldWeapon) {
    addToInventory(hero, oldId, 1, { weapon: oldWeapon });
  }
  ctx.log(`You equip the ${def3.name}.`);
  if (inst.cursed) {
    ctx.log(TXT_EQUIP_CURSED_WEAPON.replace("%s", inst.name));
  }
  return 1;
}
function equipArmorFromInventory(ctx, hero, slot, stack) {
  const def3 = getItem(stack.itemId);
  if (!def3.armor) {
    ctx.log("You can't wear that.");
    return 1;
  }
  if (hero.armor?.cursed) {
    ctx.log(TXT_UNEQUIP_CURSED.replace("%s", hero.armor.name));
    return 1;
  }
  const oldArmor = hero.armor;
  const oldId = hero.armorId;
  const inst = stack.gear?.armor ? { ...stack.gear.armor } : { ...def3.armor };
  if (inst.durability === undefined)
    initDurability(inst, "armor");
  removeFromInventory(hero, slot, 1);
  hero.armor = inst;
  hero.armorId = def3.id;
  hero.armor.cursedKnown = true;
  if (oldId && oldArmor) {
    addToInventory(hero, oldId, 1, { armor: oldArmor });
  }
  ctx.log(`You equip the ${def3.name}.`);
  if (inst.cursed) {
    ctx.log(TXT_EQUIP_CURSED_ARMOR.replace("%s", inst.name));
  }
  return 1;
}
function useKey(ctx, hero, slot, stack) {
  const level = ctx.level;
  const w = level.w;
  const x = hero.x;
  const y = hero.y;
  const lockedAround = [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1]
  ];
  if (stack.itemId === "iron_key") {
    for (const [nx, ny] of lockedAround) {
      if (level.inBounds(nx, ny) && level.get(nx, ny) === 3 /* DOOR_LOCKED */) {
        level.set(nx, ny, 2 /* DOOR */);
        removeFromInventory(hero, slot, 1);
        ctx.log("You unlock the door.");
        return 1;
      }
    }
    ctx.log("There is no locked door nearby.");
    return 1;
  }
  if (stack.itemId === "skeleton_key") {
    for (const [nx, ny] of lockedAround) {
      if (level.inBounds(nx, ny) && level.get(nx, ny) === 5 /* EXIT_LOCKED */) {
        level.set(nx, ny, 7 /* EXIT */);
        removeFromInventory(hero, slot, 1);
        ctx.log("You unlock the way down with the skeleton key.");
        return 1;
      }
    }
    ctx.log("There is no locked exit nearby.");
    return 1;
  }
  ctx.log("You can't use that here.");
  return 1;
}
function throwDart(ctx, hero, slot, targetPos) {
  const stack = hero.inventory[slot];
  if (!stack || stack.itemId !== "dart") {
    ctx.log("You have no darts to throw.");
    return 1;
  }
  const level = ctx.level;
  const trace = dartTrace(level, hero.pos, targetPos);
  removeFromInventory(hero, slot, 1);
  syncDarts(hero);
  for (const cell of trace.cells) {
    const mob = ctx.mobs.find((m) => m.isAlive() && m.x === cell % level.w && m.y === Math.floor(cell / level.w));
    if (mob) {
      const ranged = { ...getItem("dart").weapon };
      const dist = trace.distances.get(cell) ?? 1;
      try {
        hero.rangedWeapon = ranged;
        strikeHeroVsMob(ctx, hero, mob, heroAttackSkill(hero, { ranged: true, adjacent: dist <= 1 }), (rng) => heroDamageRoll(rng, hero, { ranged: true }));
      } finally {
        hero.rangedWeapon = null;
      }
      return 1;
    }
  }
  dropDartAt(level, trace.landCell);
  ctx.log("The dart clatters to the floor.");
  return 1;
}
function dropDartAt(level, pos) {
  level.items.push({ pos, itemId: "dart", sprite: getItem("dart").sprite });
}
function equipSlot(ctx, hero, slot) {
  if (slot === -1) {
    if (!hero.weaponId) {
      ctx.log("You wield nothing.");
      return 1;
    }
    if (hero.weapon?.cursed) {
      ctx.log(TXT_UNEQUIP_CURSED.replace("%s", hero.weapon.name));
      return 1;
    }
    const def4 = getItem(hero.weaponId);
    const inst = hero.weapon;
    addToInventory(hero, hero.weaponId, 1, inst ? { weapon: inst } : undefined);
    hero.weapon = null;
    hero.weaponId = null;
    ctx.log(`You unwield the ${def4.name}.`);
    return 1;
  }
  if (slot === -2) {
    if (!hero.armorId) {
      ctx.log("You wear nothing.");
      return 1;
    }
    if (hero.armor?.cursed) {
      ctx.log(TXT_UNEQUIP_CURSED.replace("%s", hero.armor.name));
      return 1;
    }
    const def4 = getItem(hero.armorId);
    const inst = hero.armor;
    addToInventory(hero, hero.armorId, 1, inst ? { armor: inst } : undefined);
    hero.armor = null;
    hero.armorId = null;
    ctx.log(`You take off the ${def4.name}.`);
    return 1;
  }
  const stack = hero.inventory[slot];
  if (!stack) {
    ctx.log("Nothing in that slot.");
    return 1;
  }
  const def3 = getItem(stack.itemId);
  if (def3.type === "weapon")
    return equipWeaponFromInventory(ctx, hero, slot, stack);
  if (def3.type === "armor")
    return equipArmorFromInventory(ctx, hero, slot, stack);
  ctx.log("You can't equip that.");
  return 1;
}
function dropSlot(ctx, hero, slot) {
  if (slot === -1 || slot === -2) {
    const equippedId = slot === -1 ? hero.weaponId : hero.armorId;
    if (!equippedId) {
      ctx.log("Nothing in that slot.");
      return 1;
    }
    const inst = slot === -1 ? hero.weapon : hero.armor;
    if (inst?.cursed) {
      ctx.log(TXT_UNEQUIP_CURSED.replace("%s", inst.name));
      return 1;
    }
    if (slot === -1) {
      hero.weapon = null;
      hero.weaponId = null;
    } else {
      hero.armor = null;
      hero.armorId = null;
    }
    const def4 = getItem(equippedId);
    ctx.level.items.push({
      pos: hero.pos,
      itemId: equippedId,
      sprite: def4.sprite
    });
    ctx.log(`You drop the ${def4.name}.`);
    return 0.5;
  }
  const stack = hero.inventory[slot];
  if (!stack) {
    ctx.log("Nothing in that slot.");
    return 1;
  }
  const removed = removeFromInventory(hero, slot, stack.qty);
  const def3 = getItem(removed.itemId);
  ctx.level.items.push({
    pos: hero.pos,
    itemId: removed.itemId,
    sprite: def3.sprite
  });
  ctx.log(`You drop the ${def3.name}.`);
  return 0.5;
}
var chasmArmed = null;
function stepTowardChasm(ctx, hero, nx, ny) {
  const level = ctx.level;
  const from = hero.pos;
  const to = ny * level.w + nx;
  if (hero.flying) {
    hero.pos = to;
    passiveSearch(ctx, hero);
    return 1;
  }
  if (chasmArmed !== null && chasmArmed.from === from && chasmArmed.to === to) {
    chasmArmed = null;
    return heroFall(ctx, hero);
  }
  chasmArmed = { from, to };
  ctx.log("Do you really want to jump into the chasm? You can probably die.");
  return 0;
}
function heroFall(ctx, hero) {
  chasmArmed = null;
  ctx.log("You fall into the chasm!");
  hero.buffs.cripple = { kind: "cripple", left: CRIPPLE_DURATION };
  const dmg = ctx.rng.intRange(Math.floor(hero.ht / 3), Math.floor(hero.ht / 2));
  const applied = applyDamage(ctx.rng, hero, dmg);
  hero.hp = applied.hp;
  if (applied.paralysisBroken) {
    hero.paralysed = false;
    delete hero.buffs.paralysis;
  }
  if (!hero.isAlive()) {
    ctx.log("You fell to death...");
  }
  return 1;
}
function doorEnter(ctx, x, y) {
  ctx.level.set(x, y, 40 /* OPEN_DOOR */);
}
function doorLeave(ctx, x, y) {
  const level = ctx.level;
  if (!level.items.some((it) => it.pos === level.idx(x, y))) {
    level.set(x, y, 2 /* DOOR */);
  }
}
function trampleHighGrass(ctx, hero, x, y) {
  const level = ctx.level;
  level.set(x, y, 10 /* GRASS */);
  const herbalismLevel = 0;
  if (ctx.rng.int(0, 18) <= ctx.rng.int(0, herbalismLevel + 1)) {
    dropAt(ctx, level.idx(x, y), "seed");
  }
  if (ctx.rng.int(0, 6) <= ctx.rng.int(0, herbalismLevel + 1)) {
    dropAt(ctx, level.idx(x, y), "dewdrop");
  }
}
function dropAt(ctx, pos, itemId) {
  ctx.level.items.push({ pos, itemId, sprite: getItem(itemId).sprite });
}
function pickupDewdrop(ctx, hero, qty) {
  const level = ctx.level;
  const value = 1 + Math.floor((level.depth - 1) / 5);
  const effect = Math.min(hero.ht - hero.hp, value * qty);
  if (effect > 0) {
    hero.hp += effect;
    ctx.log(`+${effect}HP`);
  }
  return 1;
}
function openLockedChest(ctx, hero, item) {
  const level = ctx.level;
  const keySlot = hero.inventory.findIndex((s) => s.itemId === "golden_key");
  if (keySlot === -1) {
    ctx.log("This chest is locked and you don't have matching key");
    return 0;
  }
  removeFromInventory(hero, keySlot, 1);
  level.items = level.items.filter((it) => it !== item);
  const { defId, qty } = parseItemId(item.itemId);
  const def3 = getItem(defId);
  const label = qty > 1 ? `${qty}x ${def3.name}` : def3.name;
  if (def3.type === "gold") {
    hero.gold += qty;
    ctx.log(`You unlock the chest and take ${qty} gold.`);
  } else {
    addToInventory(hero, defId, qty);
    ctx.log(`You unlock the chest and take the ${label}.`);
  }
  return 1;
}
var SIGN_TIPS = [
  "Wear the highest tier armor you can; do not rely on dodging alone.",
  "Enchantments on weapons and armor are potent; identify items to find them.",
  "Dewdrops heal a little; save potions of healing for emergencies.",
  "Do not be afraid to run from a fight you cannot win.",
  "Upgrade scrolls are precious; spend them on gear you will keep.",
  "Mystery meat is risky; cook it at a stove if you can.",
  "Strength potions let you wear heavier gear sooner.",
  "Hidden traps and doors can be found by searching.",
  "Blandfruit can be cooked with seeds for useful meals.",
  "Flies are weak alone; do not let a swarm surround you.",
  "Gnoll scouts hit hard; use doorways to fight them one at a time.",
  "Crabs block a lot of damage; use wands or surprise attacks.",
  "Goo is coming. Fire will keep it from healing.",
  "Fire hurts Goo, but do not stand in it yourself.",
  "Keep your distance from spinners and their webs.",
  "Skeletons hit hard; blind or slow them first.",
  "Thieves steal; kill them before they flee with your gear.",
  "Shaman bolts hurt; break line of sight.",
  "Brutes enrage when hurt; finish them quickly.",
  "DM-300 is coming. Lightning hurts it most.",
  "Lightning wands and surprise attacks bring DM-300 down.",
  "The City awaits. Mind the monks and their disabling strikes."
];
var signCells = new WeakMap;
function noteSignCells(level, cells) {
  signCells.set(level, new Set(cells));
}
var wallDecoCells = new WeakMap;
function noteWallDecoCells(level, cells) {
  wallDecoCells.set(level, new Set(cells));
}
function mineDarkGold(ctx, hero, slot) {
  const stack = hero.inventory[slot];
  if (!stack || stack.itemId !== "pickaxe") {
    ctx.log("Nothing to mine with.");
    return 0;
  }
  if (ctx.level.depth < 11 || ctx.level.depth > 15) {
    ctx.log(TXT_NO_VEIN);
    return 0;
  }
  const veins = wallDecoCells.get(ctx.level);
  const w = ctx.level.w;
  const hx = hero.pos % w;
  const hy = Math.floor(hero.pos / w);
  let vein = null;
  for (let dy = -1;dy <= 1 && vein === null; dy++) {
    for (let dx = -1;dx <= 1; dx++) {
      if (dx === 0 && dy === 0)
        continue;
      const pos = (hy + dy) * w + (hx + dx);
      if (veins?.has(pos)) {
        vein = pos;
        break;
      }
    }
  }
  if (vein === null) {
    ctx.log(TXT_NO_VEIN);
    return 0;
  }
  veins.delete(vein);
  addToInventory(hero, "darkgold", 1);
  ctx.log("You now have dark gold ore");
  if (hero.hungerLevel < STARVING) {
    hero.hungerLevel = satisfy(hero.hungerLevel, -STARVING / 10);
  }
  return 2;
}
var TXT_NO_VEIN = "There is no dark gold vein near you to mine";
function readSign(ctx, hero) {
  const cells = signCells.get(ctx.level);
  if (!cells || !cells.has(hero.pos))
    return 1;
  const index = ctx.level.depth - 1;
  if (index < SIGN_TIPS.length) {
    ctx.log(SIGN_TIPS[index]);
  } else {
    cells.delete(hero.pos);
    ctx.level.set(hero.x, hero.y, 38 /* EMBERS */);
    ctx.log("As you try to read the sign it bursts into greenish flames.");
  }
  return 0;
}
function waitTurn(ctx, hero) {
  return readSign(ctx, hero);
}
function moveHero(ctx, hero, dx, dy) {
  const level = ctx.level;
  if (hero.rooted)
    return 1;
  let nx = hero.x + dx;
  let ny = hero.y + dy;
  if (!level.inBounds(nx, ny))
    return 1;
  const foe = ctx.mobs.find((m) => m.isAlive() && m.x === nx && m.y === ny);
  if (foe) {
    strikeHeroVsMob(ctx, hero, foe, heroAttackSkill(hero, { ranged: false, adjacent: false }), (r) => heroDamageRoll(r, hero, { ranged: false }));
    return 1;
  }
  if (hasBuff(hero, "vertigo")) {
    const step = vertigoRedirect(ctx.rng, hero.pos, level.w, (p) => {
      const px = p % level.w;
      const py = Math.floor(p / level.w);
      return !level.inBounds(px, py) || !level.isPassable(px, py) || ctx.mobs.some((m) => m.isAlive() && m.x === px && m.y === py);
    });
    if (step === null) {
      passiveSearch(ctx, hero);
      return 1;
    }
    nx = step % level.w;
    ny = Math.floor(step / level.w);
  }
  const tile = level.get(nx, ny);
  if (tile === 8 /* CHASM */)
    return stepTowardChasm(ctx, hero, nx, ny);
  if (tile === 3 /* DOOR_LOCKED */) {
    const keySlot = hero.inventory.findIndex((s) => s.itemId === "iron_key");
    if (keySlot === -1) {
      ctx.log("You don't have a matching key");
      return 0;
    }
    level.set(nx, ny, 2 /* DOOR */);
    removeFromInventory(hero, keySlot, 1);
    ctx.log("You unlock the door.");
    return 1;
  }
  if (!level.isPassable(nx, ny))
    return 1;
  if (level.get(hero.x, hero.y) === 40 /* OPEN_DOOR */) {
    doorLeave(ctx, hero.x, hero.y);
  }
  hero.pos = ny * level.w + nx;
  if (!hero.flying) {
    pressTrapCell(ctx, hero.pos, hero, (mobId, pos) => {
      const mob = buildMob(mobId, nextMobId(), pos, level.w);
      mob.state = "wandering";
      ctx.addMob(mob, 2);
    });
    if (ctx.level.depth === 10) {
      pressArenaCell(ctx.level, ctx.rng, hero.pos, {
        occupied: (pos) => pos === hero.pos || ctx.mobs.some((m) => m.y * level.w + m.x === pos),
        spawn: (pos) => {
          const tengu = buildMob("tengu", nextMobId(), pos, level.w);
          tengu.state = "hunting";
          ctx.addMob(tengu);
          tengu.notice(ctx);
        }
      });
    } else if (ctx.level.depth === 15) {
      pressArenaCell2(ctx.level, ctx.rng, hero.pos, {
        occupied: (pos) => pos === hero.pos || ctx.mobs.some((m) => m.y * level.w + m.x === pos),
        spawn: (pos) => {
          const dm300 = buildMob("dm300", nextMobId(), pos, level.w);
          dm300.state = "hunting";
          ctx.addMob(dm300);
          dm300.notice(ctx);
        }
      });
    }
    enterCell(ctx, hero, nx, ny);
  } else if (tile === 2 /* DOOR */) {
    doorEnter(ctx, nx, ny);
  }
  passiveSearch(ctx, hero);
  return 1;
}
function enterCell(ctx, hero, x, y) {
  const t = ctx.level.get(x, y);
  if (t === 39 /* HIGH_GRASS */)
    trampleHighGrass(ctx, hero, x, y);
  else if (t === 2 /* DOOR */)
    doorEnter(ctx, x, y);
}
function searchIntentional(ctx, hero) {
  const level = ctx.level;
  const distance = 1;
  const level_ = intentionalSearchLevel(hero.awareness);
  let found = false;
  for (let dy = -distance;dy <= distance; dy++) {
    for (let dx = -distance;dx <= distance; dx++) {
      const nx = hero.x + dx;
      const ny = hero.y + dy;
      if (!level.inBounds(nx, ny))
        continue;
      if (level.visible[level.idx(nx, ny)] === 0)
        continue;
      const t = level.get(nx, ny);
      if (t === 4 /* DOOR_SECRET */ || isHiddenTrap(t)) {
        if (t === 4 /* DOOR_SECRET */) {
          level.revealSecretDoor(nx, ny);
        } else {
          level.revealTrap(nx, ny);
        }
        found = true;
      }
    }
  }
  if (found) {
    ctx.log("You noticed something");
  }
  return searchTimeCost(ctx.rng, found, level_);
}
function passiveSearch(ctx, hero) {
  const level = ctx.level;
  const chance = passiveSearchLevel(hero.awareness);
  for (let dy = -1;dy <= 1; dy++) {
    for (let dx = -1;dx <= 1; dx++) {
      const nx = hero.x + dx;
      const ny = hero.y + dy;
      if (!level.inBounds(nx, ny))
        continue;
      if (level.visible[level.idx(nx, ny)] === 0)
        continue;
      const t = level.get(nx, ny);
      if ((t === 4 /* DOOR_SECRET */ || isHiddenTrap(t)) && ctx.rng.float(0, 1) < chance) {
        if (t === 4 /* DOOR_SECRET */) {
          level.revealSecretDoor(nx, ny);
        } else {
          level.revealTrap(nx, ny);
        }
      }
    }
  }
}
function tickHeroClock(rng, ctx, hero, cost) {
  hero.hungerClock += cost;
  while (hero.hungerClock >= HUNGER_STEP) {
    hero.hungerClock -= HUNGER_STEP;
    const t = hungerTick(rng, {
      level: hero.hungerLevel,
      hp: hero.hp,
      paralysed: hero.paralysed
    });
    hero.hungerLevel = t.level;
    if (t.becameStarving)
      ctx.log(MSG_STARVING);
    else if (t.becameHungry)
      ctx.log(MSG_HUNGRY);
    if (t.damage > 0) {
      ctx.log(MSG_STARVING);
      hero.hp = Math.max(hero.hp - t.damage, 0);
      if (!hero.isAlive())
        ctx.log(MSG_STARVED_TO_DEATH);
    }
    if (hero.isAlive()) {
      hero.hp = regenTick(hero.hp, hero.ht, isStarving(hero.hungerLevel));
    }
  }
}
function dartTrace(level, from, to) {
  const w = level.w;
  const x0 = from % w;
  const y0 = Math.floor(from / w);
  const x1 = to % w;
  const y1 = Math.floor(to / w);
  const cells = [];
  const distances = new Map;
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  let dist = 0;
  for (;; ) {
    if (dist > 0) {
      if (!level.inBounds(x, y) || level.isOpaque(x, y))
        break;
      const pos = y * w + x;
      cells.push(pos);
      distances.set(pos, dist);
    }
    if (x === x1 && y === y1)
      break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    dist++;
    if (dist > 64)
      break;
  }
  return {
    cells,
    distances,
    landCell: cells.length > 0 ? cells[cells.length - 1] : from
  };
}

// src/ui/palette.ts
var UI = {
  panel: "#f2e3bd",
  panelDark: "#d9c08d",
  panelDeep: "#c8ab72",
  ink: "#14161c",
  scrim: "rgba(10, 8, 14, 0.72)",
  backdrop: "#0d0b12",
  hp: "#d94f3d",
  hpLow: "#a02020",
  hpTrack: "#4a1f1a",
  xp: "#7fc24a",
  xpTrack: "#2c3a1e",
  gold: "#ffd75e",
  boss: "#58c23d",
  bossTrack: "#1e2f1a",
  dmgHero: "#ff6b5e",
  dmgMob: "#ffe9a8",
  heal: "#8fe07a",
  buffBurn: "#e07b39",
  buffPoison: "#7fc24a",
  buffOoze: "#58c23d",
  buffPara: "#b48ce0",
  buffRoot: "#a9713f",
  text: "#2b2118",
  textLight: "#f5ecd4",
  textDim: "#8a7a5c",
  log: "#f5ecd4",
  accent: "#2f6f9f",
  danger: "#c0392b"
};
var TAP = 44;
function inRect(r, x, y) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
function drawPanel(ctx, r, radius = 10) {
  ctx.fillStyle = UI.scrim;
  ctx.fillStyle = UI.panel;
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = 3;
  roundRect(ctx, r, radius);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,250,235,0.65)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(r.x + radius, r.y + 3);
  ctx.lineTo(r.x + r.w - radius, r.y + 3);
  ctx.stroke();
}
function roundRect(ctx, r, radius) {
  const rr = Math.min(radius, r.w / 2, r.h / 2);
  ctx.beginPath();
  ctx.moveTo(r.x + rr, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rr);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rr);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rr);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rr);
  ctx.closePath();
}
function drawBar(ctx, r, frac, fill, track, label, labelSize = 11) {
  const f = Math.max(0, Math.min(1, frac));
  ctx.fillStyle = track;
  roundRect(ctx, r, r.h / 2);
  ctx.fill();
  if (f > 0) {
    ctx.fillStyle = fill;
    const fw = Math.max(r.h, r.w * f);
    roundRect(ctx, { x: r.x, y: r.y, w: Math.min(fw, r.w), h: r.h }, r.h / 2);
    ctx.fill();
  }
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = 2;
  roundRect(ctx, r, r.h / 2);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = 3;
  ctx.font = `bold ${labelSize}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2 + 0.5;
  ctx.strokeText(label, cx, cy);
  ctx.fillText(label, cx, cy);
  ctx.textAlign = "left";
}
function drawButton(ctx, r, label, opts = {}) {
  const { disabled = false, primary = false, fontSize = 16 } = opts;
  ctx.fillStyle = disabled ? "#9a8f78" : primary ? "#e8a33d" : UI.panel;
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = 3;
  roundRect(ctx, r, 10);
  ctx.fill();
  ctx.stroke();
  if (!disabled && primary) {
    ctx.strokeStyle = "rgba(255,250,235,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r.x + 10, r.y + 3);
    ctx.lineTo(r.x + r.w - 10, r.y + 3);
    ctx.stroke();
  }
  ctx.fillStyle = disabled ? "#5c5344" : UI.text;
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
  ctx.textAlign = "left";
}
function drawCoin(ctx, cx, cy, r) {
  ctx.fillStyle = UI.gold;
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#b8860b";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}
function drawDrumstick(ctx, x, y, s) {
  ctx.fillStyle = "#c98a5a";
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x + s * 0.42, y + s * 0.42, s * 0.34, s * 0.28, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#f5ecd4";
  ctx.lineWidth = s * 0.14;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.62, y + s * 0.62);
  ctx.lineTo(x + s * 0.94, y + s * 0.94);
  ctx.stroke();
  ctx.fillStyle = "#f5ecd4";
  ctx.beginPath();
  ctx.arc(x + s * 0.94, y + s * 0.9, s * 0.1, 0, Math.PI * 2);
  ctx.fill();
}

// src/ui/dialog.ts
var queue = [];
function showDialog(req) {
  return new Promise((resolve) => {
    queue.push({ ...req, resolve });
  });
}
function currentDialog() {
  return queue.length > 0 ? queue[0] : null;
}
function dialogOpen() {
  return queue.length > 0;
}
function resolveDialog(value) {
  const head = queue.shift();
  if (!head)
    return false;
  head.resolve(value);
  return true;
}
function dismissDialog() {
  return resolveDialog("");
}
var uiBridge = { current: null };
var FONT = "14px system-ui, sans-serif";
var TITLE_FONT = "bold 15px system-ui, sans-serif";
var BTN_FONT = "bold 14px system-ui, sans-serif";
var HIGHLIGHT = "#8a5c00";
var PAD = 16;
var MAX_W = 440;
function splitHighlight(text) {
  const out = [];
  const parts = text.split(/(_[^_]+_)/g);
  for (const p of parts) {
    if (p.length === 0)
      continue;
    if (p.startsWith("_") && p.endsWith("_") && p.length >= 2) {
      out.push({ text: p.slice(1, -1), hi: true });
    } else {
      out.push({ text: p, hi: false });
    }
  }
  return out;
}
function wrapLines(ctx, text, maxW) {
  const lines = [];
  for (const para of text.split(`
`)) {
    const segs = splitHighlight(para);
    const words = [];
    for (const s of segs) {
      for (const w of s.text.split(/\s+/)) {
        if (w.length > 0)
          words.push({ text: w, hi: s.hi });
      }
    }
    let line = [];
    let lineW = 0;
    ctx.font = FONT;
    for (const w of words) {
      const ww = ctx.measureText(w.text + " ").width;
      if (line.length > 0 && lineW + ww > maxW) {
        lines.push(line);
        line = [];
        lineW = 0;
      }
      line.push(w);
      lineW += ww;
    }
    lines.push(line);
  }
  return lines;
}
function drawLine(ctx, line, x, y) {
  ctx.font = FONT;
  ctx.textBaseline = "alphabetic";
  let cx = x;
  for (const w of line) {
    ctx.fillStyle = w.hi ? HIGHLIGHT : UI.text;
    ctx.fillText(w.text, cx, y);
    cx += ctx.measureText(w.text + " ").width;
  }
}
function roundPanel(ctx, r, rad) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, rad);
}

class Dialogs {
  layout = null;
  get open() {
    return dialogOpen();
  }
  draw(ctx, sprites, view) {
    const dlg = currentDialog();
    if (!dlg) {
      this.layout = null;
      return;
    }
    const choices = dlg.choices.length > 0 ? dlg.choices : [{ label: "Continue", value: "" }];
    ctx.fillStyle = UI.scrim;
    ctx.fillRect(0, 0, view.w, view.h);
    const pw = Math.min(view.w - 48, MAX_W);
    const px = (view.w - pw) / 2;
    const textW = pw - PAD * 2;
    const lines = wrapLines(ctx, dlg.text, textW);
    const lineH = 20;
    const textH = lines.length * lineH;
    const btnH = Math.max(TAP, 40);
    const btnGap = 8;
    const titleH = 40;
    const ph = PAD + titleH + 8 + textH + 12 + choices.length * (btnH + btnGap) - btnGap + PAD;
    const py = Math.max(24, (view.h - ph) / 2 - 20);
    ctx.fillStyle = UI.panel;
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = 3;
    roundPanel(ctx, { x: px, y: py, w: pw, h: ph }, 10);
    ctx.fill();
    ctx.stroke();
    let ty = py + PAD;
    if (dlg.sprite) {
      try {
        const img = sprites.entitySprite(dlg.sprite);
        ctx.drawImage(img, px + PAD, ty, 28, 28);
      } catch {}
    }
    ctx.font = TITLE_FONT;
    ctx.fillStyle = UI.text;
    ctx.textBaseline = "middle";
    ctx.fillText(dlg.title, px + PAD + (dlg.sprite ? 36 : 0), ty + 15);
    ty += titleH;
    ctx.strokeStyle = UI.panelDeep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + PAD, ty);
    ctx.lineTo(px + pw - PAD, ty);
    ctx.stroke();
    ty += 8;
    for (const line of lines) {
      drawLine(ctx, line, px + PAD, ty + 14);
      ty += lineH;
    }
    ty += 12;
    const buttons = [];
    for (const c of choices) {
      const r = { x: px + PAD, y: ty, w: pw - PAD * 2, h: btnH, value: c.value };
      buttons.push(r);
      ctx.fillStyle = UI.panelDark;
      ctx.strokeStyle = UI.ink;
      ctx.lineWidth = 2;
      roundPanel(ctx, r, 8);
      ctx.fill();
      ctx.stroke();
      ctx.font = BTN_FONT;
      ctx.fillStyle = UI.text;
      ctx.textBaseline = "middle";
      const tw = ctx.measureText(c.label).width;
      ctx.fillText(c.label, r.x + (r.w - tw) / 2, r.y + r.h / 2 + 1);
      ty += btnH + btnGap;
    }
    ctx.textBaseline = "alphabetic";
    this.layout = { panel: { x: px, y: py, w: pw, h: ph }, buttons };
  }
  handleTap(x, y) {
    const dlg = currentDialog();
    if (!dlg)
      return false;
    const layout = this.layout;
    if (layout) {
      for (const b of layout.buttons) {
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          resolveDialog(b.value);
          return true;
        }
      }
      const p = layout.panel;
      if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) {
        return true;
      }
    }
    dismissDialog();
    return true;
  }
  handleKey(key) {
    const dlg = currentDialog();
    if (!dlg)
      return false;
    if (key === "Escape") {
      dismissDialog();
      return true;
    }
    const n = parseInt(key, 10);
    const choices = dlg.choices.length > 0 ? dlg.choices : [{ label: "Continue", value: "" }];
    if (!Number.isNaN(n) && n >= 1 && n <= choices.length) {
      resolveDialog(choices[n - 1].value);
      return true;
    }
    return true;
  }
}

// src/content/shopkeeper.ts
function unitPriceOf(itemId) {
  try {
    const { defId } = parseItemId(itemId);
    return getItem(defId).price ?? 0;
  } catch {
    return 0;
  }
}
function shopBuyPrice(unitPrice, depth, haggling = false) {
  let price = unitPrice * 5 * (Math.floor(depth / 5) + 1);
  if (haggling && price >= 2)
    price = Math.floor(price / 2);
  return price;
}
function shopSellAllPrice(unitPrice, qty) {
  return unitPrice * qty;
}
function shopSellOnePrice(stackPrice, qty) {
  return Math.floor(stackPrice / qty);
}
function readShopStock(game) {
  const out = [];
  game.level.items.forEach((it, levelIndex) => {
    if (!it.forSale)
      return;
    const { defId, qty } = parseItemId(it.itemId);
    let name = it.itemId;
    let sprite = it.sprite;
    try {
      const def3 = getItem(defId);
      name = def3.name;
      sprite = def3.sprite;
    } catch {}
    out.push({ levelIndex, pos: it.pos, itemId: it.itemId, qty, name, sprite, unitPrice: unitPriceOf(it.itemId) });
  });
  return out;
}
function stockBuyPrice(entry, depth, haggling = false) {
  return shopBuyPrice(entry.unitPrice, depth, haggling) * entry.qty;
}
function readSellable(game) {
  const hero = game.hero;
  const out = [];
  hero.inventory.forEach((stack, slot) => {
    const unitPrice = unitPriceOf(stack.itemId);
    if (unitPrice <= 0)
      return;
    const { defId } = parseItemId(stack.itemId);
    let name = stack.itemId;
    let sprite = "scroll";
    try {
      const def3 = getItem(defId);
      name = def3.name;
      sprite = def3.sprite;
    } catch {}
    out.push({ slot, itemId: stack.itemId, name, sprite, qty: stack.qty, equipped: false, unitPrice });
  });
  for (const [slot, id, equipped] of [
    [-1, hero.weaponId, true],
    [-2, hero.armorId, true]
  ]) {
    if (!id)
      continue;
    const unitPrice = unitPriceOf(id);
    if (unitPrice <= 0)
      continue;
    const def3 = getItem(parseItemId(id).defId);
    out.push({ slot, itemId: id, name: def3.name, sprite: def3.sprite, qty: 1, equipped, unitPrice });
  }
  return out;
}
function buyFromShop(game, entry, haggling = false) {
  const hero = game.hero;
  const placed = game.level.items[entry.levelIndex];
  if (!placed || !placed.forSale || placed.pos !== entry.pos) {
    return { ok: false, reason: "gone" };
  }
  const price = stockBuyPrice(entry, game.level.depth, haggling);
  if (hero.gold < price)
    return { ok: false, reason: "no-gold" };
  hero.gold -= price;
  game.level.items.splice(entry.levelIndex, 1);
  const { defId, qty } = parseItemId(entry.itemId);
  addToInventory(hero, defId, qty);
  game.logMsg(`You've bought ${entry.name} for ${price}g.`);
  return { ok: true, price };
}
function sellToShop(game, entry, which) {
  const hero = game.hero;
  let stack;
  if (entry.slot === -1) {
    if (hero.weaponId !== entry.itemId)
      return { ok: false, reason: "gone" };
    if (hero.weapon?.cursed)
      return { ok: false, reason: "cursed" };
    const inst = hero.weapon;
    addToInventory(hero, hero.weaponId, 1, inst ? { weapon: inst } : undefined);
    hero.weapon = null;
    hero.weaponId = null;
    stack = hero.inventory[hero.inventory.length - 1];
  } else if (entry.slot === -2) {
    if (hero.armorId !== entry.itemId)
      return { ok: false, reason: "gone" };
    if (hero.armor?.cursed)
      return { ok: false, reason: "cursed" };
    const inst = hero.armor;
    addToInventory(hero, hero.armorId, 1, inst ? { armor: inst } : undefined);
    hero.armor = null;
    hero.armorId = null;
    stack = hero.inventory[hero.inventory.length - 1];
  } else {
    stack = hero.inventory[entry.slot];
  }
  if (!stack || stack.itemId !== entry.itemId)
    return { ok: false, reason: "gone" };
  const stackPrice = shopSellAllPrice(entry.unitPrice, stack.qty);
  let price;
  if (which === "one" && stack.qty > 1) {
    price = shopSellOnePrice(stackPrice, stack.qty);
    stack.qty -= 1;
  } else {
    price = stackPrice;
    hero.inventory.splice(hero.inventory.indexOf(stack), 1);
  }
  hero.gold += price;
  game.logMsg(`You've sold your ${entry.name} for ${price}g.`);
  return { ok: true, price };
}
class Shopkeeper {
  name = "shopkeeper";
  sprite = "mob_shopkeeper";
  onTalk(ctx) {
    ctx.openShop("sell");
  }
  description() {
    return "This stout guy looks more appropriate for a trade district in some large city " + "than for a dungeon. His prices explain why he prefers to do business here.";
  }
}

// src/content/npcs.ts
function freshGhostQuest() {
  return {
    spawned: false,
    type: null,
    given: false,
    processed: false,
    depth: 0,
    left2kill: 8,
    weaponId: null,
    armorId: null
  };
}
var ghostQuest = freshGhostQuest();
function freshWandmakerQuest() {
  return { spawned: false, type: null, given: false, wand1: null, wand2: null };
}
var wandmakerQuest = freshWandmakerQuest();
function resetQuestState() {
  Object.assign(ghostQuest, freshGhostQuest());
  Object.assign(wandmakerQuest, freshWandmakerQuest());
  Object.assign(blacksmithQuest, freshBlacksmithQuest());
}
function freshBlacksmithQuest() {
  return {
    spawned: false,
    alternative: false,
    given: false,
    completed: false,
    reforged: false
  };
}
var blacksmithQuest = freshBlacksmithQuest();
function saveQuestState() {
  return {
    ghost: { ...ghostQuest },
    wandmaker: { ...wandmakerQuest },
    blacksmith: { ...blacksmithQuest }
  };
}
function restoreQuestState(data) {
  Object.assign(ghostQuest, freshGhostQuest(), data?.ghost ?? {});
  Object.assign(wandmakerQuest, freshWandmakerQuest(), data?.wandmaker ?? {});
  Object.assign(blacksmithQuest, freshBlacksmithQuest(), data?.blacksmith ?? {});
}
function initGhostQuest(rng, depth) {
  ghostQuest.spawned = true;
  const t = rng.int(0, 3);
  ghostQuest.type = t === 0 ? "rose" : t === 1 ? "rat" : "curse";
  if (ghostQuest.type === "rose")
    ghostQuest.left2kill = 8;
  ghostQuest.given = false;
  ghostQuest.processed = false;
  ghostQuest.depth = depth;
  let weaponId = "";
  for (let i = 0;i < 4; i++) {
    let id = itemGenerator.randomFrom(rng, "weapon", depth);
    while (getItem(id).weapon?.missile === true) {
      id = itemGenerator.randomFrom(rng, "weapon", depth);
    }
    if (weaponId === "")
      weaponId = id;
  }
  ghostQuest.weaponId = weaponId;
  let armorId = "";
  for (let i = 0;i < 4; i++) {
    const id = itemGenerator.randomFrom(rng, "armor", depth);
    if (armorId === "")
      armorId = id;
  }
  ghostQuest.armorId = armorId;
}
function initWandmakerQuest(rng, waterCells, levelLength) {
  wandmakerQuest.spawned = true;
  const t = rng.int(0, 3);
  let type = t === 0 ? "berry" : t === 1 ? "dust" : "fish";
  if (type === "fish" && waterCells > levelLength / 16) {
    type = rng.int(0, 2) === 0 ? "berry" : "dust";
  }
  wandmakerQuest.type = type;
  wandmakerQuest.given = false;
  const battle = ["avalanche", "disintegration", "firebolt", "lightning", "poison"];
  const nonBattle = ["amok", "blink", "regrowth", "slowness", "reach"];
  wandmakerQuest.wand1 = createWandReward(rng, rng.pick(battle));
  wandmakerQuest.wand2 = createWandReward(rng, rng.pick(nonBattle));
}
function randomRespawnCell2(ctx) {
  const level = ctx.level;
  const n = level.w * level.h;
  for (let i = 0;i < 100; i++) {
    const pos = ctx.rng.int(0, n);
    const x = pos % level.w;
    const y = Math.floor(pos / level.w);
    if (!level.isPassable(x, y))
      continue;
    if (level.visible[pos] !== 0)
      continue;
    if (charAtPos(ctx, pos) != null)
      continue;
    return pos;
  }
  return -1;
}
function questItemSlot(hero, itemId) {
  return hero.inventory.findIndex((s) => s.itemId === itemId);
}
function heroClassName() {
  return "warrior";
}
function fillClassName(text) {
  return text.replace("%s", heroClassName());
}
function npcDef(id, name, sprite, speed, flying) {
  return {
    id,
    name,
    sprite,
    hp: 1,
    def: 1000,
    atk: 1,
    dmgMin: 1,
    dmgMax: 2,
    triangular: true,
    dr: 0,
    speed,
    flying,
    ability: null,
    attackDelay: 1,
    immunities: [],
    resistances: [],
    exp: 0,
    maxLvl: 0
  };
}

class NpcMob extends ContentMob {
  constructor(id, def3, pos, w) {
    super(id, def3, pos, w);
    this.invulnerable = true;
    this.hostile = false;
  }
  onTalk(_ctx) {}
  takeTurn(ctx) {
    this.throwItem(ctx);
    return super.takeTurn(ctx);
  }
  throwItem(ctx) {
    const level = ctx.level;
    const idx = level.items.findIndex((it) => it.pos === this.pos);
    if (idx === -1)
      return;
    const dirs = [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1]
    ];
    ctx.rng.shuffle(dirs);
    for (const [dx, dy] of dirs) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      if (level.isPassable(nx, ny)) {
        const [item] = level.items.splice(idx, 1);
        level.items.push({ ...item, pos: ny * level.w + nx });
        return;
      }
    }
  }
}
var TXT_ROSE1 = "Hello adventurer... Once I was like you - strong and confident... " + "And now I'm dead... But I can't leave this place... Not until I have my _dried rose_... " + "It's very important to me... Some monster stole it from my body...";
var TXT_ROSE2 = "Please... Help me... _Find the rose_...";
var TXT_ROSE3 = "Yes! Yes!!! This is it! Please give it to me! " + "And you can take one of these items, maybe they " + "will be useful to you in your journey...";
var TXT_RAT1 = "Hello adventurer... Once I was like you - strong and confident... " + "And now I'm dead... But I can't leave this place... Not until I have my revenge... " + "Slay the _fetid rat_, that has taken my life...";
var TXT_RAT2 = "Please... Help me... _Slay the abomination_...";
var TXT_RAT3 = "Yes! The ugly creature is slain and I can finally rest... " + "Please take one of these items, maybe they " + "will be useful to you in your journey...";
var TXT_CURSE1 = "Hello adventurer... Once I was like you - strong and confident... " + "And now I'm dead... But I can't leave this place, as I am bound by a horrid curse... " + "Please... Help me... _Destroy the curse_...";
var TXT_CURSE2 = "Thank you, %s! The curse is broken and I can finally rest... " + "Please take one of these items, maybe they " + "will be useful to you in your journey...";
var TXT_CURSE_YES = "Yes, I will do it for you";
var TXT_CURSE_NO = "No, I can't help you";
var TXT_FAREWELL_GHOST = "The sad ghost yells: Farewell, adventurer!";
var TXT_WEAPON = "Ghost's weapon";
var TXT_ARMOR = "Ghost's armor";

class GhostMob extends NpcMob {
  constructor(id, pos, w) {
    super(id, npcDef("ghost", "sad ghost", "mob_ghost", 0.5, true), pos, w);
    this.state = "wandering";
  }
  selectEnemy(_ctx) {
    return null;
  }
  onTalk(ctx) {
    const type = ghostQuest.type ?? "rose";
    if (type === "rose")
      this.roseInteract(ctx);
    else if (type === "rat")
      this.ratInteract(ctx);
    else
      this.curseInteract(ctx);
  }
  async roseInteract(ctx) {
    const hero = heroOf(ctx);
    if (ghostQuest.given) {
      const slot = questItemSlot(hero, "dried_rose");
      if (slot !== -1) {
        await showDialog({
          title: "Sad ghost",
          sprite: this.sprite,
          text: TXT_ROSE3,
          choices: [
            { label: TXT_WEAPON, value: "weapon" },
            { label: TXT_ARMOR, value: "armor" }
          ]
        }).then((v) => grantGhostReward(ctx, this, "dried_rose", v));
      } else {
        await showDialog({ title: "Sad ghost", sprite: this.sprite, text: TXT_ROSE2, choices: [] });
        relocateGhost(ctx, this);
      }
    } else {
      await showDialog({ title: "Sad ghost", sprite: this.sprite, text: TXT_ROSE1, choices: [] });
      ghostQuest.given = true;
    }
  }
  async ratInteract(ctx) {
    const hero = heroOf(ctx);
    if (ghostQuest.given) {
      const slot = questItemSlot(hero, "rat_skull");
      if (slot !== -1) {
        await showDialog({
          title: "Sad ghost",
          sprite: this.sprite,
          text: TXT_RAT3,
          choices: [
            { label: TXT_WEAPON, value: "weapon" },
            { label: TXT_ARMOR, value: "armor" }
          ]
        }).then((v) => grantGhostReward(ctx, this, "rat_skull", v));
      } else {
        await showDialog({ title: "Sad ghost", sprite: this.sprite, text: TXT_RAT2, choices: [] });
        relocateGhost(ctx, this);
      }
    } else {
      await showDialog({ title: "Sad ghost", sprite: this.sprite, text: TXT_RAT1, choices: [] });
      ghostQuest.given = true;
    }
  }
  async curseInteract(ctx) {
    if (ghostQuest.given) {
      await showDialog({
        title: "Sad ghost",
        sprite: this.sprite,
        text: fillClassName(TXT_CURSE2),
        choices: [
          { label: TXT_WEAPON, value: "weapon" },
          { label: TXT_ARMOR, value: "armor" }
        ]
      }).then((v) => grantGhostReward(ctx, this, null, v));
      return;
    }
    const choice = await showDialog({
      title: "Sad ghost",
      sprite: this.sprite,
      text: TXT_CURSE1,
      choices: [
        { label: TXT_CURSE_YES, value: "yes" },
        { label: TXT_CURSE_NO, value: "no" }
      ]
    });
    if (choice === "yes") {
      ghostQuest.given = true;
      const curse = new CurseMob(nextNpcId(), this.pos, this.w, ctx.level.depth);
      ctx.removeMob(this);
      ctx.addMob(curse, 0);
    } else if (choice === "no") {
      relocateGhost(ctx, this);
    }
  }
}
function relocateGhost(ctx, ghost) {
  let newPos = -1;
  for (let i = 0;i < 10; i++) {
    newPos = randomRespawnCell2(ctx);
    if (newPos !== -1)
      break;
  }
  if (newPos !== -1) {
    ghost.pos = newPos;
    ctx.syncMobs();
  }
}
function grantGhostReward(ctx, ghost, questItemId, value) {
  if (value !== "weapon" && value !== "armor")
    return;
  const hero = heroOf(ctx);
  if (questItemId !== null) {
    const slot = questItemSlot(hero, questItemId);
    if (slot !== -1)
      removeFromInventory(hero, slot, 1);
  }
  const rewardId = value === "weapon" ? ghostQuest.weaponId : ghostQuest.armorId;
  if (rewardId) {
    addToInventory(hero, rewardId, 1);
    ctx.log(`You now have the ${getItem(rewardId).name}.`);
  }
  ctx.log(TXT_FAREWELL_GHOST);
  killMob(ctx, ghost, {});
  ghostQuest.weaponId = null;
  ghostQuest.armorId = null;
}
function onSewersKill(ctx, pos) {
  if (!ghostQuest.spawned || !ghostQuest.given || ghostQuest.processed || ghostQuest.depth !== ctx.level.depth) {
    return;
  }
  if (ghostQuest.type === "rose") {
    if (ctx.rng.int(0, ghostQuest.left2kill) === 0) {
      dropItemAt(ctx, pos, "dried_rose");
      ghostQuest.processed = true;
    } else {
      ghostQuest.left2kill--;
    }
  } else if (ghostQuest.type === "rat") {
    const rat = new FetidRatMob(nextNpcId(), 0, ctx.level.w);
    rat.pos = randomRespawnCell2(ctx);
    if (rat.pos !== -1) {
      ctx.addMob(rat, 0);
      ghostQuest.processed = true;
    }
  }
}
var TXT_BERRY1 = "Oh, what a pleasant surprise to meet a decent person in such place! I came here for a rare ingredient - " + "a _Rotberry seed_. Being a magic user, I'm quite able to defend myself against local monsters, " + "but I'm getting lost in no time, it's very embarrassing. Probably you could help me? I would be " + "happy to pay for your service with one of my best wands.";
var TXT_BERRY2 = "Any luck with a _Rotberry seed_, %s? No? Don't worry, I'm not in a hurry.";
var TXT_DUST1 = "Oh, what a pleasant surprise to meet a decent person in such place! I came here for a rare ingredient - " + "_corpse dust_. It can be gathered from skeletal remains and there is an ample number of them in the dungeon. " + "Being a magic user, I'm quite able to defend myself against local monsters, but I'm getting lost in no time, " + "it's very embarrassing. Probably you could help me? I would be happy to pay for your service with one of my best wands.";
var TXT_DUST2 = "Any luck with _corpse dust_, %s? Bone piles are the most obvious places to look.";
var TXT_FISH1 = "Oh, what a pleasant surprise to meet a decent person in such place! I came here for a rare ingredient: " + "a _phantom fish_. You can catch it with your bare hands, but it's very hard to notice in the water. " + "Being a magic user, I'm quite able to defend myself against local monsters, but I'm getting lost in no time, " + "it's very embarrassing. Probably you could help me? I would be happy to pay for your service with one of my best wands.";
var TXT_FISH2 = "Any luck with a _phantom fish_, %s? You may want to try searching for it in one of the local pools.";
var TXT_FAREWELL_WANDMAKER = "Good luck in your quest, %s!";
var TXT_BATTLE = "Battle wand";
var TXT_NON_BATTLE = "Non-battle wand";

class WandmakerMob extends NpcMob {
  constructor(id, pos, w) {
    super(id, npcDef("wandmaker", "old wandmaker", "mob_wandmaker", 1, false), pos, w);
    this.state = "passive";
  }
  onTalk(ctx) {
    this.interact(ctx);
  }
  async interact(ctx) {
    const type = wandmakerQuest.type ?? "berry";
    const texts = type === "berry" ? { q1: TXT_BERRY1, q2: TXT_BERRY2, item: "rotberry_seed" } : type === "dust" ? { q1: TXT_DUST1, q2: TXT_DUST2, item: "corpse_dust" } : { q1: TXT_FISH1, q2: TXT_FISH2, item: "phantom_fish" };
    if (wandmakerQuest.given) {
      const slot = questItemSlot(heroOf(ctx), texts.item);
      if (slot !== -1) {
        await showDialog({
          title: "Old wandmaker",
          sprite: this.sprite,
          text: fillClassName(type === "berry" ? TXT_BERRY_REWARD : type === "dust" ? TXT_DUST_REWARD : TXT_FISH_REWARD),
          choices: [
            { label: TXT_BATTLE, value: "battle" },
            { label: TXT_NON_BATTLE, value: "nonbattle" }
          ]
        }).then((v) => grantWandReward(ctx, this, texts.item, v));
      } else {
        await showDialog({
          title: "Old wandmaker",
          sprite: this.sprite,
          text: fillClassName(texts.q2),
          choices: []
        });
      }
    } else {
      await showDialog({ title: "Old wandmaker", sprite: this.sprite, text: texts.q1, choices: [] });
      wandmakerQuest.given = true;
      placeWandmakerItem(ctx, type);
    }
  }
}
var TXT_BERRY_REWARD = TXT_FAREWELL_WANDMAKER;
var TXT_DUST_REWARD = TXT_FAREWELL_WANDMAKER;
var TXT_FISH_REWARD = TXT_FAREWELL_WANDMAKER;
function grantWandReward(ctx, wandmaker, questItemId, value) {
  if (value !== "battle" && value !== "nonbattle")
    return;
  const hero = heroOf(ctx);
  const slot = questItemSlot(hero, questItemId);
  if (slot !== -1)
    removeFromInventory(hero, slot, 1);
  const rewardId = value === "battle" ? wandmakerQuest.wand1 : wandmakerQuest.wand2;
  const grantId = resolveWandRewardInstance(ctx.rng, rewardId);
  if (grantId) {
    const parsed = parseWandId(grantId);
    if (parsed)
      identifyWandType(parsed.wandId, ctx.log);
    addToInventory(hero, grantId, 1);
    ctx.log(`You now have the ${instanceItemDef(grantId)?.name ?? grantId}.`);
  }
  ctx.log(fillClassName("The old wandmaker yells: " + TXT_FAREWELL_WANDMAKER));
  ctx.removeMob(wandmaker);
  wandmakerQuest.wand1 = null;
  wandmakerQuest.wand2 = null;
}
function resolveWandRewardInstance(rng, rewardId) {
  if (rewardId === null)
    return null;
  if (getWandState(rewardId))
    return rewardId;
  const parsed = parseWandId(rewardId);
  if (!parsed)
    return null;
  return createWandReward(rng, parsed.wandId);
}
function placeWandmakerItem(ctx, type) {
  if (type === "berry") {
    let pos = randomRespawnCell2(ctx);
    let guard = 0;
    while (pos !== -1 && ctx.level.items.some((it) => it.pos === pos) && guard++ < 100) {
      pos = randomRespawnCell2(ctx);
    }
    if (pos !== -1)
      dropItemAt(ctx, pos, "rotberry_seed");
  } else if (type === "dust") {
    let pos = randomRespawnCell2(ctx);
    let guard = 0;
    while (pos !== -1 && ctx.level.items.some((it) => it.pos === pos) && guard++ < 100) {
      pos = randomRespawnCell2(ctx);
    }
    if (pos !== -1)
      dropItemAt(ctx, pos, "corpse_dust");
  } else {
    const n = ctx.level.w * ctx.level.h;
    let placed = false;
    for (let i = 0;i < 100; i++) {
      const pos = ctx.rng.int(0, n);
      if (ctx.level.getAt(pos) === 9 /* WATER */) {
        dropItemAt(ctx, pos, "phantom_fish");
        placed = true;
        break;
      }
    }
    if (!placed) {
      let pos = randomRespawnCell2(ctx);
      let guard = 0;
      while (pos !== -1 && ctx.level.items.some((it) => it.pos === pos) && guard++ < 100) {
        pos = randomRespawnCell2(ctx);
      }
      if (pos !== -1)
        dropItemAt(ctx, pos, "phantom_fish");
    }
  }
}

class FetidRatMob extends ContentMob {
  constructor(id, pos, w) {
    super(id, {
      id: "fetidrat",
      name: "fetid rat",
      sprite: "mob_fetidrat",
      hp: 15,
      def: 5,
      atk: 12,
      dmgMin: 2,
      dmgMax: 6,
      dr: 2,
      speed: 1,
      flying: false,
      attackDelay: 1,
      triangular: true,
      ability: "fetidrat",
      immunities: ["paralysis"],
      resistances: [],
      exp: 3,
      maxLvl: 5
    }, pos, w);
    this.state = "wandering";
  }
  onDeath(ctx) {
    dropItemAt(ctx, this.pos, "rat_skull");
  }
}

class CurseMob extends ContentMob {
  constructor(id, pos, w, depth) {
    super(id, {
      id: "curse",
      name: "curse personification",
      sprite: "mob_curse",
      hp: 10 + depth * 3,
      def: 10 + depth,
      atk: 10 + depth,
      dmgMin: 3,
      dmgMax: 5,
      dr: 1,
      speed: 0.5,
      flying: true,
      attackDelay: 1,
      triangular: true,
      ability: null,
      immunities: ["death", "terror", "paralysis"],
      resistances: [],
      exp: 3,
      maxLvl: 5
    }, pos, w);
    this.state = "hunting";
  }
  attackProc(ctx, hero, damage) {
    const w = this.w;
    const dx = hero.pos % w - this.pos % w;
    const dy = Math.floor(hero.pos / w) - Math.floor(this.pos / w);
    if (Math.max(Math.abs(dx), Math.abs(dy)) === 1) {
      const nx = hero.pos % w + dx;
      const ny = Math.floor(hero.pos / w) + dy;
      const newPos = ny * w + nx;
      if (ctx.level.isPassable(nx, ny) && charAtPos(ctx, newPos) == null) {
        hero.pos = newPos;
        ctx.syncMobs();
        pressTrapCell(ctx, newPos, hero, () => {
          return;
        });
      }
    }
    return damage;
  }
  takeTurn(ctx) {
    if (this.hp > 0 && this.hp < this.ht)
      this.hp++;
    return super.takeTurn(ctx);
  }
  onDeath(ctx) {
    const ghost = new GhostMob(nextNpcId(), this.pos, this.w);
    ghost.state = "passive";
    ctx.addMob(ghost, 0);
  }
}

class ShopkeeperMob extends NpcMob {
  keeper = new Shopkeeper;
  constructor(id, pos, w) {
    super(id, npcDef("shopkeeper", "shopkeeper", "mob_shopkeeper", 1, false), pos, w);
    this.state = "passive";
  }
  onTalk(_ctx) {
    this.keeper.onTalk({
      game: { level: _ctx.level },
      openShop: (mode) => uiBridge.current?.openShop(mode)
    });
  }
  description() {
    return this.keeper.description();
  }
}
var TXT_GOLD_1 = "Hey human! Wanna be useful, eh? Take dis pickaxe and mine me some _dark gold ore_, _15 pieces_ should be enough. " + `What do you mean, how am I gonna pay? You greedy...
` + "Ok, ok, I don't have money to pay, but I can do some smithin' for you. Consider yourself lucky, " + "I'm the only blacksmith around.";
var TXT_BLOOD_1 = "Hey human! Wanna be useful, eh? Take dis pickaxe and _kill a bat_ wit' it, I need its blood on the head. " + `What do you mean, how am I gonna pay? You greedy...
` + "Ok, ok, I don't have money to pay, but I can do some smithin' for you. Consider yourself lucky, " + "I'm the only blacksmith around.";
var TXT2 = "Are you kiddin' me? Where is my pickaxe?!";
var TXT3 = "Dark gold ore. 15 pieces. Seriously, is it dat hard?";
var TXT4 = "I said I need bat blood on the pickaxe. Chop chop!";
var TXT_COMPLETED = "Oh, you have returned... Better late dan never.";
var TXT_GET_LOST = "I'm busy. Get lost!";
var TXT_LOOKS_BETTER = "your %s certainly looks better now";
var TXT_REFORGE_PROMPT = "Ok, a deal is a deal, dat's what I can do for you: I can reforge " + "2 items and turn them into one of a better quality.";
var TXT_REFORGE_SELECT = "Select an item to reforge";
var TXT_REFORGE_BUTTON = "Reforge them";

class BlacksmithMob extends NpcMob {
  constructor(id, pos, w) {
    super(id, npcDef("blacksmith", "troll blacksmith", "npc_blacksmith", 1, false), pos, w);
    this.state = "passive";
  }
  onTalk(ctx) {
    this.interact(ctx);
  }
  async interact(ctx) {
    const hero = heroOf(ctx);
    const q = blacksmithQuest;
    if (!q.given) {
      await showDialog({
        title: "Troll blacksmith",
        sprite: this.sprite,
        text: q.alternative ? TXT_BLOOD_1 : TXT_GOLD_1,
        choices: []
      });
      q.given = true;
      q.completed = false;
      addToInventory(hero, "pickaxe", 1);
      ctx.log("You now have pickaxe");
      return;
    }
    if (!q.completed) {
      await this.turnIn(ctx, hero);
      return;
    }
    if (!q.reforged) {
      await this.reforgeFlow(ctx, hero);
      return;
    }
    await showDialog({
      title: "Troll blacksmith",
      sprite: this.sprite,
      text: TXT_GET_LOST,
      choices: []
    });
  }
  async turnIn(ctx, hero) {
    const q = blacksmithQuest;
    const pickEquipped = hero.weaponId === "pickaxe" && hero.weapon !== null;
    const pickSlot = hero.inventory.findIndex((s) => s.itemId === "pickaxe");
    if (pickSlot === -1 && !pickEquipped) {
      await this.tell(TXT2);
      return;
    }
    const bloodStained = pickEquipped ? hero.weapon.bloodStained === true : hero.inventory[pickSlot]?.gear?.weapon?.bloodStained === true;
    if (q.alternative) {
      if (!bloodStained) {
        await this.tell(TXT4);
        return;
      }
    } else {
      const goldQty = hero.inventory.filter((s) => s.itemId === "darkgold").reduce((sum, s) => sum + s.qty, 0);
      if (goldQty < 15) {
        await this.tell(TXT3);
        return;
      }
    }
    if (pickEquipped) {
      hero.weapon = null;
      hero.weaponId = null;
    } else {
      removeFromInventory(hero, pickSlot, 1);
    }
    if (!q.alternative) {
      for (let i = hero.inventory.length - 1;i >= 0; i--) {
        if (hero.inventory[i]?.itemId === "darkgold") {
          removeFromInventory(hero, i, hero.inventory[i].qty);
        }
      }
    }
    await this.tell(TXT_COMPLETED);
    q.completed = true;
    q.reforged = false;
  }
  tell(text) {
    return showDialog({
      title: "Troll blacksmith",
      sprite: this.sprite,
      text,
      choices: []
    });
  }
  async reforgeFlow(ctx, hero) {
    const first = await this.pickItem(hero, TXT_REFORGE_PROMPT, null);
    if (!first)
      return;
    const second = await this.pickItem(hero, TXT_REFORGE_SELECT, first);
    if (!second)
      return;
    const err = verifyReforge(hero, first, second);
    if (err) {
      await showDialog({
        title: "Troll blacksmith",
        sprite: this.sprite,
        text: err,
        choices: []
      });
      return;
    }
    const confirm = await showDialog({
      title: "Troll blacksmith",
      sprite: this.sprite,
      text: `Reforge the ${first.label} and the ${second.label} into one?`,
      choices: [
        { label: TXT_REFORGE_BUTTON, value: "yes" },
        { label: "Never mind", value: "no" }
      ]
    });
    if (confirm === "yes") {
      reforgeItems(ctx, hero, first, second);
    }
  }
  async pickItem(hero, prompt, exclude) {
    const candidates = reforgeCandidates(hero).filter((c) => !exclude || c.key !== exclude.key);
    if (candidates.length === 0) {
      await showDialog({
        title: "Troll blacksmith",
        sprite: this.sprite,
        text: "You have nothing I can reforge.",
        choices: []
      });
      return null;
    }
    const value = await showDialog({
      title: "Troll blacksmith",
      sprite: this.sprite,
      text: prompt,
      choices: candidates.map((c) => ({ label: c.label, value: c.key }))
    });
    return candidates.find((c) => c.key === value) ?? null;
  }
  description() {
    return "This troll blacksmith looks like all trolls look: he is tall and lean, and his skin resembles stone " + "in both color and texture. The troll blacksmith is tinkering with unproportionally small tools.";
  }
}
function reforgeCandidates(hero) {
  const out = [];
  const push = (key, itemId, isWeapon, level, upgradable) => {
    if (upgradable === false)
      return;
    const def3 = getItem(itemId);
    out.push({
      key,
      itemId,
      isWeapon,
      label: level > 0 ? `${def3.name} +${level}` : def3.name
    });
  };
  hero.inventory.forEach((s, slot) => {
    const g = s.gear;
    if (g?.weapon) {
      push(`inv:${slot}`, s.itemId, true, g.weapon.level, g.weapon.upgradable);
    } else if (g?.armor) {
      push(`inv:${slot}`, s.itemId, false, g.armor.level, g.armor.upgradable);
    } else {
      const def3 = getItem(s.itemId);
      if (def3.weapon) {
        push(`inv:${slot}`, s.itemId, true, def3.weapon.level, def3.weapon.upgradable);
      } else if (def3.armor) {
        push(`inv:${slot}`, s.itemId, false, def3.armor.level, def3.armor.upgradable);
      }
    }
  });
  if (hero.weaponId && hero.weapon) {
    push("wielded", hero.weaponId, true, hero.weapon.level, hero.weapon.upgradable);
  }
  if (hero.armorId && hero.armor) {
    push("worn", hero.armorId, false, hero.armor.level, hero.armor.upgradable);
  }
  return out;
}
function verifyReforge(hero, c1, c2) {
  if (c1.key === c2.key) {
    return "Select 2 different items, not the same item twice!";
  }
  if (c1.itemId !== c2.itemId) {
    return "Select 2 items of the same type!";
  }
  const g1 = reforgeGear(hero, c1);
  const g2 = reforgeGear(hero, c2);
  if ((g1?.cursed || g2?.cursed) === true) {
    return "I don't work with cursed items!";
  }
  if ((g1?.level ?? 0) < 0 || (g2?.level ?? 0) < 0) {
    return "It's a junk, the quality is too poor!";
  }
  if (g1?.upgradable === false || g2?.upgradable === false) {
    return "I can't reforge these items!";
  }
  return null;
}
function reforgeGear(hero, c) {
  if (c.key === "wielded")
    return hero.weapon;
  if (c.key === "worn")
    return hero.armor;
  const slot = Number(c.key.slice(4));
  const g = hero.inventory[slot]?.gear;
  return (c.isWeapon ? g?.weapon : g?.armor) ?? null;
}
function reforgeItems(ctx, hero, c1, c2) {
  const l1 = reforgeGear(hero, c1)?.level ?? 0;
  const l2 = reforgeGear(hero, c2)?.level ?? 0;
  const first = l2 > l1 ? c2 : c1;
  const second = first === c1 ? c2 : c1;
  const survivorGear = reforgeGear(hero, first);
  if (first.key === "wielded" && hero.weapon) {
    const inst = hero.weapon;
    hero.weapon = null;
    hero.weaponId = null;
    addToInventory(hero, first.itemId, 1, { weapon: inst });
  } else if (first.key === "worn" && hero.armor) {
    const inst = hero.armor;
    hero.armor = null;
    hero.armorId = null;
    addToInventory(hero, first.itemId, 1, { armor: inst });
  }
  if (survivorGear && "enchantment" in survivorGear) {
    upgradeItem(survivorGear, "weapon");
  } else if (survivorGear) {
    upgradeItem(survivorGear, "armor");
  }
  if (second.key === "wielded") {
    hero.weapon = null;
    hero.weaponId = null;
  } else if (second.key === "worn") {
    hero.armor = null;
    hero.armorId = null;
  } else {
    removeFromInventory(hero, Number(second.key.slice(4)), 1);
  }
  ctx.log(TXT_LOOKS_BETTER.replace("%s", first.label));
  tickHeroClock(ctx.rng, ctx, hero, 2);
  blacksmithQuest.reforged = true;
}
var npcIdCounter = -1;
function nextNpcId() {
  return npcIdCounter--;
}
function buildNpc(mobId, id, pos, w, depth) {
  switch (mobId) {
    case "ghost":
      return new GhostMob(id, pos, w);
    case "wandmaker":
      return new WandmakerMob(id, pos, w);
    case "fetidrat":
      return new FetidRatMob(id, pos, w);
    case "curse":
      return new CurseMob(id, pos, w, depth);
    case "shopkeeper":
      return new ShopkeeperMob(id, pos, w);
    case "blacksmith":
      return new BlacksmithMob(id, pos, w);
    default:
      return null;
  }
}
registerNpcBuilder(buildNpc);
registerSewersKillHook(onSewersKill);

// src/content/spawns.ts
var SEWER_MOB_TABLE = {
  1: [{ id: "rat", weight: 1 }],
  2: [
    { id: "rat", weight: 1 },
    { id: "gnoll", weight: 1 }
  ],
  3: [
    { id: "rat", weight: 1 },
    { id: "gnoll", weight: 2 },
    { id: "crab", weight: 1 },
    { id: "swarm", weight: 0.02 }
  ],
  4: [
    { id: "rat", weight: 1 },
    { id: "gnoll", weight: 2 },
    { id: "crab", weight: 3 },
    { id: "swarm", weight: 0.02 },
    { id: "skeleton", weight: 0.01 },
    { id: "thief", weight: 0.01 }
  ],
  6: [
    { id: "skeleton", weight: 4 },
    { id: "thief", weight: 2 },
    { id: "swarm", weight: 1 },
    { id: "shaman", weight: 0.2 }
  ],
  7: [
    { id: "skeleton", weight: 3 },
    { id: "shaman", weight: 1 },
    { id: "thief", weight: 1 },
    { id: "swarm", weight: 1 }
  ],
  8: [
    { id: "skeleton", weight: 3 },
    { id: "shaman", weight: 2 },
    { id: "gnoll", weight: 1 },
    { id: "thief", weight: 1 },
    { id: "swarm", weight: 1 },
    { id: "bat", weight: 0.02 }
  ],
  9: [
    { id: "skeleton", weight: 3 },
    { id: "shaman", weight: 3 },
    { id: "thief", weight: 1 },
    { id: "swarm", weight: 1 },
    { id: "bat", weight: 0.02 },
    { id: "brute", weight: 0.01 }
  ],
  11: [
    { id: "bat", weight: 1 },
    { id: "brute", weight: 0.2 }
  ],
  12: [
    { id: "bat", weight: 1 },
    { id: "brute", weight: 1 },
    { id: "spinner", weight: 0.2 }
  ],
  13: [
    { id: "bat", weight: 1 },
    { id: "brute", weight: 3 },
    { id: "shaman", weight: 1 },
    { id: "spinner", weight: 1 },
    { id: "elemental", weight: 0.02 }
  ],
  14: [
    { id: "bat", weight: 1 },
    { id: "brute", weight: 3 },
    { id: "shaman", weight: 1 },
    { id: "spinner", weight: 4 },
    { id: "elemental", weight: 0.02 },
    { id: "monk", weight: 0.01 }
  ]
};
function pickMobId(rng, depth) {
  const table = SEWER_MOB_TABLE[depth] ?? SEWER_MOB_TABLE[4];
  let total = 0;
  for (const e of table)
    total += e.weight;
  const roll = rng.float(0, total);
  let acc = 0;
  for (const e of table) {
    acc += e.weight;
    if (roll < acc)
      return e.id;
  }
  return table[table.length - 1].id;
}
function resolveMobSpawns(rng, depth, spawns, level) {
  const out = [];
  for (const s of spawns) {
    if (s.kind === "mob") {
      out.push({ pos: s.pos, mobId: pickMobId(rng, depth) });
    } else if (s.kind === "boss") {
      out.push({ pos: s.pos, mobId: depth === 15 ? "dm300" : depth === 10 ? "tengu" : "goo" });
    } else if (s.kind === "ghost") {
      if (!ghostQuest.spawned) {
        initGhostQuest(rng, depth);
        out.push({ pos: s.pos, mobId: "ghost" });
      }
    } else if (s.kind === "wandmaker") {
      if (!wandmakerQuest.spawned) {
        let water = 0;
        let length = 0;
        if (level) {
          length = level.w * level.h;
          for (let i = 0;i < length; i++) {
            if (level.getAt(i) === 9 /* WATER */)
              water++;
          }
        }
        initWandmakerQuest(rng, water, length);
        out.push({ pos: s.pos, mobId: "wandmaker" });
      }
    } else if (s.kind === "shopkeeper") {
      out.push({ pos: s.pos, mobId: "shopkeeper" });
    } else if (s.kind === "blacksmith") {
      if (!blacksmithQuest.spawned) {
        blacksmithQuest.spawned = true;
        blacksmithQuest.alternative = rng.int(0, 2) === 0;
        blacksmithQuest.given = false;
        out.push({ pos: s.pos, mobId: "blacksmith" });
      }
    }
  }
  return out;
}
function buildMobs(resolved, w, depth = 0) {
  return resolved.map((r) => buildMob(r.mobId, nextMobId(), r.pos, w, depth));
}
function pickRandomItemId(rng, depth) {
  return itemGenerator.random(rng, depth);
}
function resolveItemTag(rng, depth, tag) {
  switch (tag) {
    case "food":
      return "ration";
    case "potion-of-strength":
      return "potion_strength";
    case "scroll-of-upgrade":
      return "scroll_upgrade";
    case "scroll-of-enchantment":
      return "scroll";
    case "dew-vial":
      return "potion_healing";
    case "iron-key":
      return "iron_key";
    case "golden-key":
      return "golden_key";
    case "prize-armor":
      return "cloth_armor";
    case "prize-weapon":
      return "shortsword";
    case "prize-potion":
      return "potion_healing";
    case "prize-scroll":
      return "scroll";
    case "prize-food":
      return "ration";
    case "prize-bomb":
      return `dart:${rng.int(5, 15)}`;
    case "prize-wand":
    case "prize-ring":
      return "scroll";
    case "invisibility":
    case "levitation":
    case "liquid-flame":
    case "honeypot":
      return "potion_healing";
    case "sungrass-seed":
      return "ration";
    case "random":
      return pickRandomItemId(rng, depth);
    case "quarterstaff":
      return "quarterstaff";
    case "spear":
      return "spear";
    case "leather-armor":
      return "leather_armor";
    case "seed-pouch":
      return "seed_pouch";
    case "weightstone":
      return "weightstone";
    case "sword":
      return "sword";
    case "mace":
      return "mace";
    case "mail-armor":
      return "mail_armor";
    case "scroll-holder":
      return "scroll_holder";
    case "longsword":
      return "longsword";
    case "battle-axe":
      return "battle_axe";
    case "scale-armor":
      return "scale_armor";
    case "wand-holster":
      return "wand_holster";
    case "glaive":
      return "glaive";
    case "war-hammer":
      return "war_hammer";
    case "plate-armor":
      return "plate_armor";
    case "torch":
      return "torch";
    case "potion-of-healing":
      return "potion_healing";
    case "random-potion":
      return itemGenerator.randomFrom(rng, "potion", depth);
    case "scroll-of-identify":
      return "scroll_identify";
    case "scroll-of-remove-curse":
      return "scroll_removecurse";
    case "scroll-of-magic-mapping":
      return "scroll_magicmapping";
    case "random-scroll":
      return itemGenerator.randomFrom(rng, "scroll", depth);
    case "overpriced-ration":
      return "overpriced_ration";
    case "ankh":
      return "ankh";
    default:
      throw new Error(`spawns: unknown item tag "${tag}" (M1 has no mapping)`);
  }
}
function resolveItemSpawns(rng, depth, spawns) {
  return spawns.map((s) => {
    const tag = s.tag ?? "random";
    const itemId = tag === "gold" ? itemGenerator.randomFrom(rng, "gold", depth) : tag.startsWith("gold:") ? tag : resolveItemTag(rng, depth, tag);
    const { defId } = parseItemId(itemId);
    const lockedChest = s.heap === "LOCKED_CHEST" || s.heap === "CRYSTAL_CHEST";
    const forSale = s.heap === "FOR_SALE";
    return {
      pos: s.pos,
      itemId,
      sprite: getItem(defId).sprite,
      ...lockedChest ? { lockedChest: true } : {},
      ...forSale ? { forSale: true } : {}
    };
  });
}
var pendingResults = new WeakMap;
function stashGenResult(level, result) {
  pendingResults.set(level, result);
}
function takeGenResult(level) {
  const r = pendingResults.get(level) ?? null;
  if (r)
    pendingResults.delete(level);
  return r;
}
var contentLevelGen = {
  generate(rng, depth, run) {
    resetItemGenerator();
    const result = generateLevel(rng, depth, run ?? newRunState());
    const items = resolveItemSpawns(rng, depth, result.items);
    for (const it of items)
      result.level.items.push(it);
    stashGenResult(result.level, result);
    return result.level;
  }
};

// src/ui/inventory.ts
function asHero(game) {
  return game.hero;
}
function toUiItem(c, slot) {
  return {
    slot,
    id: c.id,
    name: c.name,
    sprite: c.sprite,
    qty: c.qty ?? 1,
    kind: c.kind ?? "misc",
    equipped: c.equipped ?? false,
    identified: c.identified ?? true
  };
}
function defaultInventoryAdapter(game) {
  const h = asHero(game);
  const items = [];
  let slot = 0;
  if (h.weapon) {
    items.push({
      slot: slot++,
      id: "shortsword",
      name: h.weapon.name,
      sprite: "shortsword",
      qty: 1,
      kind: "weapon",
      equipped: true,
      identified: true
    });
  }
  if (h.armor) {
    items.push({
      slot: slot++,
      id: "clotharmor",
      name: h.armor.name,
      sprite: "scroll",
      qty: 1,
      kind: "armor",
      equipped: true,
      identified: true
    });
  }
  const darts = h.darts ?? 0;
  if (darts > 0) {
    items.push({
      slot: slot++,
      id: "dart",
      name: "dart",
      sprite: "dart",
      qty: darts,
      kind: "missile",
      equipped: false,
      identified: true
    });
  }
  const extra = h.inventory;
  if (Array.isArray(extra)) {
    for (const c of extra)
      items.push(toUiItem(c, slot++));
  }
  if (!items.some((i) => i.kind === "food")) {
    items.push({
      slot: slot++,
      id: "ration",
      name: "ration of food",
      sprite: "ration",
      qty: 1,
      kind: "food",
      equipped: false,
      identified: true
    });
  }
  return items;
}
var adapter = defaultInventoryAdapter;
function setInventoryAdapter(fn) {
  adapter = fn;
}
function readInventory(game) {
  return adapter(game);
}
function actionsFor(item) {
  if (item.id === "pickaxe")
    return ["mine", "equip", "drop"];
  switch (item.kind) {
    case "weapon":
    case "armor":
      return item.equipped ? ["equip", "drop"] : ["equip", "drop"];
    case "missile":
      return ["throw", "drop"];
    case "potion":
      return ["use", "throw", "drop"];
    case "food":
    case "scroll":
      return ["use", "drop"];
    default:
      return ["drop"];
  }
}
function actionLabel(action, item) {
  switch (action) {
    case "use":
      return item.kind === "potion" ? "Drink" : item.kind === "food" ? "Eat" : item.kind === "scroll" ? "Read" : "Use";
    case "equip":
      return item.equipped ? item.kind === "armor" ? "Take off" : "Unwield" : item.kind === "armor" ? "Wear" : "Wield";
    case "drop":
      return "Drop";
    case "throw":
      return "Throw";
    case "shatter":
      return "Shatter";
    case "mine":
      return "Mine";
  }
}
function doItemAction(game, item, action) {
  switch (action) {
    case "use":
      game.queueIntent({ kind: "useItem", slot: item.slot });
      return "done";
    case "equip":
      game.queueIntent({ kind: "equip", slot: item.slot });
      return "done";
    case "drop":
      game.queueIntent({ kind: "drop", slot: item.slot });
      return "done";
    case "throw":
      return "throw-targeting";
    case "shatter":
      game.queueIntent({ kind: "shatterItem", slot: item.slot });
      return "done";
    case "mine":
      game.queueIntent({ kind: "mineItem", slot: item.slot });
      return "done";
  }
}
var ROW_H = 56;

class InventoryPanel {
  open = false;
  selected = 0;
  onThrowRequest = () => {};
  toggle() {
    this.open = !this.open;
    this.selected = 0;
  }
  close() {
    this.open = false;
  }
  layout(view, itemCount, selected) {
    const wide = view.w >= 560;
    const pw = wide ? Math.min(480, view.w - 48) : view.w - 16;
    const maxRows = Math.max(1, Math.min(itemCount, Math.floor(view.h * 0.62 / ROW_H)));
    const headerH = 52;
    const actionH = selected ? 64 : 0;
    const ph = headerH + maxRows * ROW_H + actionH + 12;
    const px = (view.w - pw) / 2;
    const py = wide ? (view.h - ph) / 2 : view.h - ph - 8;
    const panel = { x: px, y: py, w: pw, h: ph };
    const rows = [];
    for (let i = 0;i < maxRows; i++) {
      rows.push({ x: px + 10, y: py + headerH + i * ROW_H, w: pw - 20, h: ROW_H - 6 });
    }
    const actions = [];
    if (selected) {
      const acts = actionsFor(selected);
      const bw = (pw - 20 - (acts.length - 1) * 8) / acts.length;
      acts.forEach((a, i) => {
        actions.push({
          action: a,
          label: actionLabel(a, selected),
          rect: { x: px + 10 + i * (bw + 8), y: py + headerH + maxRows * ROW_H + 6, w: bw, h: 52 }
        });
      });
    }
    return {
      panel,
      rows,
      actions,
      closeBtn: { x: px + pw - 52, y: py + 6, w: TAP, h: TAP },
      title: "Inventory"
    };
  }
  handleTap(x, y, game) {
    if (!this.open)
      return false;
    const items = readInventory(game);
    const sel = items[this.selected] ?? null;
    const view = InventoryPanel.lastView;
    if (!view)
      return true;
    const L = this.layout(view, items.length, sel);
    if (inRect(L.closeBtn, x, y)) {
      this.close();
      return true;
    }
    for (const a of L.actions) {
      if (inRect(a.rect, x, y) && sel) {
        const r = doItemAction(game, sel, a.action);
        if (r === "throw-targeting")
          this.onThrowRequest(sel);
        else
          this.close();
        return true;
      }
    }
    for (let i = 0;i < L.rows.length; i++) {
      if (inRect(L.rows[i], x, y)) {
        this.selected = Math.min(i, items.length - 1);
        return true;
      }
    }
    if (!inRect(L.panel, x, y))
      this.close();
    return true;
  }
  static lastView = null;
  draw(ctx, game, sprites, view) {
    if (!this.open)
      return;
    InventoryPanel.lastView = view;
    const items = readInventory(game);
    if (this.selected >= items.length)
      this.selected = Math.max(0, items.length - 1);
    const sel = items[this.selected] ?? null;
    const L = this.layout(view, items.length, sel);
    ctx.fillStyle = UI.scrim;
    ctx.fillRect(0, 0, view.w, view.h);
    drawPanel(ctx, L.panel, 12);
    ctx.fillStyle = UI.text;
    ctx.font = "bold 17px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(L.title, L.panel.x + 16, L.panel.y + 26);
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("×", L.closeBtn.x + L.closeBtn.w / 2, L.closeBtn.y + L.closeBtn.h / 2);
    ctx.textAlign = "left";
    const iconSize = 40;
    L.rows.forEach((r, i) => {
      const item = items[i];
      if (!item)
        return;
      const isSel = i === this.selected;
      ctx.fillStyle = isSel ? "rgba(47,111,159,0.22)" : "rgba(0,0,0,0.06)";
      ctx.strokeStyle = isSel ? UI.accent : "rgba(20,22,28,0.25)";
      ctx.lineWidth = isSel ? 3 : 1.5;
      roundRect(ctx, r, 8);
      ctx.fill();
      ctx.stroke();
      try {
        ctx.drawImage(sprites.entitySprite(item.sprite), r.x + 6, r.y + (r.h - iconSize) / 2, iconSize, iconSize);
      } catch {}
      ctx.fillStyle = UI.text;
      ctx.font = "bold 14px system-ui, sans-serif";
      const name = item.identified ? item.name : "unknown " + item.kind;
      ctx.fillText(item.qty > 1 ? `${name} ×${item.qty}` : name, r.x + iconSize + 12, r.y + r.h / 2 - 8);
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = UI.textDim;
      const sub = item.equipped ? "equipped" : item.kind;
      ctx.fillText(sub, r.x + iconSize + 12, r.y + r.h / 2 + 12);
    });
    for (const a of L.actions) {
      drawButton(ctx, a.rect, a.label, { fontSize: 15, primary: a.action === "use" || a.action === "throw" });
    }
  }
}

// src/content/goo-boss.ts
function sealArena(level) {
  if (level.sealed)
    return;
  level.sealed = true;
  const sx = level.stairsUp % level.w;
  const sy = Math.floor(level.stairsUp / level.w);
  if (level.get(sx, sy) === 6 /* ENTRANCE */) {
    level.set(sx, sy, 9 /* WATER */);
  }
}
function unsealArena(level) {
  if (!level.sealed)
    return;
  level.sealed = false;
  const sx = level.stairsUp % level.w;
  const sy = Math.floor(level.stairsUp / level.w);
  if (level.get(sx, sy) === 9 /* WATER */) {
    level.set(sx, sy, 6 /* ENTRANCE */);
  }
}
var GOO_DEF = {
  id: "goo",
  name: "Goo",
  sprite: "mob_goo",
  hp: GOO_HT,
  atk: GOO_ATTACK,
  def: GOO_DEFENSE,
  dmgMin: GOO_DMG_MIN,
  dmgMax: GOO_DMG_MAX,
  triangular: true,
  dr: GOO_DR,
  exp: GOO_EXP,
  maxLvl: GOO_MAX_LVL,
  speed: 1,
  flying: false,
  ability: null,
  attackDelay: 1,
  immunities: [],
  resistances: [...GOO_RESISTANCES]
};

class GooMob extends ContentMob {
  pumpedUp = false;
  jumped = false;
  constructor(id, pos, w) {
    super(id, GOO_DEF, pos, w);
  }
  canAttack(_ctx, targetPos) {
    return gooCanAttack(this.pumpedUp, chebyshevPos(this.pos, targetPos, this.w));
  }
  takeTurn(ctx) {
    this.hp = gooWaterRegen(this.hp, ctx.level.getAt(this.pos) === 9 /* WATER */);
    return super.takeTurn(ctx);
  }
  onNotice(ctx) {
    ctx.log("GLURP-GLURP!");
  }
  afterMove(ctx, _oldPos) {
    if (!ctx.level.sealed) {
      sealArena(ctx.level);
      ctx.log("The dungeon seals shut behind you!");
    }
    const s = gooAfterMove({
      hp: this.hp,
      pumpedUp: this.pumpedUp,
      jumped: this.jumped
    });
    this.pumpedUp = s.pumpedUp;
  }
  onDeath(ctx) {
    unsealArena(ctx.level);
    dropItemAt(ctx, this.pos, "skeleton_key");
    ctx.log("glurp... glurp...");
  }
  applyGooAfter(action) {
    const s = gooAfterAttack({ hp: this.hp, pumpedUp: this.pumpedUp, jumped: this.jumped }, action);
    this.pumpedUp = s.pumpedUp;
    this.jumped = s.jumped;
  }
  doAttack(ctx, hero) {
    const rng = ctx.rng;
    const dist = chebyshevPos(this.pos, hero.pos, this.w);
    const action = gooDecide(rng, { hp: this.hp, pumpedUp: this.pumpedUp, jumped: this.jumped }, { dist, jumpPathClear: this.jumpPathClear(ctx, hero) });
    switch (action.kind) {
      case "pump": {
        ctx.log("Goo is pumping itself up!");
        this.applyGooAfter(action);
        return PUMP_UP_DELAY * this.getSpeed();
      }
      case "pumpFizzle":
        this.applyGooAfter(action);
        return this.waitCost();
      case "pumpedAttack": {
        this.jumped = false;
        this.gooStrike(ctx, hero, gooAttackSkill(true, this.jumped), true);
        this.applyGooAfter(action);
        return 1 * this.getSpeed();
      }
      case "attack": {
        this.gooStrike(ctx, hero, gooAttackSkill(false, this.jumped), false);
        this.applyGooAfter(action);
        return 1 * this.getSpeed();
      }
      case "jumpAttack": {
        this.jumped = true;
        this.pos = this.jumpDest(ctx, hero);
        ctx.log("Goo jumps!");
        this.gooStrike(ctx, hero, gooAttackSkill(true, this.jumped), true);
        this.applyGooAfter(action);
        return 1 * this.getSpeed();
      }
    }
  }
  gooStrike(ctx, hero, accuracy, pumped) {
    strikeMobVsHero(ctx, this, hero, accuracy, (rng) => gooDamageRoll(rng, pumped), (rng, damage) => {
      if (gooOozeRoll(rng)) {
        hero.buffs.ooze = { kind: "ooze", left: 0 };
        ctx.log("Caustic ooze eats your flesh. Wash away it!");
      }
      return damage;
    });
  }
  jumpDest(ctx, hero) {
    const dx = Math.sign(hero.x - this.x);
    const dy = Math.sign(hero.y - this.y);
    const nx = hero.x - dx;
    const ny = hero.y - dy;
    const level = ctx.level;
    if (level.inBounds(nx, ny) && level.isPassable(nx, ny) && !level.mobAt(nx, ny)) {
      return ny * this.w + nx;
    }
    return this.pos;
  }
  jumpPathClear(ctx, hero) {
    return lineClear(ctx.level, this.x, this.y, hero.x, hero.y);
  }
}
function lineClear(level, x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;; ) {
    if (level.isOpaque(x, y))
      return false;
    if (x === x1 && y === y1)
      return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}
registerGoo(GooMob);

// src/mechanics/tengu.ts
var TENGU_HT = 120;
var TENGU_EXP = 20;
var TENGU_DEFENSE = 20;
var TENGU_DR = 5;
var TENGU_ATTACK = 20;
var TENGU_DMG_MIN = 8;
var TENGU_DMG_MAX = 15;
var TENGU_MAX_LVL = 30;
var TENGU_JUMP_DELAY = 5;
var TENGU_TRAPS_PER_JUMP = 4;
var TENGU_RESISTANCES = [
  "toxic_gas",
  "poison",
  "death",
  "psionic_blast"
];
function tenguShouldJump(timeToJump, adjacent2) {
  const next = timeToJump - 1;
  if (next <= 0 && adjacent2) {
    return { jump: true, nextTimeToJump: TENGU_JUMP_DELAY };
  }
  return { jump: false, nextTimeToJump: next };
}

// src/content/tengu-boss.ts
var TENGU_DEF = {
  id: "tengu",
  name: "Tengu",
  sprite: "mob_tengu",
  hp: TENGU_HT,
  atk: TENGU_ATTACK,
  def: TENGU_DEFENSE,
  dmgMin: TENGU_DMG_MIN,
  dmgMax: TENGU_DMG_MAX,
  triangular: true,
  dr: TENGU_DR,
  exp: TENGU_EXP,
  maxLvl: TENGU_MAX_LVL,
  speed: 1,
  flying: false,
  ability: null,
  attackDelay: 1,
  immunities: [],
  resistances: [...TENGU_RESISTANCES]
};

class TenguMob extends ContentMob {
  timeToJump = TENGU_JUMP_DELAY;
  constructor(id, pos, w) {
    super(id, TENGU_DEF, pos, w);
  }
  canAttack(ctx, targetPos) {
    return rangedCanAttack(ctx, this, targetPos);
  }
  getCloser(ctx, target) {
    const hero = heroOf(ctx);
    if (this.enemySeen && target === hero.pos) {
      this.jump(ctx, hero.pos);
      return true;
    }
    return super.getCloser(ctx, target);
  }
  doAttack(ctx, hero) {
    const adjacent2 = chebyshevPos(this.pos, hero.pos, this.w) <= 1;
    const { jump, nextTimeToJump } = tenguShouldJump(this.timeToJump, adjacent2);
    this.timeToJump = nextTimeToJump;
    if (jump) {
      this.jump(ctx, hero.pos);
      return 1;
    }
    return super.doAttack(ctx, hero);
  }
  jump(ctx, enemyPos) {
    const rng = ctx.rng;
    const level = ctx.level;
    const size = level.w * level.h;
    this.timeToJump = TENGU_JUMP_DELAY;
    for (let i = 0;i < TENGU_TRAPS_PER_JUMP; i++) {
      const trapPos = this.drawVisiblePassable(rng, level, size, 50);
      if (trapPos !== -1 && level.getAt(trapPos) === 36 /* TRAP_INACTIVE */) {
        level.set(trapPos % level.w, Math.floor(trapPos / level.w), 26 /* TRAP_POISON */);
      }
    }
    let newPos = -1;
    for (let tries = 0;tries < 200 && newPos === -1; tries++) {
      const cand = rng.int(0, size);
      if (!level.visible[cand])
        continue;
      const cx = cand % level.w;
      const cy = Math.floor(cand / level.w);
      if (!level.isPassable(cx, cy))
        continue;
      if (chebyshevPos(cand, enemyPos, level.w) <= 1)
        continue;
      if (charAtPos(ctx, cand, this))
        continue;
      newPos = cand;
    }
    if (newPos !== -1) {
      this.pos = newPos;
    }
  }
  drawVisiblePassable(rng, level, size, tries) {
    for (let t = 0;t < tries; t++) {
      const cand = rng.int(0, size);
      if (!level.visible[cand])
        continue;
      if (!level.isPassable(cand % level.w, Math.floor(cand / level.w)))
        continue;
      return cand;
    }
    return -1;
  }
  onNotice(_ctx) {
    _ctx.log("Gotcha, warrior!");
  }
  onDeath(ctx) {
    if (ITEMS["tome_of_mastery"]) {
      dropItemAt(ctx, this.pos, "tome_of_mastery");
    }
    dropItemAt(ctx, this.pos, "skeleton_key");
    ctx.log("Free at last...");
  }
}
registerTengu(TenguMob);

// src/mechanics/dm300.ts
var DM300_HT = 200;
var DM300_EXP = 30;
var DM300_DEFENSE = 18;
var DM300_DR = 10;
var DM300_ATTACK = 28;
var DM300_DMG_MIN = 18;
var DM300_DMG_MAX = 24;
var DM300_MAX_LVL = 30;
var DM300_GAS_SEED = 30;
var DM300_PARALYSIS_TURNS = 2;
var DM300_RESISTANCES = ["death", "psionic_blast"];
var DM300_IMMUNITIES = ["toxic_gas"];
function dm300Repair(rng, hp, ht) {
  return hp + rng.int(1, ht - hp);
}
function dm300MoveCell(rng, step, w, h) {
  const sx = step % w;
  const sy = Math.floor(step / w);
  const dx = [-1, 1, 0, 0, -1, -1, 1, 1];
  const dy = [0, 0, -1, 1, -1, 1, -1, 1];
  const i = rng.int(0, 8);
  const nx = sx + dx[i];
  const ny = sy + dy[i];
  if (nx < 0 || ny < 0 || nx >= w || ny >= h)
    return -1;
  return ny * w + nx;
}

// src/content/dm300-boss.ts
var DM300_DEF = {
  id: "dm300",
  name: "DM-300",
  sprite: "mob_dm300",
  hp: DM300_HT,
  atk: DM300_ATTACK,
  def: DM300_DEFENSE,
  dmgMin: DM300_DMG_MIN,
  dmgMax: DM300_DMG_MAX,
  triangular: true,
  dr: DM300_DR,
  exp: DM300_EXP,
  maxLvl: DM300_MAX_LVL,
  speed: 1,
  flying: false,
  ability: null,
  attackDelay: 1,
  immunities: [...DM300_IMMUNITIES],
  resistances: [...DM300_RESISTANCES]
};

class DM300Mob extends ContentMob {
  constructor(id, pos, w) {
    super(id, DM300_DEF, pos, w);
  }
  takeTurn(ctx) {
    const level = ctx.level;
    seedBlob(level.blobs, "toxic", this.pos, DM300_GAS_SEED, level.w * level.h);
    return super.takeTurn(ctx);
  }
  afterMove(ctx, oldPos) {
    super.afterMove(ctx, oldPos);
    const rng = ctx.rng;
    const level = ctx.level;
    if (level.getAt(this.pos) === 36 /* TRAP_INACTIVE */ && this.hp < this.ht) {
      this.hp = dm300Repair(rng, this.hp, this.ht);
      if (level.visible[this.pos] !== 0 && heroOf(ctx).isAlive()) {
        ctx.log("DM-300 repairs itself!");
      }
    }
    const cell = dm300MoveCell(rng, this.pos, level.w, level.h);
    if (cell === -1)
      return;
    if (level.visible[cell] !== 0) {
      if (level.getAt(cell) === 9 /* WATER */) {} else if (level.getAt(cell) === 1 /* FLOOR */) {}
    }
    const ch = charAtPos(ctx, cell, this);
    if (ch && ch.isAlive()) {
      const cur = ch.buffs.paralysis?.left ?? 0;
      ch.buffs.paralysis = {
        kind: "paralysis",
        left: Math.max(cur, DM300_PARALYSIS_TURNS)
      };
      ch.paralysed = true;
    }
  }
  onNotice(ctx) {
    ctx.log("Unauthorised personnel detected.");
  }
  onDeath(ctx) {
    dropItemAt(ctx, this.pos, "skeleton_key");
    ctx.log("Mission failed. Shutting down.");
  }
}
registerDM300(DM300Mob);

// src/content/hooks.ts
function catalogKind(def3) {
  switch (def3.type) {
    case "weapon":
      return "weapon";
    case "armor":
      return "armor";
    case "missile":
      return "missile";
    case "potion":
      return "potion";
    case "food":
      return "food";
    case "scroll":
      return "scroll";
    case "key":
    case "gold":
    case "dewdrop":
    case "seed":
    case "quest":
    case "bag":
    case "misc":
    case "wand":
    case "ring":
      return "misc";
  }
}
function contentInventoryAdapter(game) {
  const hero = game.hero;
  const items = hero.inventory.map((s, slot) => {
    const def3 = getItem(s.itemId);
    const potionInfo = potionUiInfo(s.itemId, def3.name, def3.sprite);
    const scrollInfo = potionInfo ? null : scrollUiInfo(s.itemId, def3.name, def3.sprite);
    const info = potionInfo ?? scrollInfo;
    return {
      slot,
      id: s.itemId,
      name: info?.name ?? def3.name,
      sprite: info?.sprite ?? def3.sprite,
      qty: s.qty,
      kind: catalogKind(def3),
      equipped: false,
      identified: info?.identified ?? true
    };
  });
  if (hero.weaponId) {
    const def3 = getItem(hero.weaponId);
    items.push({
      slot: -1,
      id: hero.weaponId,
      name: def3.name,
      sprite: def3.sprite,
      qty: 1,
      kind: "weapon",
      equipped: true,
      identified: true
    });
  }
  if (hero.armorId) {
    const def3 = getItem(hero.armorId);
    items.push({
      slot: -2,
      id: hero.armorId,
      name: def3.name,
      sprite: def3.sprite,
      qty: 1,
      kind: "armor",
      equipped: true,
      identified: true
    });
  }
  return items;
}
setInventoryAdapter(contentInventoryAdapter);
function saveHeroEx(hero) {
  return {
    id: hero.id,
    x: hero.x,
    y: hero.y,
    w: hero.w,
    hp: hero.hp,
    ht: hero.ht,
    time: hero.time,
    lvl: hero.lvl,
    exp: hero.exp,
    str: hero.str,
    weaponId: hero.weaponId,
    armorId: hero.armorId,
    weapon: hero.weapon ? { ...hero.weapon } : null,
    armor: hero.armor ? { ...hero.armor } : null,
    inventory: hero.inventory.map((s) => ({
      ...s,
      gear: s.gear ? {
        weapon: s.gear.weapon ? { ...s.gear.weapon } : undefined,
        armor: s.gear.armor ? { ...s.gear.armor } : undefined
      } : undefined
    })),
    gold: hero.gold,
    hungerLevel: hero.hungerLevel,
    hungerClock: hero.hungerClock,
    buffs: { ...hero.buffs },
    paralysed: hero.paralysed
  };
}
function reviveHeroEx(save) {
  const hero = createStarterHero(save.y * save.w + save.x, save.w);
  hero.hp = save.hp;
  hero.ht = save.ht;
  hero.time = save.time;
  hero.lvl = save.lvl;
  hero.exp = save.exp;
  hero.str = save.str;
  hero.inventory = save.inventory.map((s) => ({ ...s }));
  hero.weaponId = save.weaponId;
  hero.armorId = save.armorId;
  if (save.weaponId) {
    hero.weapon = save.weapon ? { ...save.weapon } : (() => {
      const wdef = getItem(save.weaponId).weapon;
      return wdef ? { ...wdef } : null;
    })();
  } else {
    hero.weapon = null;
  }
  if (save.armorId) {
    hero.armor = save.armor ? { ...save.armor } : (() => {
      const adef = getItem(save.armorId).armor;
      return adef ? { ...adef } : null;
    })();
  } else {
    hero.armor = null;
  }
  syncDarts(hero);
  hero.gold = save.gold;
  hero.hungerLevel = save.hungerLevel;
  hero.hungerClock = save.hungerClock;
  hero.buffs = { ...save.buffs };
  hero.paralysed = save.paralysed;
  return hero;
}
function saveMobEx(mob) {
  const goo = mob;
  const tengu = mob;
  const brute = mob;
  return {
    id: mob.id,
    mobId: mob.def.id,
    x: mob.x,
    y: mob.y,
    w: mob.w,
    hp: mob.hp,
    ht: mob.ht,
    time: mob.time,
    hostile: mob.hostile,
    state: mob.state,
    enemySeen: mob.enemySeen,
    target: mob.target,
    generation: mob.generation,
    stolen: mob.stolen ? { ...mob.stolen } : null,
    pumpedUp: goo.pumpedUp ?? false,
    jumped: goo.jumped ?? false,
    timeToJump: tengu.timeToJump ?? 5,
    enraged: brute.enraged ?? false,
    buffs: { ...mob.buffs },
    paralysed: mob.paralysed
  };
}
function reviveMobEx(save) {
  const mob = buildMob(save.mobId, save.id, save.y * save.w + save.x, save.w);
  mob.hp = save.hp;
  mob.ht = save.ht;
  mob.time = save.time;
  mob.hostile = save.hostile;
  mob.state = save.state;
  mob.enemySeen = save.enemySeen;
  mob.target = save.target;
  mob.generation = save.generation;
  mob.stolen = save.stolen ? { ...save.stolen } : null;
  const goo = mob;
  if ("pumpedUp" in mob) {
    goo.pumpedUp = save.pumpedUp;
    goo.jumped = save.jumped;
  }
  const tengu = mob;
  if ("timeToJump" in mob)
    tengu.timeToJump = save.timeToJump ?? 5;
  const brute = mob;
  if ("enraged" in mob)
    brute.enraged = save.enraged ?? false;
  mob.buffs = { ...save.buffs };
  mob.paralysed = save.paralysed;
  return mob;
}
var contentMechanics = {
  spawnHero(_rng, level) {
    resetQuestState();
    return createStarterHero(level.stairsUp, level.w);
  },
  spawnMobs(rng, level) {
    const result = takeGenResult(level);
    if (!result)
      return [];
    noteSignCells(level, result.markers.signs);
    noteWallDecoCells(level, result.markers.wallDeco);
    const resolved = resolveMobSpawns(rng, result.level.depth, result.mobs, result.level);
    return buildMobs(resolved, result.level.w, result.level.depth);
  },
  handleHeroIntent(intent, ctx) {
    const hero = heroOf(ctx);
    if (!hero.isAlive())
      return 1;
    if (hero.paralysed) {
      ctx.log("You are paralysed!");
      return 1;
    }
    let cost = 1;
    switch (intent.kind) {
      case "move":
        cost = moveHero(ctx, hero, intent.dx, intent.dy);
        break;
      case "search":
        cost = searchIntentional(ctx, hero);
        break;
      case "wait":
        cost = waitTurn(ctx, hero);
        break;
      case "pickup":
        cost = pickupAt(ctx, hero);
        break;
      case "attack": {
        const target = ctx.mobs.find((m) => m.id === intent.targetId && m.isAlive());
        if (!target || chebyshevPos(hero.pos, target.pos, ctx.level.w) > 1) {
          ctx.log("No target in range.");
          cost = 1;
          break;
        }
        strikeHeroVsMob(ctx, hero, target, heroAttackSkill(hero, { ranged: false, adjacent: false }), (r) => heroDamageRoll(r, hero, { ranged: false }));
        cost = 1;
        break;
      }
      case "useItem":
        cost = useInventorySlot(ctx, hero, intent.slot);
        break;
      case "equip":
        cost = equipSlot(ctx, hero, intent.slot);
        break;
      case "drop":
        cost = dropSlot(ctx, hero, intent.slot);
        break;
      case "throwItem": {
        const target = ctx.mobs.find((m) => m.id === intent.targetId && m.isAlive());
        if (!target) {
          ctx.log("Your target is gone.");
          cost = 1;
          break;
        }
        const targetCell = target.y * ctx.level.w + target.x;
        const thrownId = hero.inventory[intent.slot]?.itemId;
        if (thrownId === HONEYPOT_ID) {
          cost = throwHoneypot(ctx, hero, intent.slot, targetCell);
          break;
        }
        if (thrownId !== undefined && isPotionId(thrownId)) {
          cost = throwPotion(ctx, hero, intent.slot, targetCell);
          break;
        }
        cost = throwDart(ctx, hero, intent.slot, targetCell);
        break;
      }
      case "shatterItem": {
        cost = shatterHoneypotInHands(ctx, hero, intent.slot);
        break;
      }
      case "mineItem": {
        cost = mineDarkGold(ctx, hero, intent.slot);
        break;
      }
      case "talk": {
        const npc = ctx.mobs.find((m) => m.id === intent.targetId && m.isAlive());
        if (!npc || typeof npc.onTalk !== "function") {
          ctx.log("Nobody there.");
          cost = 0;
          break;
        }
        if (chebyshevPos(hero.pos, npc.pos, ctx.level.w) > 1) {
          ctx.log("You are too far away to talk.");
          cost = 0;
          break;
        }
        npc.onTalk(ctx);
        cost = 0;
        break;
      }
      case "descend":
      case "ascend":
        cost = 1;
        break;
    }
    return cost;
  },
  actMob(mob, ctx) {
    return mob.takeTurn(ctx);
  },
  tickActorBuffs(actor, ctx) {
    tickBuffs(ctx.rng, ctx.level, actor, ctx.log);
  },
  evolveBlobs(ctx) {
    const hero = heroOf(ctx);
    const mobs = ctx.mobs;
    tickBlobs(ctx.rng, makeBlobWorld(ctx, hero, mobs), ctx.level.blobs);
  },
  tickHeroClock(actor, ctx, cost) {
    tickHeroClock(ctx.rng, ctx, actor, cost);
  },
  applyTransitionHunger(actor) {
    const hero = actor;
    if (!isStarving(hero.hungerLevel)) {
      hero.hungerLevel = satisfy(hero.hungerLevel, -STARVING / 10);
    }
  },
  saveHero(hero) {
    return saveHeroEx(hero);
  },
  reviveHero(_rng, data) {
    return reviveHeroEx(data);
  },
  saveMob(mob) {
    return saveMobEx(mob);
  },
  reviveMob(_rng, data) {
    return reviveMobEx(data);
  }
};

// src/engine/seams.ts
function mobsToPlaced(mobs) {
  return mobs.map((m) => ({
    id: m.id,
    x: m.x,
    y: m.y,
    hp: m.hp,
    ht: m.ht,
    name: m.name,
    sprite: m.sprite,
    hostile: m.hostile,
    talkable: typeof m.onTalk === "function"
  }));
}

// src/engine/loop.ts
class Game {
  rng;
  seed;
  level;
  hero;
  mobs = [];
  scheduler = new Scheduler;
  log = [];
  turnCount = 0;
  gameOver = false;
  run;
  path = [];
  pendingIntent = null;
  deps;
  logCap;
  constructor(seed, deps) {
    this.seed = seed >>> 0;
    this.rng = new RNG(this.seed);
    this.deps = deps;
    this.logCap = deps.logCap ?? 200;
    resetSpecials(this.rng);
    this.run = newRunState();
    this.level = deps.gen.generate(this.rng, 1, this.run);
    this.hero = deps.mechanics.spawnHero(this.rng, this.level);
    this.mobs = deps.mechanics.spawnMobs(this.rng, this.level);
    this.placeHeroAtEntrance();
    this.scheduler.add(this.hero);
    for (const m of this.mobs)
      this.scheduler.add(m);
    this.afterAction();
    this.logMsg(`Depth 1 — the Sewers. Find the stairs down. (seed ${this.seed})`);
  }
  queueIntent(intent) {
    if (this.gameOver)
      return;
    this.path = [];
    this.pendingIntent = intent;
  }
  setPath(path) {
    if (this.gameOver)
      return;
    this.pendingIntent = null;
    this.path = path;
  }
  cancelPath() {
    this.path = [];
  }
  get pathLength() {
    return this.path.length;
  }
  get currentPath() {
    return this.path;
  }
  pump() {
    if (this.gameOver)
      return "over";
    const next = this.scheduler.peek();
    if (!next)
      return "over";
    if (next === this.hero) {
      const intent = this.nextHeroIntent();
      if (!intent)
        return "waiting";
      this.scheduler.next();
      this.deps.mechanics.tickActorBuffs(this.hero, this.ctx());
      this.deps.mechanics.evolveBlobs(this.ctx());
      let cost2;
      let transitioned = false;
      if (intent.kind === "descend") {
        transitioned = this.tryDescend();
        cost2 = 1;
      } else if (intent.kind === "ascend") {
        transitioned = this.tryAscend();
        cost2 = 1;
      } else {
        cost2 = this.deps.mechanics.handleHeroIntent(intent, this.ctx());
      }
      if (this.hero.isAlive()) {
        this.deps.mechanics.tickHeroClock(this.hero, this.ctx(), cost2);
      }
      if (!transitioned) {
        this.scheduler.spend(this.hero, cost2);
      }
      this.turnCount++;
      this.afterAction();
      this.checkHeroDeath();
      return "acted";
    }
    const mob = next;
    this.scheduler.next();
    this.deps.mechanics.tickActorBuffs(mob, this.ctx());
    const cost = this.deps.mechanics.actMob(mob, this.ctx());
    if (mob.isAlive()) {
      this.scheduler.spend(mob, cost);
    } else {
      this.removeMob(mob);
    }
    this.afterAction();
    this.checkHeroDeath();
    return this.gameOver ? "over" : "acted";
  }
  drain(maxSteps = 1000) {
    let r = "acted";
    for (let i = 0;i < maxSteps; i++) {
      r = this.pump();
      if (r !== "acted")
        break;
    }
    return r;
  }
  descend() {
    const depth = this.level.depth + 1;
    this.changeDepth(depth);
    this.deps.mechanics.applyTransitionHunger(this.hero);
    this.logMsg(`You descend to depth ${depth}.`);
  }
  ascend() {
    if (this.level.depth <= 1) {
      this.logMsg("You cannot go back up from here.");
      return;
    }
    const depth = this.level.depth - 1;
    this.changeDepth(depth);
    this.deps.mechanics.applyTransitionHunger(this.hero);
    this.logMsg(`You ascend to depth ${depth}.`);
  }
  tryDescend() {
    const i = this.level.idx(this.hero.x, this.hero.y);
    if (i === this.level.stairsDown) {
      this.descend();
      return true;
    }
    this.logMsg("There are no stairs down here.");
    return false;
  }
  tryAscend() {
    const i = this.level.idx(this.hero.x, this.hero.y);
    if (i === this.level.stairsUp) {
      if (this.level.sealed) {
        this.logMsg("The dungeon is sealed shut!");
        return false;
      }
      this.ascend();
      return true;
    }
    this.logMsg("There are no stairs up here.");
    return false;
  }
  nextHeroIntent() {
    if (this.pendingIntent) {
      const i = this.pendingIntent;
      this.pendingIntent = null;
      return i;
    }
    if (this.path.length > 0) {
      const step = this.path.shift();
      const dx = step.x - this.hero.x;
      const dy = step.y - this.hero.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 1) {
        this.path = [];
        return null;
      }
      const mob = this.level.mobAt(step.x, step.y);
      if (mob) {
        this.path = [];
        const live = this.mobs.find((m) => m.id === mob.id);
        if (!live)
          return null;
        if (typeof live.onTalk === "function")
          return { kind: "talk", targetId: live.id };
        return { kind: "attack", targetId: live.id };
      }
      return { kind: "move", dx, dy };
    }
    return null;
  }
  afterAction() {
    this.updateHeroFov();
    this.syncMobs();
    if (this.path.length > 0 && this.mobs.some((m) => m.hostile && this.level.visible[this.level.idx(m.x, m.y)])) {
      this.path = [];
      this.logMsg("You stop: danger ahead.");
    }
  }
  updateHeroFov() {
    const buffs = this.hero.buffs;
    if (buffs?.blindness) {
      this.level.visible.fill(0);
    } else {
      this.level.updateFov(this.hero.x, this.hero.y, this.hero.sight);
    }
  }
  checkHeroDeath() {
    if (!this.hero.isAlive() && !this.gameOver) {
      this.gameOver = true;
      const last = this.log[this.log.length - 1] ?? "";
      if (!DEATH_MESSAGE_RE.test(last) && last !== "You died...") {
        this.logMsg("You died...");
      }
    }
  }
  ctx() {
    return {
      rng: this.rng,
      level: this.level,
      hero: this.hero,
      mobs: this.mobs,
      log: (msg) => this.logMsg(msg),
      killMob: (mob) => this.removeMob(mob),
      removeMob: (mob) => this.removeMob(mob),
      addMob: (mob, delay) => {
        this.mobs.push(mob);
        mob.time = this.scheduler.now + (delay ?? 0);
        this.scheduler.add(mob);
        this.syncMobs();
      },
      syncMobs: () => this.syncMobs()
    };
  }
  logMsg(msg) {
    this.log.push(msg);
    if (this.log.length > this.logCap) {
      this.log.splice(0, this.log.length - this.logCap);
    }
  }
  removeMob(mob) {
    this.mobs = this.mobs.filter((m) => m !== mob);
    this.scheduler.remove(mob);
    this.syncMobs();
  }
  syncMobs() {
    this.level.mobs = mobsToPlaced(this.mobs);
  }
  placeHeroAtEntrance() {
    const i = this.level.stairsUp;
    if (i >= 0) {
      this.hero.x = i % this.level.w;
      this.hero.y = Math.floor(i / this.level.w);
    } else {
      this.hero.x = 1;
      this.hero.y = 1;
    }
  }
  changeDepth(depth) {
    this.level = this.deps.gen.generate(this.rng, depth, this.run);
    for (const m of this.mobs)
      this.scheduler.remove(m);
    this.mobs = this.deps.mechanics.spawnMobs(this.rng, this.level);
    this.placeHeroAtEntrance();
    this.path = [];
    this.pendingIntent = null;
    this.scheduler.now = 0;
    this.hero.time = 0;
    this.scheduler.add(this.hero);
    for (const m of this.mobs) {
      m.time = 0;
      this.scheduler.add(m);
    }
    this.afterAction();
  }
}

// src/engine/render.ts
var TILE_PX = 48;
var TINTABLE = new Set(["F", "f", "W", "w"]);
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function missingSpriteRows() {
  const rows = [];
  for (let y = 0;y < ART_PX; y++) {
    let row = "";
    for (let x = 0;x < ART_PX; x++)
      row += (x + y) % 2 === 0 ? "M" : "k";
    rows.push(row);
  }
  return rows;
}
function cameraTileRect(heroX, heroY, vw, vh, levelW, levelH, tilePx = TILE_PX) {
  const viewTilesW = vw / tilePx;
  const viewTilesH = vh / tilePx;
  const camX = heroX + 0.5 - viewTilesW / 2;
  const camY = heroY + 0.5 - viewTilesH / 2;
  return {
    camX,
    camY,
    x0: Math.max(0, Math.floor(camX)),
    y0: Math.max(0, Math.floor(camY)),
    x1: Math.min(levelW - 1, Math.ceil(camX + viewTilesW)),
    y1: Math.min(levelH - 1, Math.ceil(camY + viewTilesH))
  };
}

class Renderer {
  canvas;
  ctx;
  cache = new Map;
  camX = 0;
  camY = 0;
  dpr = 1;
  constructor(canvas) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx)
      throw new Error("Renderer: 2d context unavailable");
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.resize();
  }
  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }
  syncSize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round((this.canvas.clientWidth || window.innerWidth) * dpr);
    const h = Math.round((this.canvas.clientHeight || window.innerHeight) * dpr);
    if (w !== this.canvas.width || h !== this.canvas.height || dpr !== this.dpr) {
      this.dpr = dpr;
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }
  viewSize() {
    return { w: this.canvas.width / this.dpr, h: this.canvas.height / this.dpr };
  }
  pixelRatio() {
    return this.dpr;
  }
  screenToTile(sx, sy) {
    const rect = this.canvas.getBoundingClientRect();
    const px = sx - rect.left;
    const py = sy - rect.top;
    return {
      x: Math.floor(this.camX + px / TILE_PX),
      y: Math.floor(this.camY + py / TILE_PX)
    };
  }
  tileToScreen(tx, ty) {
    return {
      x: (tx + 0.5 - this.camX) * TILE_PX,
      y: (ty + 0.5 - this.camY) * TILE_PX
    };
  }
  render(game) {
    const { ctx } = this;
    this.syncSize();
    const { w: vw, h: vh } = this.viewSize();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const level = game.level;
    const cam = cameraTileRect(game.hero.x, game.hero.y, vw, vh, level.w, level.h);
    this.camX = cam.camX;
    this.camY = cam.camY;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, vw, vh);
    const { x0, y0, x1, y1 } = cam;
    for (let y = y0;y <= y1; y++) {
      for (let x = x0;x <= x1; x++) {
        const i = level.idx(x, y);
        const dx = (x - this.camX) * TILE_PX;
        const dy = (y - this.camY) * TILE_PX;
        if (!level.explored[i]) {
          ctx.fillStyle = "#000";
          ctx.fillRect(dx, dy, TILE_PX, TILE_PX);
          continue;
        }
        const seen = level.visible[i] === 1;
        ctx.globalAlpha = seen ? 1 : 0.45;
        const sprite = this.tileSprite(level, x, y);
        ctx.drawImage(sprite, dx, dy, TILE_PX, TILE_PX);
        ctx.globalAlpha = 1;
      }
    }
    for (const item of level.items) {
      const i = item.pos;
      if (!level.explored[i])
        continue;
      const x = i % level.w;
      const y = Math.floor(i / level.w);
      if (x < x0 || x > x1 || y < y0 || y > y1)
        continue;
      ctx.globalAlpha = level.visible[i] ? 1 : 0.45;
      ctx.drawImage(this.entitySprite(item.sprite), (x - this.camX) * TILE_PX, (y - this.camY) * TILE_PX, TILE_PX, TILE_PX);
      ctx.globalAlpha = 1;
    }
    for (const m of game.mobs) {
      const i = level.idx(m.x, m.y);
      if (!level.visible[i])
        continue;
      ctx.drawImage(this.entitySprite(m.sprite), (m.x - this.camX) * TILE_PX, (m.y - this.camY) * TILE_PX, TILE_PX, TILE_PX);
    }
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (const p of game.currentPath) {
      const i = level.idx(p.x, p.y);
      if (!level.visible[i])
        continue;
      const cx = (p.x - this.camX) * TILE_PX + TILE_PX / 2;
      const cy = (p.y - this.camY) * TILE_PX + TILE_PX / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    const hx = (game.hero.x - this.camX) * TILE_PX;
    const hy = (game.hero.y - this.camY) * TILE_PX;
    ctx.drawImage(this.entitySprite(game.hero.sprite), hx, hy, TILE_PX, TILE_PX);
  }
  tileSprite(level, x, y) {
    const t = level.get(x, y);
    const region = regionForDepth(level.depth);
    let name;
    switch (t) {
      case 0 /* WALL */:
      case 37 /* BARRICADE */:
        name = "wall";
        break;
      case 4 /* DOOR_SECRET */:
        name = "door_secret";
        break;
      case 1 /* FLOOR */:
      case 11 /* WALKWAY */:
        name = (x * 7 + y * 13) % 3 === 0 ? "floor1" : "floor0";
        break;
      case 36 /* TRAP_INACTIVE */:
        name = "trap_inactive";
        break;
      case 38 /* EMBERS */:
        name = "embers";
        break;
      case 2 /* DOOR */:
        name = "door";
        break;
      case 3 /* DOOR_LOCKED */:
        name = "door_locked";
        break;
      case 6 /* ENTRANCE */:
        name = "stairs_up";
        break;
      case 7 /* EXIT */:
      case 5 /* EXIT_LOCKED */:
        name = "stairs_down";
        break;
      case 9 /* WATER */:
        name = "water";
        break;
      case 10 /* GRASS */:
        name = "grass";
        break;
      case 39 /* HIGH_GRASS */:
        name = "high_grass";
        break;
      case 8 /* CHASM */:
        name = "chasm";
        break;
      case 12 /* WELL */:
        name = "well";
        break;
      case 20 /* TRAP_TOXIC */:
        name = "trap_toxic";
        break;
      case 21 /* TRAP_TOXIC_HIDDEN */:
        name = "trap_toxic_secret";
        break;
      case 22 /* TRAP_FIRE */:
        name = "trap_fire";
        break;
      case 23 /* TRAP_FIRE_HIDDEN */:
        name = "trap_fire_secret";
        break;
      case 24 /* TRAP_PARALYTIC */:
        name = "trap_paralytic";
        break;
      case 25 /* TRAP_PARALYTIC_HIDDEN */:
        name = "trap_paralytic_secret";
        break;
      case 26 /* TRAP_POISON */:
        name = "trap_poison";
        break;
      case 27 /* TRAP_POISON_HIDDEN */:
        name = "trap_poison_secret";
        break;
      case 28 /* TRAP_ALARM */:
        name = "trap_alarm";
        break;
      case 29 /* TRAP_ALARM_HIDDEN */:
        name = "trap_alarm_secret";
        break;
      case 30 /* TRAP_LIGHTNING */:
        name = "trap_lightning";
        break;
      case 31 /* TRAP_LIGHTNING_HIDDEN */:
        name = "trap_lightning_secret";
        break;
      case 32 /* TRAP_GRIPPING */:
        name = "trap_gripping";
        break;
      case 33 /* TRAP_GRIPPING_HIDDEN */:
        name = "trap_gripping_secret";
        break;
      case 34 /* TRAP_SUMMONING */:
        name = "trap_summoning";
        break;
      case 35 /* TRAP_SUMMONING_HIDDEN */:
        name = "trap_summoning_secret";
        break;
      case 13 /* ALCHEMY */:
        name = "alchemy";
        break;
      case 14 /* PEDESTAL */:
        name = "pedestal";
        break;
      case 15 /* STATUE */:
        name = "statue";
        break;
      case 17 /* BOOKSHELF */:
        name = "bookshelf";
        break;
      case 18 /* CHEST */:
        name = "chest";
        break;
      case 19 /* CHEST_LOCKED */:
        name = "chest_locked";
        break;
      case 16 /* TOMB */:
        name = "tomb";
        break;
      default:
        name = (x * 7 + y * 13) % 3 === 0 ? "floor1" : "floor0";
    }
    return this.getSprite(name, region);
  }
  entitySprite(name) {
    return this.getSprite(name, undefined);
  }
  getSprite(name, region) {
    const key = `${region ?? "-"}:${name}`;
    let c = this.cache.get(key);
    if (!c) {
      c = this.prerender(name, region);
      this.cache.set(key, c);
    }
    return c;
  }
  prerender(name, region) {
    const orig = ORIGINAL_SPRITES[name];
    if (orig) {
      const bin = atob(orig.rgba);
      const bytes = new Uint8ClampedArray(bin.length);
      for (let i = 0;i < bin.length; i++)
        bytes[i] = bin.charCodeAt(i);
      const img2 = document.createElement("canvas");
      img2.width = orig.w;
      img2.height = orig.h;
      const g2 = img2.getContext("2d");
      g2.putImageData(new ImageData(bytes, orig.w, orig.h), 0, 0);
      return this.scaleUp(img2);
    }
    const rows = SPRITES[name] ?? missingSpriteRows();
    const overrides = region ? REGION_TINTS[region] : undefined;
    const img = document.createElement("canvas");
    img.width = ART_PX;
    img.height = ART_PX;
    const g = img.getContext("2d");
    const data = g.createImageData(ART_PX, ART_PX);
    for (let y = 0;y < ART_PX; y++) {
      const row = rows[y];
      for (let x = 0;x < ART_PX; x++) {
        const ch = row[x];
        const o = (y * ART_PX + x) * 4;
        if (ch === ".") {
          data.data[o + 3] = 0;
          continue;
        }
        let hex = PALETTE[ch] ?? "#ff00ff";
        if (overrides && TINTABLE.has(ch))
          hex = overrides[ch] ?? hex;
        const rgb = hexToRgb(hex);
        data.data[o] = rgb[0];
        data.data[o + 1] = rgb[1];
        data.data[o + 2] = rgb[2];
        data.data[o + 3] = 255;
      }
    }
    g.putImageData(data, 0, 0);
    return this.scaleUp(img);
  }
  scaleUp(img) {
    const big = document.createElement("canvas");
    big.width = TILE_PX;
    big.height = TILE_PX;
    const bg = big.getContext("2d");
    bg.imageSmoothingEnabled = false;
    bg.drawImage(img, 0, 0, TILE_PX, TILE_PX);
    return big;
  }
}

// src/engine/input.ts
class InputHandler {
  onToggleMinimap = () => {};
  onToggleInventory = () => {};
  game = null;
  screenToTile = null;
  canvas = null;
  detachFns = [];
  attach(canvas, screenToTile, game) {
    this.detach();
    this.canvas = canvas;
    this.screenToTile = screenToTile;
    this.game = game;
    const onKey = (e) => this.handleKey(e);
    const onPointer = (e) => {
      const t = this.screenToTile;
      const g = this.game;
      if (!t || !g)
        return;
      const tile = t(e.clientX, e.clientY);
      this.handleTileTap(tile.x, tile.y);
    };
    window.addEventListener("keydown", onKey);
    canvas.addEventListener("pointerdown", onPointer);
    this.detachFns = [
      () => window.removeEventListener("keydown", onKey),
      () => canvas.removeEventListener("pointerdown", onPointer)
    ];
  }
  detach() {
    for (const fn of this.detachFns)
      fn();
    this.detachFns = [];
    this.game = null;
    this.screenToTile = null;
    this.canvas = null;
  }
  handleKey(e) {
    const game = this.game;
    if (!game || game.gameOver)
      return;
    const k = e.key;
    const move = DIRS[k.toLowerCase()];
    if (move) {
      e.preventDefault();
      game.queueIntent({ kind: "move", dx: move[0], dy: move[1] });
      return;
    }
    switch (k) {
      case " ":
      case ".":
        e.preventDefault();
        game.queueIntent({ kind: "wait" });
        break;
      case "g":
      case "G":
        game.queueIntent({ kind: "pickup" });
        break;
      case "f":
      case "F":
        game.queueIntent({ kind: "search" });
        break;
      case "m":
      case "M":
        this.onToggleMinimap();
        break;
      case "i":
      case "I":
        this.onToggleInventory();
        break;
      case ">":
        game.queueIntent({ kind: "descend" });
        break;
      case "<":
        game.queueIntent({ kind: "ascend" });
        break;
      default:
        break;
    }
  }
  handleTileTap(tx, ty) {
    const game = this.game;
    if (!game || game.gameOver)
      return;
    const { level, hero } = game;
    if (!level.inBounds(tx, ty))
      return;
    if (tx === hero.x && ty === hero.y) {
      game.queueIntent({ kind: "wait" });
      return;
    }
    const mob = level.mobAt(tx, ty);
    if (mob && Grid.chebyshev(tx, ty, hero.x, hero.y) === 1) {
      const live = game.mobs.find((m) => m.id === mob.id);
      if (live) {
        if (typeof live.onTalk === "function") {
          game.queueIntent({ kind: "talk", targetId: live.id });
        } else {
          game.queueIntent({ kind: "attack", targetId: live.id });
        }
      }
      return;
    }
    const here = level.idx(hero.x, hero.y);
    const tapped = level.idx(tx, ty);
    if (tapped === level.stairsDown && here === level.stairsDown) {
      game.queueIntent({ kind: "descend" });
      return;
    }
    if (tapped === level.stairsUp && here === level.stairsUp) {
      game.queueIntent({ kind: "ascend" });
      return;
    }
    const path = findPath(level, (x, y) => level.isPassable(x, y) && !level.mobAt(x, y), hero.x, hero.y, tx, ty);
    if (!path || path.length === 0) {
      if (tx !== hero.x || ty !== hero.y)
        game.logMsg("No route there.");
      game.cancelPath();
      return;
    }
    game.setPath(path);
  }
}
var DIRS = {
  arrowup: [0, -1],
  w: [0, -1],
  arrowdown: [0, 1],
  s: [0, 1],
  arrowleft: [-1, 0],
  a: [-1, 0],
  arrowright: [1, 0],
  d: [1, 0],
  q: [-1, -1],
  e: [1, -1],
  z: [-1, 1],
  c: [1, 1]
};

// src/engine/save.ts
var SAVE_KEY = "pdv2-save-1";
var SAVE_VERSION = 1;
function hasSave(key = SAVE_KEY) {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}
function clearSave(key = SAVE_KEY) {
  try {
    localStorage.removeItem(key);
  } catch {}
}
function saveGame(game, mechanics, key = SAVE_KEY) {
  const lvl = game.level;
  const data = {
    version: SAVE_VERSION,
    seed: game.seed,
    rngState: game.rng.serialize(),
    depth: lvl.depth,
    turnCount: game.turnCount,
    schedulerNow: game.scheduler.now,
    gameOver: game.gameOver,
    log: game.log,
    level: {
      w: lvl.w,
      h: lvl.h,
      depth: lvl.depth,
      region: lvl.region,
      tiles: Array.from(lvl.tiles),
      explored: Array.from(lvl.explored),
      stairsUp: lvl.stairsUp,
      stairsDown: lvl.stairsDown,
      doors: [...lvl.doors],
      traps: [...lvl.traps],
      items: lvl.items.map((it) => ({ ...it })),
      sealed: lvl.sealed,
      bossLevel: lvl.bossLevel,
      bossArena: lvl.bossArena ? { ...lvl.bossArena } : null,
      arenaDoorCell: lvl.arenaDoorCell,
      enteredArena: lvl.enteredArena,
      keyDropped: lvl.keyDropped
    },
    hero: mechanics.saveHero(game.hero),
    mobs: game.mobs.map((m) => mechanics.saveMob(m)),
    run: { ...game.run },
    quests: saveQuestState()
  };
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    game.logMsg(`Save failed: ${e instanceof Error ? e.message : e}`);
  }
}
function loadGame(mechanics, key = SAVE_KEY) {
  let raw;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw)
    return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data.version !== SAVE_VERSION || !data.level || !data.hero)
    return null;
  const lvl = new Level(data.level.w, data.level.h);
  lvl.depth = data.level.depth;
  lvl.region = data.level.region;
  lvl.tiles = Uint8Array.from(data.level.tiles);
  lvl.explored = Uint8Array.from(data.level.explored);
  lvl.stairsUp = data.level.stairsUp;
  lvl.stairsDown = data.level.stairsDown;
  lvl.doors = [...data.level.doors];
  lvl.traps = [...data.level.traps];
  lvl.items = data.level.items.map((it) => ({ ...it }));
  lvl.sealed = data.level.sealed ?? false;
  lvl.bossLevel = data.level.bossLevel ?? false;
  lvl.bossArena = data.level.bossArena ? { ...data.level.bossArena } : null;
  lvl.arenaDoorCell = data.level.arenaDoorCell ?? -1;
  lvl.enteredArena = data.level.enteredArena ?? false;
  lvl.keyDropped = data.level.keyDropped ?? false;
  const rng = RNG.restore(data.seed, data.rngState);
  const game = new Game(data.seed, {
    gen: { generate: () => lvl },
    mechanics
  });
  game.rng = rng;
  game.turnCount = data.turnCount;
  game.gameOver = data.gameOver;
  game.log = [...data.log];
  game.run = data.run ? { ...data.run } : newRunState();
  restoreQuestState(data.quests);
  const hero = mechanics.reviveHero(rng, data.hero);
  game.hero = hero;
  game.mobs = data.mobs.map((md) => mechanics.reviveMob(rng, md));
  game.level.mobs = mobsToPlaced(game.mobs);
  game.scheduler.clear();
  game.scheduler.now = data.schedulerNow;
  game.scheduler.add(hero);
  for (const m of game.mobs)
    game.scheduler.add(m);
  game.level.updateFov(hero.x, hero.y, hero.sight);
  if (hero.buffs?.blindness) {
    game.level.visible.fill(0);
  }
  return game;
}

// src/ui/heroView.ts
function asHero2(game) {
  return game.hero;
}
function readHeroView(game) {
  const h = asHero2(game);
  const hunger = h.buffs?.["hunger"]?.left ?? 0;
  const buffs = h.buffs ? Object.keys(h.buffs) : [];
  const lvl = h.lvl ?? 1;
  return {
    hp: Math.max(0, game.hero.hp),
    ht: Math.max(1, game.hero.ht),
    lvl,
    exp: h.exp ?? 0,
    maxExp: maxExp(lvl),
    str: h.str ?? 10,
    hunger,
    hungry: isHungry(hunger),
    starving: isStarving(hunger),
    gold: h.gold ?? 0,
    buffs,
    name: game.hero.name || "you",
    pos: game.hero.y * game.level.w + game.hero.x
  };
}

// src/ui/bufficons.ts
var BUFF_ICON_PX = 7;
var BUFF_ICON_SCALE = 3;
var BUFF_ICON_DRAW = BUFF_ICON_PX * BUFF_ICON_SCALE;
var BUFF_ICON_GAP = 2 * BUFF_ICON_SCALE;
var BUFF_ICON_PITCH = BUFF_ICON_DRAW + BUFF_ICON_GAP;
var BUFF_REMOVE_MS = 600;
function buffIconKey(kind) {
  switch (kind) {
    case "burning":
      return "bufficon_fire";
    case "poison":
      return "bufficon_poison";
    case "paralysis":
      return "bufficon_paralysis";
    case "ooze":
      return "bufficon_ooze";
    case "roots":
      return "bufficon_roots";
    default:
      return null;
  }
}
function buffStripKeys(buffs) {
  const keys = [];
  for (const b of buffs) {
    const k = buffIconKey(b);
    if (k && !keys.includes(k))
      keys.push(k);
  }
  return keys;
}
function buffIconX(x0, i) {
  return x0 + i * BUFF_ICON_PITCH;
}
function trackRemovedIcons(prev, nextKeys, live, now) {
  const kept = live.filter((r) => nextKeys.includes(r.key) || removedIconTransform(r.at, now) !== null);
  for (let i = 0;i < prev.keys.length; i++) {
    const k = prev.keys[i];
    if (!nextKeys.includes(k) && !kept.some((r) => r.key === k)) {
      kept.push({ key: k, x: buffIconX(prev.x0, i), at: now });
    }
  }
  return kept;
}
function removedIconTransform(at, now) {
  const p = (now - at) / BUFF_REMOVE_MS;
  if (p < 0 || p >= 1)
    return null;
  return { scale: 1 + 5 * p, alpha: 1 - p };
}
var iconCache = new Map;
function buffIconCanvas(key) {
  if (iconCache.has(key))
    return iconCache.get(key);
  let canvas = null;
  try {
    const spr = ORIGINAL_SPRITES[key];
    if (spr && spr.w === BUFF_ICON_PX && spr.h === BUFF_ICON_PX) {
      const bin = atob(spr.rgba);
      const bytes = new Uint8ClampedArray(bin.length);
      for (let i = 0;i < bin.length; i++)
        bytes[i] = bin.charCodeAt(i);
      canvas = document.createElement("canvas");
      canvas.width = BUFF_ICON_PX;
      canvas.height = BUFF_ICON_PX;
      const g = canvas.getContext("2d");
      if (g) {
        g.putImageData(new ImageData(bytes, BUFF_ICON_PX, BUFF_ICON_PX), 0, 0);
      } else {
        canvas = null;
      }
    }
  } catch {
    canvas = null;
  }
  iconCache.set(key, canvas);
  return canvas;
}

// src/ui/hud.ts
class LogBuffer {
  now;
  lines = [];
  seen = 0;
  constructor(now = () => Date.now()) {
    this.now = now;
  }
  sync(log) {
    const fresh = log.slice(this.seen);
    this.seen = log.length;
    const t = this.now();
    for (const text of fresh)
      this.lines.push({ text, at: t });
    if (this.lines.length > 40)
      this.lines.splice(0, this.lines.length - 40);
    return fresh;
  }
  visible(n) {
    const t = this.now();
    return this.lines.slice(-n).map((l) => {
      const age = (t - l.at) / 1000;
      return { text: l.text, alpha: Math.max(0.22, 1 - age / 9) };
    });
  }
  reset() {
    this.lines = [];
    this.seen = 0;
  }
}
var SLOT = 56;

class Hud {
  logBuffer = new LogBuffer;
  prevStripKeys = [];
  removedStripIcons = [];
  stripX0 = 8;
  layout(view) {
    const pad = 10;
    const dartBtn = { x: view.w - pad - SLOT, y: view.h - pad - SLOT, w: SLOT, h: SLOT };
    const potionBtn = { x: dartBtn.x - 8 - SLOT, y: view.h - pad - SLOT, w: SLOT, h: SLOT };
    return { potionBtn, dartBtn, topBarH: 64 };
  }
  draw(ctx, game, sprites, view, opts = { throwMode: false }) {
    const hv = readHeroView(game);
    const L = this.layout(view);
    this.drawTopBar(ctx, game, view, hv, opts.now);
    this.drawLog(ctx, view);
    this.drawQuickSlots(ctx, game, sprites, view, L, opts.throwMode);
  }
  drawTopBar(ctx, game, view, hv, now) {
    ctx.fillStyle = "rgba(10, 8, 14, 0.78)";
    ctx.fillRect(0, 0, view.w, 64);
    const barW = Math.min(210, view.w - 180);
    const lowHp = hv.hp / hv.ht < 0.25;
    drawBar(ctx, { x: 8, y: 8, w: barW, h: 18 }, hv.hp / hv.ht, lowHp ? UI.hpLow : UI.hp, UI.hpTrack, `${hv.hp}/${hv.ht}`, 11);
    drawBar(ctx, { x: 8, y: 31, w: barW, h: 10 }, hv.exp / hv.maxExp, UI.xp, UI.xpTrack, "", 9);
    ctx.fillStyle = UI.textLight;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(`Lvl ${hv.lvl}  ${hv.exp}/${hv.maxExp} XP`, 8 + barW + 8, 36);
    const region = regionForDepth(game.level.depth);
    const regionName = region.charAt(0).toUpperCase() + region.slice(1);
    ctx.textAlign = "right";
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.fillStyle = UI.textLight;
    ctx.fillText(`Depth ${game.level.depth} · ${regionName}`, view.w - 8, 17);
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillStyle = "#9a917e";
    ctx.fillText(`seed ${game.seed}`, view.w - 8, 34);
    ctx.textAlign = "left";
    const hx = 8 + barW + 8;
    if (hv.starving) {
      drawDrumstick(ctx, hx, 44, 16);
      ctx.fillStyle = UI.danger;
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.fillText("Starving!", hx + 20, 52);
    } else if (hv.hungry) {
      drawDrumstick(ctx, hx, 44, 16);
      ctx.fillStyle = "#e8a33d";
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.fillText("Hungry", hx + 20, 52);
    } else {
      ctx.globalAlpha = 0.45;
      drawDrumstick(ctx, hx, 44, 16);
      ctx.globalAlpha = 1;
    }
    const gx = view.w - 90;
    drawCoin(ctx, gx, 52, 8);
    ctx.fillStyle = UI.gold;
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillText(`${hv.gold}`, gx + 12, 52);
    this.drawBuffStrip(ctx, view, hv.buffs, 8, 43, now);
  }
  drawBuffStrip(ctx, view, buffs, x0, y, now) {
    const t = now ?? Date.now();
    const keys = buffStripKeys(buffs);
    this.removedStripIcons = trackRemovedIcons({ keys: this.prevStripKeys, x0: this.stripX0 }, keys, this.removedStripIcons, t);
    this.prevStripKeys = keys;
    this.stripX0 = x0;
    ctx.imageSmoothingEnabled = false;
    const maxX = view.w - 110;
    let bx = x0;
    for (const key of keys) {
      const img = buffIconCanvas(key);
      if (img)
        ctx.drawImage(img, bx, y, BUFF_ICON_DRAW, BUFF_ICON_DRAW);
      bx += BUFF_ICON_PITCH;
      if (bx > maxX)
        break;
    }
    for (const r of this.removedStripIcons) {
      const tr = removedIconTransform(r.at, t);
      if (!tr)
        continue;
      const img = buffIconCanvas(r.key);
      if (!img)
        continue;
      const size = BUFF_ICON_DRAW * tr.scale;
      const cx = r.x + BUFF_ICON_DRAW / 2;
      const cy = y + BUFF_ICON_DRAW / 2;
      ctx.globalAlpha = Math.max(0, tr.alpha);
      ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }
  drawLog(ctx, view) {
    const lines = this.logBuffer.visible(4);
    ctx.font = "12px system-ui, sans-serif";
    ctx.textBaseline = "alphabetic";
    const slotH = 18;
    const bottomY = view.h - SLOT - 22;
    lines.forEach((l, i) => {
      const y = bottomY - (lines.length - 1 - i) * slotH;
      ctx.globalAlpha = l.alpha;
      ctx.fillStyle = "#000";
      ctx.fillText(l.text, 9, y + 1);
      ctx.fillStyle = UI.log;
      ctx.fillText(l.text, 8, y);
    });
    ctx.globalAlpha = 1;
  }
  drawQuickSlots(ctx, game, sprites, view, L, throwMode) {
    const items = readInventory(game);
    const potion = items.find((i) => i.kind === "potion") ?? null;
    const darts = items.find((i) => i.kind === "missile") ?? null;
    this.drawSlot(ctx, sprites, L.potionBtn, potion?.sprite ?? "potion_red", potion ? 1 : 0, "Drink", !potion);
    this.drawSlot(ctx, sprites, L.dartBtn, "dart", darts ? darts.qty : 0, throwMode ? "Aim…" : "Throw", !darts || darts.qty <= 0, throwMode);
  }
  drawSlot(ctx, sprites, r, sprite, qty, hint, dimmed, active = false) {
    drawPanel(ctx, r, 12);
    if (active) {
      ctx.strokeStyle = UI.gold;
      ctx.lineWidth = 3;
      ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
    }
    ctx.globalAlpha = dimmed ? 0.35 : 1;
    try {
      ctx.drawImage(sprites.entitySprite(sprite), r.x + 8, r.y + 4, r.w - 16, r.w - 16);
    } catch {}
    ctx.globalAlpha = 1;
    if (qty > 1) {
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 3;
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.strokeText(`${qty}`, r.x + r.w - 5, r.y + r.h - 16);
      ctx.fillText(`${qty}`, r.x + r.w - 5, r.y + r.h - 16);
      ctx.textAlign = "left";
    }
    ctx.fillStyle = UI.textDim;
    ctx.font = "9px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(hint, r.x + r.w / 2, r.y + r.h - 5);
    ctx.textAlign = "left";
  }
}

// src/ui/minimap.ts
var MM = {
  unseen: 0,
  floor: 1,
  wall: 2,
  water: 3,
  door: 4,
  stairsUp: 5,
  stairsDown: 6,
  grass: 7,
  chasm: 8,
  hero: 9,
  mob: 10,
  item: 11
};
function computeMinimap(level, mobs) {
  const { w, h } = level;
  const cells = new Uint8Array(w * h);
  for (let y = 0;y < h; y++) {
    for (let x = 0;x < w; x++) {
      const i = level.idx(x, y);
      if (!level.explored[i])
        continue;
      const t = level.get(x, y);
      let c = MM.floor;
      switch (t) {
        case 0 /* WALL */:
        case 37 /* BARRICADE */:
          c = MM.wall;
          break;
        case 9 /* WATER */:
          c = MM.water;
          break;
        case 2 /* DOOR */:
        case 4 /* DOOR_SECRET */:
        case 3 /* DOOR_LOCKED */:
          c = MM.door;
          break;
        case 6 /* ENTRANCE */:
          c = MM.stairsUp;
          break;
        case 7 /* EXIT */:
        case 5 /* EXIT_LOCKED */:
          c = MM.stairsDown;
          break;
        case 10 /* GRASS */:
        case 39 /* HIGH_GRASS */:
          c = MM.grass;
          break;
        case 8 /* CHASM */:
          c = MM.chasm;
          break;
        case 20 /* TRAP_TOXIC */:
        case 22 /* TRAP_FIRE */:
        case 24 /* TRAP_PARALYTIC */:
        case 26 /* TRAP_POISON */:
        case 28 /* TRAP_ALARM */:
        case 30 /* TRAP_LIGHTNING */:
        case 32 /* TRAP_GRIPPING */:
        case 34 /* TRAP_SUMMONING */:
          c = MM.floor;
          break;
        default:
          c = MM.floor;
      }
      cells[i] = c;
    }
  }
  for (const it of level.items) {
    if (level.explored[it.pos])
      cells[it.pos] = MM.item;
  }
  for (const m of mobs) {
    if (!level.inBounds(m.x, m.y))
      continue;
    const i = level.idx(m.x, m.y);
    if (level.explored[i])
      cells[i] = m.hostile ? MM.mob : MM.floor;
  }
  return { w, h, cells };
}
var MM_COLORS = {
  [MM.floor]: "#7a8a5f",
  [MM.wall]: "#4a4258",
  [MM.water]: "#2f8fa8",
  [MM.door]: "#b07a3f",
  [MM.stairsUp]: "#ffd75e",
  [MM.stairsDown]: "#ffd75e",
  [MM.grass]: "#58a03d",
  [MM.chasm]: "#0a0a10",
  [MM.hero]: "#ffffff",
  [MM.mob]: "#e04030",
  [MM.item]: "#e8e3d0"
};

class Minimap {
  open = false;
  toggle() {
    this.open = !this.open;
  }
  layout(view, level) {
    const maxW = Math.min(view.w - 24, 240);
    const maxH = Math.min(view.h * 0.5, 260);
    const scale = Math.max(2, Math.min(maxW / level.w, maxH / level.h));
    const w = Math.ceil(level.w * scale);
    const h = Math.ceil(level.h * scale);
    return { x: view.w - w - 12, y: 72, w, h };
  }
  draw(ctx, game, view, nowMs) {
    if (!this.open)
      return;
    const level = game.level;
    const data = computeMinimap(level, game.mobs);
    const panel = this.layout(view, level);
    const pad = 6;
    drawPanel(ctx, { x: panel.x - pad, y: panel.y - pad, w: panel.w + pad * 2, h: panel.h + pad * 2 }, 10);
    const sx = panel.w / level.w;
    const sy = panel.h / level.h;
    for (let y = 0;y < data.h; y++) {
      for (let x = 0;x < data.w; x++) {
        const c = data.cells[level.idx(x, y)];
        if (c === MM.unseen)
          continue;
        ctx.fillStyle = MM_COLORS[c] ?? MM_COLORS[MM.floor];
        ctx.fillRect(panel.x + x * sx, panel.y + y * sy, Math.ceil(sx), Math.ceil(sy));
      }
    }
    const hx = panel.x + (game.hero.x + 0.5) * sx;
    const hy = panel.y + (game.hero.y + 0.5) * sy;
    const pulse = 2.5 + Math.sin(nowMs / 280) * 0.8;
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx, hy, Math.max(2.5, pulse), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    for (const [cell, up] of [
      [level.stairsUp, true],
      [level.stairsDown, false]
    ]) {
      if (cell < 0)
        continue;
      const x = cell % level.w;
      const y = Math.floor(cell / level.w);
      if (!level.explored[cell])
        continue;
      const cx = panel.x + (x + 0.5) * sx;
      const cy = panel.y + (y + 0.5) * sy;
      ctx.fillStyle = UI.gold;
      ctx.strokeStyle = UI.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (up) {
        ctx.moveTo(cx - 3, cy + 2);
        ctx.lineTo(cx, cy - 2);
        ctx.lineTo(cx + 3, cy + 2);
      } else {
        ctx.moveTo(cx - 3, cy - 2);
        ctx.lineTo(cx, cy + 2);
        ctx.lineTo(cx + 3, cy - 2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
}

// src/ui/screens.ts
var CONTROLS = [
  { key: "Arrows / WASD / QEZC", action: "Move (8 directions)" },
  { key: "Space / .", action: "Wait a turn" },
  { key: "G", action: "Pick up item" },
  { key: "I", action: "Inventory" },
  { key: "M", action: "Minimap" },
  { key: ">  /  <", action: "Descend / ascend stairs" },
  { key: "Esc", action: "Pause / resume" },
  { key: "Tap dungeon", action: "Walk there (tap-to-move)" },
  { key: "Tap enemy", action: "Attack adjacent enemy" },
  { key: "Tap hero", action: "Wait a turn" },
  { key: "Dart slot → tap foe", action: "Throw a dart" }
];

class Screens {
  state = "title";
  seedText = "";
  seedEditing = false;
  onStartRun = () => {};
  onContinue = () => {};
  onQuitToTitle = () => {};
  onAbandonRun = () => {};
  hasSave = () => false;
  getSummary = () => null;
  buttons = [];
  seedRect = null;
  show(s) {
    this.state = s;
    this.seedEditing = false;
  }
  titleLayout(view) {
    const bw = Math.min(280, view.w - 64);
    const bx = (view.w - bw) / 2;
    const cy = view.h * 0.52;
    const buttons = [
      { id: "new", rect: { x: bx, y: cy, w: bw, h: 52 }, label: "New Run", primary: true },
      {
        id: "continue",
        rect: { x: bx, y: cy + 62, w: bw, h: 52 },
        label: "Continue",
        disabled: !this.hasSave()
      }
    ];
    const seedRect = { x: bx, y: cy + 124, w: bw - 64, h: 48 };
    buttons.push({ id: "random", rect: { x: bx + bw - 56, y: cy + 124, w: 56, h: 48 }, label: "\uD83C\uDFB2" });
    return { buttons, seedRect };
  }
  handleKey(e) {
    if (this.state === "title") {
      if (this.seedEditing) {
        if (e.key === "Enter" || e.key === "Escape") {
          this.seedEditing = false;
          e.preventDefault();
          return true;
        }
        if (e.key === "Backspace") {
          this.seedText = this.seedText.slice(0, -1);
          e.preventDefault();
          return true;
        }
        if (/^[0-9]$/.test(e.key) && this.seedText.length < 10) {
          this.seedText += e.key;
          e.preventDefault();
          return true;
        }
        return true;
      }
      if (e.key === "Enter") {
        this.startFromSeed();
        e.preventDefault();
        return true;
      }
      return false;
    }
    if (this.state === "dead") {
      if (e.key === "Enter") {
        this.onStartRun(this.parseSeed() ?? Math.random() * 4294967295 >>> 0);
        e.preventDefault();
        return true;
      }
      return false;
    }
    if (this.state === "paused" || this.state === "help") {
      if (e.key === "Escape" || e.key.toLowerCase() === "p") {
        this.show(this.state === "help" ? "paused" : "playing");
        e.preventDefault();
        return true;
      }
      return false;
    }
    return false;
  }
  handleTap(x, y) {
    if (this.state !== "title" && this.state !== "dead" && this.state !== "paused" && this.state !== "help") {
      return false;
    }
    if (this.state === "title") {
      const { buttons, seedRect } = this.titleLayout(Screens.lastView ?? { w: 390, h: 700 });
      if (inRect(seedRect, x, y)) {
        this.seedEditing = true;
        return true;
      }
      this.seedEditing = false;
      for (const b of buttons) {
        if (inRect(b.rect, x, y) && !b.disabled) {
          this.pressTitle(b.id);
          return true;
        }
      }
      return true;
    }
    for (const b of this.buttons) {
      if (inRect(b.rect, x, y) && !b.disabled) {
        this.press(b.id);
        return true;
      }
    }
    return true;
  }
  pressTitle(id) {
    if (id === "new")
      this.startFromSeed();
    else if (id === "continue")
      this.onContinue();
    else if (id === "random")
      this.seedText = `${Math.random() * 4294967295 >>> 0}`;
  }
  startFromSeed() {
    const s = this.parseSeed();
    this.onStartRun(s ?? Math.random() * 4294967295 >>> 0);
  }
  parseSeed() {
    const t = this.seedText.trim();
    if (t === "")
      return null;
    const n = Number(t);
    return Number.isFinite(n) ? n >>> 0 : null;
  }
  press(id) {
    switch (id) {
      case "resume":
        this.show("playing");
        break;
      case "help":
        this.show("help");
        break;
      case "back-pause":
        this.show("paused");
        break;
      case "save-quit":
        this.onQuitToTitle();
        break;
      case "abandon":
        this.onAbandonRun();
        break;
      case "retry":
        this.onStartRun(Math.random() * 4294967295 >>> 0);
        break;
      case "to-title":
        this.onQuitToTitle();
        break;
    }
  }
  static lastView = null;
  draw(ctx, sprites, view, nowMs) {
    Screens.lastView = view;
    if (this.state === "title")
      this.drawTitle(ctx, sprites, view, nowMs);
    else if (this.state === "dead")
      this.drawDeath(ctx, view);
    else if (this.state === "paused")
      this.drawPause(ctx, view);
    else if (this.state === "help")
      this.drawHelp(ctx, view);
  }
  drawTitle(ctx, sprites, view, nowMs) {
    ctx.fillStyle = UI.backdrop;
    ctx.fillRect(0, 0, view.w, view.h);
    const keys = ["mob_rat", "mob_gnoll", "hero_warrior", "mob_crab", "mob_goo"];
    const size = 56;
    const totalW = keys.length * (size + 10);
    let sx = (view.w - totalW) / 2;
    const sy = view.h * 0.3;
    for (const k of keys) {
      try {
        ctx.drawImage(sprites.entitySprite(k), sx, sy, size, size);
      } catch {}
      sx += size + 10;
    }
    ctx.textAlign = "center";
    ctx.font = "bold 40px system-ui, sans-serif";
    ctx.lineWidth = 8;
    ctx.strokeStyle = UI.ink;
    const ty = view.h * 0.2;
    ctx.strokeText("PIXEL DUNGEON", view.w / 2, ty);
    ctx.fillStyle = UI.gold;
    ctx.fillText("PIXEL DUNGEON", view.w / 2, ty);
    ctx.font = "15px system-ui, sans-serif";
    ctx.fillStyle = "#9a917e";
    ctx.fillText("a storybook roguelike · v2", view.w / 2, ty + 30);
    ctx.fillText("The Sewers await. Permadeath is forever.", view.w / 2, ty + 52);
    ctx.textAlign = "left";
    const { buttons, seedRect } = this.titleLayout(view);
    this.seedRect = seedRect;
    for (const b of buttons)
      drawButton(ctx, b.rect, b.label, { disabled: b.disabled, primary: b.primary, fontSize: 17 });
    ctx.fillStyle = this.seedEditing ? "#fff8e6" : "#e8dcc0";
    ctx.strokeStyle = this.seedEditing ? UI.gold : UI.ink;
    ctx.lineWidth = 3;
    roundRect(ctx, seedRect, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = UI.text;
    ctx.font = "16px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const shown = this.seedText === "" ? this.seedEditing ? "" : "seed (optional)" : this.seedText;
    ctx.fillStyle = this.seedText === "" && !this.seedEditing ? UI.textDim : UI.text;
    ctx.fillText(shown, seedRect.x + 12, seedRect.y + seedRect.h / 2);
    if (this.seedEditing && Math.floor(nowMs / 500) % 2 === 0) {
      const tw = ctx.measureText(this.seedText).width;
      ctx.fillRect(seedRect.x + 12 + tw + 2, seedRect.y + 10, 2, seedRect.h - 20);
    }
    ctx.textBaseline = "alphabetic";
  }
  drawDeath(ctx, view) {
    ctx.fillStyle = "rgba(20, 4, 6, 0.92)";
    ctx.fillRect(0, 0, view.w, view.h);
    const s = this.getSummary();
    ctx.textAlign = "center";
    ctx.font = "bold 44px system-ui, sans-serif";
    ctx.lineWidth = 8;
    ctx.strokeStyle = UI.ink;
    ctx.strokeText("YOU DIED", view.w / 2, view.h * 0.22);
    ctx.fillStyle = UI.danger;
    ctx.fillText("YOU DIED", view.w / 2, view.h * 0.22);
    ctx.font = "15px system-ui, sans-serif";
    ctx.fillStyle = UI.textLight;
    ctx.fillText(s?.cause ?? "The dungeon claims another.", view.w / 2, view.h * 0.22 + 34);
    if (s) {
      const rows = [
        ["Depth", `${s.depth}`],
        ["Turns", `${s.turns}`],
        ["Level", `${s.lvl}`],
        ["Kills", `${s.kills}`],
        ["Gold", `${s.gold}`],
        ["Seed", `${s.seed}`]
      ];
      const pw = Math.min(320, view.w - 48);
      const px = (view.w - pw) / 2;
      const py = view.h * 0.22 + 56;
      drawPanel(ctx, { x: px, y: py, w: pw, h: rows.length * 30 + 20 }, 12);
      ctx.font = "14px system-ui, sans-serif";
      rows.forEach(([k, v], i) => {
        const y = py + 26 + i * 30;
        ctx.textAlign = "left";
        ctx.fillStyle = UI.textDim;
        ctx.fillText(k, px + 20, y);
        ctx.textAlign = "right";
        ctx.fillStyle = UI.text;
        ctx.font = "bold 14px system-ui, sans-serif";
        ctx.fillText(v, px + pw - 20, y);
        ctx.font = "14px system-ui, sans-serif";
      });
      ctx.textAlign = "left";
    }
    const bw = Math.min(280, view.w - 64);
    const bx = (view.w - bw) / 2;
    const by = view.h * 0.22 + 56 + 6 * 30 + 40;
    this.buttons = [
      { id: "retry", rect: { x: bx, y: by, w: bw, h: 52 }, label: "Try Again", primary: true },
      { id: "to-title", rect: { x: bx, y: by + 62, w: bw, h: 52 }, label: "Title Screen" }
    ];
    for (const b of this.buttons)
      drawButton(ctx, b.rect, b.label, { primary: b.primary, fontSize: 17 });
  }
  drawPause(ctx, view) {
    ctx.fillStyle = UI.scrim;
    ctx.fillRect(0, 0, view.w, view.h);
    const pw = Math.min(420, view.w - 32);
    const px = (view.w - pw) / 2;
    const py = Math.max(24, view.h * 0.12);
    const ph = Math.min(view.h - py * 2, CONTROLS.length * 26 + 210);
    drawPanel(ctx, { x: px, y: py, w: pw, h: ph }, 12);
    ctx.fillStyle = UI.text;
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Paused", view.w / 2, py + 36);
    ctx.textAlign = "left";
    ctx.font = "13px system-ui, sans-serif";
    CONTROLS.slice(0, 7).forEach((c, i) => {
      const y = py + 64 + i * 24;
      ctx.fillStyle = UI.textDim;
      ctx.fillText(c.key, px + 20, y);
      ctx.fillStyle = UI.text;
      ctx.fillText(c.action, px + 190, y);
    });
    const bw = pw - 40;
    const bx = px + 20;
    let by = py + 64 + 7 * 24 + 12;
    this.buttons = [
      { id: "resume", rect: { x: bx, y: by, w: bw, h: 50 }, label: "Resume", primary: true },
      { id: "help", rect: { x: bx, y: by += 60, w: bw, h: 50 }, label: "All Controls" },
      { id: "save-quit", rect: { x: bx, y: by += 60, w: bw, h: 50 }, label: "Save & Quit to Title" },
      { id: "abandon", rect: { x: bx, y: by += 60, w: bw, h: 50 }, label: "Abandon Run" }
    ];
    for (const b of this.buttons)
      drawButton(ctx, b.rect, b.label, { primary: b.primary, fontSize: 16 });
  }
  drawHelp(ctx, view) {
    ctx.fillStyle = UI.scrim;
    ctx.fillRect(0, 0, view.w, view.h);
    const pw = Math.min(460, view.w - 32);
    const px = (view.w - pw) / 2;
    const py = Math.max(20, view.h * 0.08);
    const ph = Math.min(view.h - py * 2, CONTROLS.length * 26 + 130);
    drawPanel(ctx, { x: px, y: py, w: pw, h: ph }, 12);
    ctx.fillStyle = UI.text;
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Controls", view.w / 2, py + 36);
    ctx.textAlign = "left";
    ctx.font = "13px system-ui, sans-serif";
    CONTROLS.forEach((c, i) => {
      const y = py + 64 + i * 26;
      if (y > py + ph - 70)
        return;
      ctx.fillStyle = UI.textDim;
      ctx.fillText(c.key, px + 20, y);
      ctx.fillStyle = UI.text;
      ctx.fillText(c.action, px + 200, y);
    });
    const bw = pw - 40;
    this.buttons = [{ id: "back-pause", rect: { x: px + 20, y: py + ph - 62, w: bw, h: 50 }, label: "Back", primary: true }];
    for (const b of this.buttons)
      drawButton(ctx, b.rect, b.label, { primary: b.primary, fontSize: 16 });
  }
}

// src/ui/shop.ts
var ROW_H2 = 56;
var HEADER_H = 52;
var TAB_H = 40;

class ShopPanel {
  open = false;
  tab = "buy";
  selected = 0;
  notice = "";
  openShop(tab = "buy") {
    this.open = true;
    this.tab = tab;
    this.selected = 0;
    this.notice = "";
  }
  close() {
    this.open = false;
    this.notice = "";
  }
  layout(view, rowCount) {
    const wide = view.w >= 560;
    const pw = wide ? Math.min(480, view.w - 48) : view.w - 16;
    const maxRows = Math.max(1, Math.min(Math.max(rowCount, 1), Math.floor(view.h * 0.55 / ROW_H2)));
    const actionH = 64;
    const noticeH = this.notice ? 26 : 0;
    const ph = HEADER_H + TAB_H + maxRows * ROW_H2 + actionH + noticeH + 12;
    const px = (view.w - pw) / 2;
    const py = wide ? (view.h - ph) / 2 : Math.max(8, view.h - ph - 8);
    const panel = { x: px, y: py, w: pw, h: ph };
    const tabW = (pw - 20) / 2;
    const rows = [];
    for (let i = 0;i < maxRows; i++) {
      rows.push({ x: px + 10, y: py + HEADER_H + TAB_H + i * ROW_H2, w: pw - 20, h: ROW_H2 - 6 });
    }
    const actions = [];
    return {
      panel,
      tabBuy: { x: px + 10, y: py + HEADER_H + 4, w: tabW, h: TAB_H - 8 },
      tabSell: { x: px + 10 + tabW, y: py + HEADER_H + 4, w: tabW, h: TAB_H - 8 },
      goldText: "",
      rows,
      actions,
      closeBtn: { x: px + pw - 52, y: py + 6, w: TAP, h: TAP }
    };
  }
  actionsFor(game) {
    const view = ShopPanel.lastView ?? { w: 390, h: 700 };
    const L = this.layout(view, this.rowCount(game));
    const ay = L.panel.y + HEADER_H + TAB_H + L.rows.length * ROW_H2 + 6 + (this.notice ? 26 : 0);
    const mk = (i, n, id, label, disabled = false, primary = false) => {
      const bw = (L.panel.w - 20 - (n - 1) * 8) / n;
      return { id, label, disabled, primary, rect: { x: L.panel.x + 10 + i * (bw + 8), y: ay, w: bw, h: 52 } };
    };
    if (this.tab === "buy") {
      const stock = readShopStock(game);
      const e2 = stock[this.selected];
      if (!e2)
        return [mk(0, 2, "cancel", "Never mind")];
      const price = stockBuyPrice(e2, game.level.depth);
      const hero = game.hero;
      return [
        mk(0, 2, "buy", `Buy for ${price}g`, hero.gold < price, true),
        mk(1, 2, "cancel", "Never mind")
      ];
    }
    const sellable = readSellable(game);
    const e = sellable[this.selected];
    if (!e)
      return [mk(0, 2, "cancel", "Never mind")];
    const all = shopSellAllPrice(e.unitPrice, e.qty);
    if (e.qty > 1) {
      const one = shopSellOnePrice(all, e.qty);
      return [
        mk(0, 3, "sell-one", `Sell 1 for ${one}g`),
        mk(1, 3, "sell-all", `Sell all for ${all}g`, false, true),
        mk(2, 3, "cancel", "Never mind")
      ];
    }
    return [
      mk(0, 2, "sell-all", `Sell for ${all}g`, false, true),
      mk(1, 2, "cancel", "Never mind")
    ];
  }
  rowCount(game) {
    return this.tab === "buy" ? readShopStock(game).length : readSellable(game).length;
  }
  handleTap(x, y, game) {
    if (!this.open)
      return false;
    const view = ShopPanel.lastView;
    if (!view)
      return true;
    const count = this.rowCount(game);
    if (this.selected >= count)
      this.selected = Math.max(0, count - 1);
    const L = this.layout(view, count);
    if (inRect(L.closeBtn, x, y)) {
      this.close();
      return true;
    }
    if (inRect(L.tabBuy, x, y)) {
      this.tab = "buy";
      this.selected = 0;
      this.notice = "";
      return true;
    }
    if (inRect(L.tabSell, x, y)) {
      this.tab = "sell";
      this.selected = 0;
      this.notice = "";
      return true;
    }
    for (const a of this.actionsFor(game)) {
      if (inRect(a.rect, x, y) && !a.disabled) {
        this.press(a.id, game);
        return true;
      }
    }
    for (let i = 0;i < L.rows.length; i++) {
      if (inRect(L.rows[i], x, y) && i < count) {
        this.selected = i;
        this.notice = "";
        return true;
      }
    }
    if (!inRect(L.panel, x, y))
      this.close();
    return true;
  }
  press(id, game) {
    if (id === "cancel") {
      this.close();
      return;
    }
    if (id === "buy" && this.tab === "buy") {
      const e = readShopStock(game)[this.selected];
      if (!e)
        return;
      const r = buyFromShop(game, e);
      this.notice = r.ok ? `Bought ${e.name}.` : r.reason === "no-gold" ? "Not enough gold." : "That item is gone.";
      this.selected = 0;
      return;
    }
    if ((id === "sell-one" || id === "sell-all") && this.tab === "sell") {
      const e = readSellable(game)[this.selected];
      if (!e)
        return;
      const r = sellToShop(game, e, id === "sell-one" ? "one" : "all");
      this.notice = r.ok ? `Sold ${e.name} for ${r.price}g.` : r.reason === "cursed" ? "You can't sell cursed gear while it's equipped!" : "That item is gone.";
      this.selected = 0;
    }
  }
  static lastView = null;
  draw(ctx, game, sprites, view) {
    if (!this.open)
      return;
    ShopPanel.lastView = view;
    const stock = readShopStock(game);
    const sellable = readSellable(game);
    const count = this.tab === "buy" ? stock.length : sellable.length;
    if (this.selected >= count)
      this.selected = Math.max(0, count - 1);
    const L = this.layout(view, count);
    const hero = game.hero;
    ctx.fillStyle = UI.scrim;
    ctx.fillRect(0, 0, view.w, view.h);
    drawPanel(ctx, L.panel, 12);
    ctx.fillStyle = UI.text;
    ctx.font = "bold 17px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("Shopkeeper", L.panel.x + 16, L.panel.y + 26);
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillStyle = UI.gold;
    ctx.textAlign = "right";
    ctx.fillText(`${hero.gold}g`, L.panel.x + L.panel.w - 60, L.panel.y + 26);
    ctx.textAlign = "left";
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.fillStyle = UI.text;
    ctx.textAlign = "center";
    ctx.fillText("×", L.closeBtn.x + L.closeBtn.w / 2, L.closeBtn.y + L.closeBtn.h / 2);
    ctx.textAlign = "left";
    for (const [tab, rect, label] of [
      ["buy", L.tabBuy, "Buy"],
      ["sell", L.tabSell, "Sell"]
    ]) {
      const active = this.tab === tab;
      drawButton(ctx, rect, label, { primary: active, fontSize: 14 });
    }
    const iconSize = 40;
    const rows = this.tab === "buy" ? stock : sellable;
    L.rows.forEach((r, i) => {
      const e = rows[i];
      if (!e)
        return;
      const isSel = i === this.selected;
      ctx.fillStyle = isSel ? "rgba(47,111,159,0.22)" : "rgba(0,0,0,0.06)";
      ctx.strokeStyle = isSel ? UI.accent : "rgba(20,22,28,0.25)";
      ctx.lineWidth = isSel ? 3 : 1.5;
      roundRect(ctx, r, 8);
      ctx.fill();
      ctx.stroke();
      try {
        ctx.drawImage(sprites.entitySprite(e.sprite), r.x + 6, r.y + (r.h - iconSize) / 2, iconSize, iconSize);
      } catch {}
      const qty = "qty" in e ? e.qty : e.qty;
      const name = qty > 1 ? `${e.name} ×${qty}` : e.name;
      ctx.fillStyle = UI.text;
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.fillText(name, r.x + iconSize + 12, r.y + r.h / 2 - 8);
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = UI.gold;
      const price = this.tab === "buy" ? `${stockBuyPrice(e, game.level.depth)}g` : `${shopSellAllPrice(e.unitPrice, qty)}g`;
      ctx.textAlign = "right";
      ctx.fillText(price, r.x + r.w - 10, r.y + r.h / 2 + 12);
      ctx.textAlign = "left";
      ctx.fillStyle = UI.textDim;
      const sub = this.tab === "buy" ? "for sale" : e.equipped ? "equipped" : "sell";
      ctx.fillText(sub, r.x + iconSize + 12, r.y + r.h / 2 + 12);
    });
    if (count === 0) {
      ctx.fillStyle = UI.textDim;
      ctx.font = "14px system-ui, sans-serif";
      ctx.textAlign = "center";
      const ry = L.rows[0];
      ctx.fillText(this.tab === "buy" ? "Sold out." : "Nothing the shopkeeper wants.", L.panel.x + L.panel.w / 2, ry.y + ry.h / 2);
      ctx.textAlign = "left";
    }
    if (this.notice) {
      ctx.fillStyle = UI.text;
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      const ny = L.panel.y + HEADER_H + TAB_H + L.rows.length * ROW_H2 + 18;
      ctx.fillText(this.notice, L.panel.x + L.panel.w / 2, ny);
      ctx.textAlign = "left";
    }
    for (const a of this.actionsFor(game)) {
      drawButton(ctx, a.rect, a.label, { fontSize: 14, primary: a.primary, disabled: a.disabled });
    }
  }
}

// src/ui/effects.ts
function isGoo(m) {
  const extra = m;
  return extra.mobId === "goo" || m.sprite === "mob_goo" || m.name.toLowerCase() === "goo";
}

class Effects {
  onMobDeath = () => {};
  floats = [];
  flashes = [];
  particles = [];
  banner = null;
  heroSnap = null;
  mobSnaps = new Map;
  gooPumped = false;
  gooSeen = false;
  logCursor = 0;
  lastNow = 0;
  reset() {
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
  get floatTexts() {
    return this.floats;
  }
  get flashes_() {
    return this.flashes;
  }
  get particles_() {
    return this.particles;
  }
  get banner_() {
    return this.banner;
  }
  get gooTelegraphOn() {
    return this.gooPumped;
  }
  watch(game, nowMs) {
    const dt = Math.min(0.25, Math.max(0, (nowMs - this.lastNow) / 1000 || 0.016));
    this.lastNow = nowMs;
    this.ageAll(dt);
    const hero = game.hero;
    const hlvl = hero.lvl ?? 1;
    if (!this.heroSnap) {
      this.heroSnap = { hp: hero.hp, x: hero.x, y: hero.y, lvl: hlvl };
    } else {
      const s = this.heroSnap;
      if (hero.hp < s.hp) {
        const dmg = s.hp - hero.hp;
        this.floats.push(this.mkFloat(hero.x, hero.y, `${dmg}`, UI.dmgHero, 15));
        this.flashes.push({ tx: hero.x, ty: hero.y, age: 0, ttl: 0.18, color: "rgba(255,80,60,0.55)" });
      } else if (hero.hp > s.hp) {
        this.floats.push(this.mkFloat(hero.x, hero.y, `+${hero.hp - s.hp}`, UI.heal, 14));
      }
      if (hlvl > s.lvl) {
        this.banner = { text: "LEVEL UP!", sub: `Welcome to level ${hlvl}`, age: 0, ttl: 1.6 };
        this.burst(hero.x, hero.y, UI.gold, 14);
      }
      this.heroSnap = { hp: hero.hp, x: hero.x, y: hero.y, lvl: hlvl };
    }
    const seen = new Set;
    let gooAlive = null;
    for (const m of game.mobs) {
      seen.add(m.id);
      const prev = this.mobSnaps.get(m.id);
      if (prev) {
        if (m.hp < prev.hp) {
          const dmg = prev.hp - m.hp;
          this.floats.push(this.mkFloat(m.x, m.y, `${dmg}`, UI.dmgMob, 14));
          this.flashes.push({ tx: m.x, ty: m.y, age: 0, ttl: 0.15, color: "rgba(255,255,255,0.6)" });
        }
      }
      this.mobSnaps.set(m.id, { hp: m.hp, x: m.x, y: m.y, name: m.name });
      if (isGoo(m)) {
        const pumped = m.pumpedUp === true;
        const i = game.level.idx(m.x, m.y);
        gooAlive = { x: m.x, y: m.y, hp: m.hp, ht: m.ht, pumped, visible: game.level.visible[i] === 1 };
        this.gooSeen = this.gooSeen || gooAlive.visible;
        if (pumped && !this.gooPumped) {
          this.floats.push({ ...this.mkFloat(m.x, m.y - 1, "!", "#ff9a3d", 22), ttl: 0.9 });
          this.ring(m.x, m.y, "#ff9a3d");
        }
        this.gooPumped = pumped;
      }
    }
    for (const [id, prev] of this.mobSnaps) {
      if (!seen.has(id)) {
        this.poof(prev.x, prev.y);
        this.onMobDeath(prev.name);
        this.mobSnaps.delete(id);
      }
    }
    if (!gooAlive)
      this.gooPumped = false;
    this.gooInfo = gooAlive;
    const fresh = game.log.slice(this.logCursor);
    this.logCursor = game.log.length;
    for (const line of fresh) {
      if (/you (drink|quaff)/i.test(line)) {
        this.sparkle(hero.x, hero.y);
      }
    }
  }
  gooInfo = null;
  draw(ctx, game, toScreen, view, nowMs) {
    for (const f of this.flashes) {
      const p = toScreen(f.tx, f.ty);
      const a = 1 - f.age / f.ttl;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = f.color;
      ctx.fillRect(p.x - 24, p.y - 24, 48, 48);
    }
    ctx.globalAlpha = 1;
    for (const pt of this.particles) {
      const p = toScreen(pt.tx + pt.vx * pt.age, pt.ty + pt.vy * pt.age);
      const a = pt.age < 0 ? 0 : 1 - pt.age / pt.ttl;
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.fillStyle = pt.color;
      const s = pt.size * (1 - pt.age / pt.ttl * 0.5);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of this.floats) {
      const p = toScreen(f.tx, f.ty - f.rise * f.age);
      const a = f.age < f.ttl * 0.6 ? 1 : 1 - (f.age - f.ttl * 0.6) / (f.ttl * 0.4);
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.font = `bold ${f.size}px system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(10,8,14,0.85)";
      ctx.strokeText(f.text, p.x, p.y - 10);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, p.x, p.y - 10);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    if (this.gooInfo?.pumped) {
      const p = toScreen(this.gooInfo.x, this.gooInfo.y);
      const pulse = 30 + Math.sin(nowMs / 130) * 6;
      ctx.strokeStyle = "#ff9a3d";
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (this.gooInfo && this.gooSeen) {
      const g = this.gooInfo;
      const bw = Math.min(320, view.w - 48);
      const r = { x: (view.w - bw) / 2, y: 70, w: bw, h: 15 };
      drawBar(ctx, r, g.hp / Math.max(1, g.ht), UI.boss, UI.bossTrack, `GOO  ${Math.max(0, g.hp)}/${g.ht}`, 11);
    }
    if (this.banner) {
      const b = this.banner;
      const a = b.age < 0.2 ? b.age / 0.2 : b.age > b.ttl - 0.4 ? Math.max(0, (b.ttl - b.age) / 0.4) : 1;
      ctx.globalAlpha = a;
      ctx.textAlign = "center";
      ctx.font = "bold 34px system-ui, sans-serif";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(10,8,14,0.9)";
      ctx.strokeText(b.text, view.w / 2, view.h * 0.38);
      ctx.fillStyle = UI.gold;
      ctx.fillText(b.text, view.w / 2, view.h * 0.38);
      ctx.font = "15px system-ui, sans-serif";
      ctx.fillStyle = UI.textLight;
      ctx.fillText(b.sub, view.w / 2, view.h * 0.38 + 30);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }
  }
  mkFloat(tx, ty, text, color, size) {
    return { tx, ty, text, color, size, age: 0, ttl: 0.9, rise: 1.6 };
  }
  ageAll(dt) {
    for (const f of this.floats)
      f.age += dt;
    for (const f of this.flashes)
      f.age += dt;
    for (const p of this.particles)
      p.age += dt;
    if (this.banner)
      this.banner.age += dt;
    this.floats = this.floats.filter((f) => f.age < f.ttl);
    this.flashes = this.flashes.filter((f) => f.age < f.ttl);
    this.particles = this.particles.filter((p) => p.age < p.ttl);
    if (this.banner && this.banner.age >= this.banner.ttl)
      this.banner = null;
  }
  poof(tx, ty) {
    const colors = ["#cbbfa4", "#a89a80", "#e6dcc2"];
    for (let i = 0;i < 9; i++) {
      const a = i / 9 * Math.PI * 2;
      this.particles.push({
        tx: tx + 0.5,
        ty: ty + 0.5,
        vx: Math.cos(a) * 1.4,
        vy: Math.sin(a) * 1.4 - 1.2,
        age: 0,
        ttl: 0.45 + i % 3 * 0.12,
        color: colors[i % colors.length],
        size: 7 + i % 3 * 3
      });
    }
  }
  sparkle(tx, ty) {
    for (let i = 0;i < 8; i++) {
      this.particles.push({
        tx: tx + 0.5 + i % 4 * 0.12 - 0.18,
        ty: ty + 0.6,
        vx: 0,
        vy: -2.2 - i % 3 * 0.5,
        age: -i * 0.03,
        ttl: 0.7,
        color: i % 2 ? "#ffe9a8" : "#ffffff",
        size: 5
      });
    }
  }
  burst(tx, ty, color, n) {
    for (let i = 0;i < n; i++) {
      const a = i / n * Math.PI * 2;
      this.particles.push({
        tx: tx + 0.5,
        ty: ty + 0.5,
        vx: Math.cos(a) * 2.6,
        vy: Math.sin(a) * 2.6,
        age: 0,
        ttl: 0.6,
        color,
        size: 6
      });
    }
  }
  ring(tx, ty, color) {
    for (let i = 0;i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      this.particles.push({
        tx: tx + 0.5,
        ty: ty + 0.5,
        vx: Math.cos(a) * 3.2,
        vy: Math.sin(a) * 3.2,
        age: 0,
        ttl: 0.5,
        color,
        size: 6
      });
    }
  }
}

// src/ui/ui.ts
var HERO_MS = 110;

class UiManager {
  canvas;
  ctx;
  renderer;
  input = new InputHandler;
  hud = new Hud;
  inventory = new InventoryPanel;
  shop = new ShopPanel;
  dialogs = new Dialogs;
  minimap = new Minimap;
  screens = new Screens;
  effects = new Effects;
  game = null;
  throwMode = null;
  kills = 0;
  lastHeroAct = 0;
  view = { w: 390, h: 700 };
  constructor(canvas) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx)
      throw new Error("UiManager: 2d context unavailable");
    this.ctx = ctx;
    this.renderer = new Renderer(canvas);
    this.input.onToggleMinimap = () => {
      if (this.screens.state === "playing")
        this.minimap.toggle();
    };
    this.input.onToggleInventory = () => {
      if (this.screens.state === "playing")
        this.inventory.toggle();
    };
    this.inventory.onThrowRequest = (item) => {
      this.throwMode = { slot: item.slot };
      this.inventory.close();
    };
    this.effects.onMobDeath = () => {
      this.kills++;
    };
    uiBridge.current = { openShop: (mode) => this.openShop(mode) };
    this.screens.onStartRun = (seed) => this.startRun(seed);
    this.screens.onContinue = () => this.continueRun();
    this.screens.onQuitToTitle = () => this.quitToTitle(true);
    this.screens.onAbandonRun = () => this.quitToTitle(false);
    this.screens.hasSave = () => hasSave();
    this.screens.getSummary = () => this.deathSummary();
    window.addEventListener("keydown", (e) => this.handleKeyCapture(e), true);
    window.addEventListener("pointerdown", (e) => this.handleTapCapture(e), true);
    window.addEventListener("resize", () => this.renderer.resize());
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (this.game && !this.game.gameOver) {
          saveGame(this.game, contentMechanics);
          this.game.logMsg("Game saved.");
        }
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && this.game && !this.game.gameOver) {
        saveGame(this.game, contentMechanics);
      }
    });
  }
  boot(defaultSeed) {
    if (defaultSeed !== undefined && defaultSeed !== "")
      this.screens.seedText = defaultSeed;
    const frame = (t) => {
      this.tick(t);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  openShop(mode = "buy") {
    if (this.screens.state === "playing" && this.game && !this.game.gameOver) {
      this.shop.openShop(mode);
    }
  }
  get shopOpen() {
    return this.shop.open;
  }
  startRun(seed) {
    clearSave();
    this.kills = 0;
    this.game = new Game(seed >>> 0, { gen: contentLevelGen, mechanics: contentMechanics });
    this.input.attach(this.canvas, (sx, sy) => this.renderer.screenToTile(sx, sy), this.game);
    this.hud.logBuffer.reset();
    this.effects.reset();
    this.inventory.close();
    this.shop.close();
    this.minimap.open = false;
    this.throwMode = null;
    this.screens.show("playing");
  }
  continueRun() {
    const g = loadGame(contentMechanics);
    if (!g)
      return;
    this.kills = 0;
    this.game = g;
    this.input.attach(this.canvas, (sx, sy) => this.renderer.screenToTile(sx, sy), g);
    this.hud.logBuffer.reset();
    this.hud.logBuffer.sync(g.log);
    this.effects.reset();
    this.inventory.close();
    this.shop.close();
    this.minimap.open = false;
    this.throwMode = null;
    this.screens.show("playing");
  }
  quitToTitle(save) {
    if (this.game && save && !this.game.gameOver)
      saveGame(this.game, contentMechanics);
    this.input.detach();
    this.game = null;
    this.inventory.close();
    this.shop.close();
    this.minimap.open = false;
    this.throwMode = null;
    this.screens.show("title");
  }
  deathSummary() {
    const g = this.game;
    if (!g)
      return null;
    const hv = readHeroView(g);
    return {
      cause: this.deathCause(g),
      depth: g.level.depth,
      turns: g.turnCount,
      lvl: hv.lvl,
      kills: this.kills,
      gold: hv.gold,
      seed: g.seed
    };
  }
  deathCause(g) {
    for (let i = g.log.length - 1;i >= Math.max(0, g.log.length - 20); i--) {
      const line = g.log[i];
      if (/killed by|slain|you died|to death\.\.\.|killed you\.\.\./i.test(line))
        return line;
    }
    return "The dungeon claims another.";
  }
  handleKeyCapture(e) {
    const st = this.screens.state;
    if (st !== "playing") {
      if (this.screens.handleKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (dialogOpen()) {
      if (this.dialogs.handleKey(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    const k = e.key;
    if (this.throwMode && (k === "Escape" || k.toLowerCase() === "p")) {
      this.throwMode = null;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (this.inventory.open) {
      if (k === "Escape" || k.toLowerCase() === "i") {
        this.inventory.close();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (k.toLowerCase() === "m")
        return;
      if (isGameKey(k)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (this.shop.open) {
      if (k === "Escape") {
        this.shop.close();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (isGameKey(k)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (k === "Escape" || k.toLowerCase() === "p") {
      this.screens.show("paused");
      e.preventDefault();
      e.stopPropagation();
    }
  }
  handleTapCapture(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const st = this.screens.state;
    if (st !== "playing") {
      if (this.screens.handleTap(x, y)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    const g = this.game;
    if (!g || g.gameOver)
      return;
    if (dialogOpen()) {
      if (this.dialogs.handleTap(x, y)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (this.inventory.open) {
      this.inventory.handleTap(x, y, g);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (this.shop.open) {
      this.shop.handleTap(x, y, g);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (this.throwMode) {
      const t = this.renderer.screenToTile(e.clientX, e.clientY);
      const mob = g.level.mobAt(t.x, t.y);
      if (mob) {
        const live = g.mobs.find((m) => m.id === mob.id);
        if (live)
          g.queueIntent({ kind: "throwItem", slot: this.throwMode.slot, targetId: live.id });
        else
          g.logMsg("Nothing to throw at.");
      } else {
        g.logMsg("Throw cancelled.");
      }
      this.throwMode = null;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const L = this.hud.layout(this.view);
    if (inRect(L.potionBtn, x, y)) {
      const potion = readInventory(g).find((i) => i.kind === "potion");
      if (potion)
        doItemAction(g, potion, "use");
      else
        g.logMsg("You have no potions.");
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (inRect(L.dartBtn, x, y)) {
      const darts = readInventory(g).find((i) => i.kind === "missile" && i.qty > 0);
      if (darts) {
        this.throwMode = { slot: darts.slot };
        g.logMsg("Tap a target to throw a dart.");
      } else {
        g.logMsg("You have no darts.");
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }
  tick(t) {
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    const g = this.game;
    if (g && this.screens.state === "playing" && !g.gameOver && !dialogOpen()) {
      let guard = 500;
      for (;; ) {
        const next = g.scheduler.peek();
        if (!next)
          break;
        const heroTurn = next === g.hero;
        if (heroTurn && t - this.lastHeroAct < HERO_MS)
          break;
        const r = g.pump();
        if (r !== "acted")
          break;
        if (heroTurn)
          this.lastHeroAct = t;
        if (--guard <= 0)
          break;
      }
      this.hud.logBuffer.sync(g.log);
      this.effects.watch(g, nowMs);
      if (g.gameOver)
        this.screens.show("dead");
    }
    const { ctx } = this;
    this.renderer.syncSize();
    this.view = this.renderer.viewSize();
    const dpr = this.renderer.pixelRatio();
    if (g) {
      this.renderer.render(g);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const toScreen = (tx, ty) => this.renderer.tileToScreen(tx, ty);
      this.effects.draw(ctx, g, toScreen, this.view, nowMs);
      this.hud.draw(ctx, g, this.renderer, this.view, { throwMode: this.throwMode !== null });
      this.minimap.draw(ctx, g, this.view, nowMs);
      this.inventory.draw(ctx, g, this.renderer, this.view);
      this.shop.draw(ctx, g, this.renderer, this.view);
      if (dialogOpen())
        this.dialogs.draw(ctx, this.renderer, this.view);
      if (this.throwMode)
        this.drawThrowHint(ctx);
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = UI.backdrop;
      ctx.fillRect(0, 0, this.view.w, this.view.h);
    }
    if (this.screens.state !== "playing") {
      this.screens.draw(ctx, this.renderer, this.view, nowMs);
    }
  }
  drawThrowHint(ctx) {
    const label = "Tap a target to throw · Esc cancels";
    ctx.font = "bold 13px system-ui, sans-serif";
    const w = ctx.measureText(label).width + 28;
    const r = { x: (this.view.w - w) / 2, y: 70, w, h: 34 };
    ctx.fillStyle = "rgba(10, 8, 14, 0.85)";
    ctx.strokeStyle = UI.gold;
    ctx.lineWidth = 2;
    roundRect(ctx, r, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = UI.gold;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
}
function isGameKey(k) {
  const l = k.toLowerCase();
  if (l.length === 1 && "wasdqezc .g<>".includes(l))
    return true;
  return k.startsWith("Arrow");
}

// src/main.ts
function defaultSeed() {
  const q = new URLSearchParams(location.search).get("seed");
  if (q === null || q === "")
    return;
  const n = Number(q);
  return Number.isFinite(n) && q.trim() !== "" ? `${n >>> 0}` : `${hashSeed(q)}`;
}
var canvas = document.getElementById("game");
var ui = new UiManager(canvas);
ui.boot(defaultSeed());
window.ui = ui;
