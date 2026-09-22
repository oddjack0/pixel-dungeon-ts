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
function paintWaterGrass(ctx, rooms, waterFill, grassFill) {
  const W = ctx.width;
  const H = ctx.height;
  const water = generatePatch(ctx.rng, waterFill ?? (ctx.feeling === "water" ? 0.6 : 0.45), 5, W, H);
  for (let i = 0;i < W * H; i++) {
    if (ctx.tiles[i] === 1 /* FLOOR */ && water[i])
      ctx.tiles[i] = 9 /* WATER */;
  }
  const grass = generatePatch(ctx.rng, grassFill ?? (ctx.feeling === "grass" ? 0.6 : 0.4), 4, W, H);
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
        if (ctx.rng.int(0, 12 - ctx.depth) === 0) {
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

// src/dungeon/generator.ts
function newRunState() {
  return { weakFloor: false, ghostSpawned: false, dewVialNeeded: true, scrollsOfUpgrade: 0 };
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
  const boss = depth === 5;
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
      if (depth + 1 !== 5)
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
  let ctx = null;
  let entranceCell = -1;
  let exitCell = -1;
  let secretDoors = 0;
  let trapAttempts = 0;
  let trapsPlaced = 0;
  const pitNeeded = depth > 1 && run.weakFloor;
  for (let attempt = 0;attempt < 200; attempt++) {
    const built = buildRooms(rng);
    if (!built)
      continue;
    const c = new PainterCtx(rng, W, H, depth, feelingName(feeling), boss, !boss && depth + 1 === 5);
    c.out.spawnQueue.push(...queue);
    if (boss) {
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
    } else {
      const plan = planConnections(rng, built, {
        exitMinSize: 4,
        exitType: 3 /* EXIT */,
        connectFirstPath: true,
        fillRandom: true
      });
      if (!plan)
        continue;
      const assign = assignRoomTypes(rng, built, depth, {
        prevWeakFloor: pitNeeded,
        nextIsBoss: depth + 1 === 5
      });
      run.weakFloor = assign.weakFloor;
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
      paintWaterGrass(c, built);
      decorateSewers(c, entranceRoom, entranceCell);
    }
    rooms = built;
    ctx = c;
    break;
  }
  if (!ctx || !entranceRoom || !exitRoom || entranceCell < 0 || exitCell < 0) {
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
    if (!run.ghostSpawned && depth > 1 && rng.int(0, 5 - depth) === 0) {
      let pos = -1;
      for (let t = 0;t < 50 && pos === -1; t++)
        pos = randomRespawnCell();
      if (pos !== -1) {
        occupied.add(pos);
        mobs.push({ pos, kind: "ghost" });
        run.ghostSpawned = true;
      }
    }
  }
  const items = [...ctx.out.items];
  if (!boss) {
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
    if (run.dewVialNeeded && rng.int(0, 4 - depth) === 0) {
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

// src/content/items.ts
var SHORT_SWORD = {
  id: "shortsword",
  name: "short sword",
  sprite: "shortsword",
  type: "weapon",
  stackable: false,
  desc: "It is indeed quite short, just a few inches longer than a dagger.",
  weapon: { name: "short sword", tier: 1, level: 0, min: 1, max: 12, str: 11, acu: 1, dly: 1, missile: false }
};
var DART = {
  id: "dart",
  name: "dart",
  sprite: "dart",
  type: "missile",
  stackable: true,
  desc: "These simple metal spikes are weighted to fly true and sting their prey with a flick of the wrist.",
  weapon: { name: "dart", tier: 1, level: 0, min: 1, max: 4, str: 10, acu: 1, dly: 1, missile: true }
};
var CLOTH_ARMOR = {
  id: "cloth_armor",
  name: "cloth armor",
  sprite: "armor_cloth",
  type: "armor",
  stackable: false,
  desc: "This lightweight armor offers basic protection.",
  armor: { name: "cloth armor", level: 0, str: 9, dr: 2 }
};
var POTION_HEALING = {
  id: "potion_healing",
  name: "potion of healing",
  sprite: "potion_red",
  type: "potion",
  stackable: true,
  desc: "An elixir that will instantly return you to full health and cure poison."
};
var POTION_STRENGTH = {
  id: "potion_strength",
  name: "potion of strength",
  sprite: "potion_strength",
  type: "potion",
  stackable: true,
  desc: "This powerful liquid will course through your muscles, permanently increasing your strength by one point."
};
var RATION = {
  id: "ration",
  name: "ration of food",
  sprite: "ration",
  type: "food",
  stackable: true,
  desc: "Nothing fancy here: dried meat, some biscuits - things like that.",
  energy: 260
};
var SCROLL = {
  id: "scroll",
  name: "scroll",
  sprite: "scroll",
  type: "scroll",
  stackable: true,
  desc: "A scroll covered in indecipherable runes."
};
var SCROLL_UPGRADE = {
  id: "scroll_upgrade",
  name: "Scroll of Upgrade",
  sprite: "scroll_upgrade",
  type: "scroll",
  stackable: true,
  desc: "This scroll will upgrade a single item, improving its quality. A weapon will inflict more damage; a suit of armor will deflect additional blows. Weapons and armor will also require less strength to use."
};
var GOLD = {
  id: "gold",
  name: "gold",
  sprite: "gold",
  type: "gold",
  stackable: true,
  desc: "Collect gold coins to spend them later in a shop."
};
var IRON_KEY = {
  id: "iron_key",
  name: "iron key",
  sprite: "key_iron",
  type: "key",
  stackable: true,
  desc: "The notches on this ancient iron key are well worn."
};
var SKELETON_KEY = {
  id: "skeleton_key",
  name: "skeleton key",
  sprite: "key_skeleton",
  type: "key",
  stackable: true,
  desc: "A key carved from bone. It must open the way down."
};
var GOLDEN_KEY = {
  id: "golden_key",
  name: "golden key",
  sprite: "key_gold",
  type: "key",
  stackable: true,
  desc: "The notches on this golden key are tiny and intricate. Maybe it can open some chest lock?"
};
var DEWDROP = {
  id: "dewdrop",
  name: "dewdrop",
  sprite: "dewdrop",
  type: "dewdrop",
  stackable: true,
  desc: "A crystal clear dewdrop."
};
var SEED = {
  id: "seed",
  name: "seed",
  sprite: "seed",
  type: "seed",
  stackable: true,
  desc: "A strange seed. Perhaps it can be planted."
};
var ITEMS = {
  shortsword: SHORT_SWORD,
  dart: DART,
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
  seed: SEED
};
function getItem(id) {
  const { defId } = parseItemId(id);
  const def = ITEMS[defId];
  if (!def)
    throw new Error(`unknown item id: ${id}`);
  return def;
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
    { cls: "PotionOfExperience", prob: 4, m1: () => "potion_healing" },
    { cls: "PotionOfToxicGas", prob: 15, m1: () => "potion_healing" },
    { cls: "PotionOfParalyticGas", prob: 10, m1: () => "potion_healing" },
    { cls: "PotionOfLiquidFlame", prob: 15, m1: () => "potion_healing" },
    { cls: "PotionOfLevitation", prob: 10, m1: () => "potion_healing" },
    { cls: "PotionOfStrength", prob: 0, m1: () => "potion_strength" },
    { cls: "PotionOfMindVision", prob: 20, m1: () => "potion_healing" },
    { cls: "PotionOfPurity", prob: 12, m1: () => "potion_healing" },
    { cls: "PotionOfInvisibility", prob: 10, m1: () => "potion_healing" },
    { cls: "PotionOfMight", prob: 0, m1: () => "potion_healing" },
    { cls: "PotionOfFrost", prob: 10, m1: () => "potion_healing" }
  ],
  scroll: [
    { cls: "ScrollOfIdentify", prob: 30, m1: () => "scroll" },
    { cls: "ScrollOfTeleportation", prob: 10, m1: () => "scroll" },
    { cls: "ScrollOfRemoveCurse", prob: 15, m1: () => "scroll" },
    { cls: "ScrollOfRecharging", prob: 10, m1: () => "scroll" },
    { cls: "ScrollOfMagicMapping", prob: 15, m1: () => "scroll" },
    { cls: "ScrollOfChallenge", prob: 12, m1: () => "scroll" },
    { cls: "ScrollOfTerror", prob: 8, m1: () => "scroll" },
    { cls: "ScrollOfLullaby", prob: 8, m1: () => "scroll" },
    { cls: "ScrollOfPsionicBlast", prob: 4, m1: () => "scroll" },
    { cls: "ScrollOfMirrorImage", prob: 6, m1: () => "scroll" },
    { cls: "ScrollOfUpgrade", prob: 0, m1: () => "scroll_upgrade" },
    { cls: "ScrollOfEnchantment", prob: 1, m1: () => "scroll" }
  ],
  wand: [
    { cls: "WandOfTeleportation", prob: 10, m1: () => "scroll" },
    { cls: "WandOfSlowness", prob: 10, m1: () => "scroll" },
    { cls: "WandOfFirebolt", prob: 15, m1: () => "scroll" },
    { cls: "WandOfRegrowth", prob: 6, m1: () => "scroll" },
    { cls: "WandOfPoison", prob: 10, m1: () => "scroll" },
    { cls: "WandOfBlink", prob: 11, m1: () => "scroll" },
    { cls: "WandOfLightning", prob: 15, m1: () => "scroll" },
    { cls: "WandOfAmok", prob: 10, m1: () => "scroll" },
    { cls: "WandOfReach", prob: 6, m1: () => "scroll" },
    { cls: "WandOfFlock", prob: 10, m1: () => "scroll" },
    { cls: "WandOfMagicMissile", prob: 0, m1: () => "scroll" },
    { cls: "WandOfDisintegration", prob: 5, m1: () => "scroll" },
    { cls: "WandOfAvalanche", prob: 5, m1: () => "scroll" }
  ],
  ring: [
    { cls: "RingOfMending", prob: 1, m1: () => "scroll" },
    { cls: "RingOfDetection", prob: 1, m1: () => "scroll" },
    { cls: "RingOfShadows", prob: 1, m1: () => "scroll" },
    { cls: "RingOfPower", prob: 1, m1: () => "scroll" },
    { cls: "RingOfHerbalism", prob: 1, m1: () => "scroll" },
    { cls: "RingOfAccuracy", prob: 1, m1: () => "scroll" },
    { cls: "RingOfEvasion", prob: 1, m1: () => "scroll" },
    { cls: "RingOfSatiety", prob: 1, m1: () => "scroll" },
    { cls: "RingOfHaste", prob: 1, m1: () => "scroll" },
    { cls: "RingOfElements", prob: 1, m1: () => "scroll" },
    { cls: "RingOfHaggler", prob: 0, m1: () => "scroll" },
    { cls: "RingOfThorns", prob: 0, m1: () => "scroll" }
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
    { cls: "Honeypot", prob: 1, m1: () => "potion_healing" }
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

// src/mechanics/hero.ts
var DART2 = {
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
  const wep = opts.ranged ? hero.rangedWeapon ?? DART2 : hero.weapon;
  if (wep) {
    return Math.floor(hero.attackSkill * accuracy * accuracyFactor(wep, strEff(hero)));
  }
  return Math.floor(hero.attackSkill * accuracy);
}
function heroDefenseSkill(hero) {
  const evasion = hero.paralysed ? 1 / 2 : 1;
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
  const wep = opts.ranged ? hero.rangedWeapon ?? DART2 : hero.weapon;
  if (wep) {
    return weaponDamageRoll(rng, wep, { str: strEff(hero), ranged: opts.ranged });
  }
  const s = strEff(hero);
  return s > 10 ? rng.intRange(1, s - 9) : 1;
}
function upgradeWeapon(weapon) {
  weapon.level += 1;
}
function upgradeArmor(armor) {
  armor.str -= 1;
  armor.level += 1;
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
  goo: { exp: GOO_EXP, maxLvl: GOO_MAX_LVL }
};
function expForKill(mobId, heroLvl) {
  const m = MOB_EXP[mobId];
  if (!m)
    return 0;
  return heroLvl <= m.maxLvl ? m.exp : 0;
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
function addToInventory(hero, itemId, qty) {
  const def = getItem(itemId);
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
      hero.inventory.push({ itemId, qty: 1 });
    }
  }
  syncDarts(hero);
}
function removeFromInventory(hero, slot, qty = 1) {
  const stack = hero.inventory[slot];
  if (!stack || qty <= 0)
    return null;
  const take = Math.min(qty, stack.qty);
  const removed = { itemId: stack.itemId, qty: take };
  stack.qty -= take;
  if (stack.qty <= 0) {
    hero.inventory.splice(slot, 1);
  }
  syncDarts(hero);
  return removed;
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
    const hero = heroOf(ctx);
    const enemyInFOV = hero.isAlive() && this.canSee(ctx, hero.pos);
    switch (this.state) {
      case "sleeping":
        return this.actSleeping(ctx, hero.pos, enemyInFOV);
      case "wandering":
        return this.actWandering(ctx, hero.pos, enemyInFOV, justAlerted);
      case "hunting":
        return this.actHunting(ctx, hero, enemyInFOV);
      case "fleeing":
        return this.actFleeing(ctx, hero.pos, enemyInFOV);
      case "passive":
      default:
        this.enemySeen = false;
        return this.waitCost();
    }
  }
  onNotice(_ctx) {}
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
  canAttack(targetPos) {
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
    if (enemyInFOV && this.canAttack(hero.pos)) {
      return this.doAttack(ctx, hero);
    }
    if (enemyInFOV) {
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
    strikeMobVsHero(ctx, this, hero, this.def.atk, (rng) => this.mobDamageRoll(rng));
    return this.attackCost();
  }
}

class ThiefMob extends ContentMob {
  nowhereToRun(_ctx) {
    this.state = "hunting";
  }
}
function buildMob(mobId, id, pos, w) {
  if (mobId === "goo") {
    const ctor = gooCtor;
    if (!ctor)
      throw new Error("goo-boss not registered (import src/content/goo-boss.js)");
    return new ctor(id, pos, w);
  }
  const def = MOB_DEFS[mobId];
  if (!def)
    throw new Error(`unknown mob id: ${mobId}`);
  if (mobId === "thief")
    return new ThiefMob(id, def, pos, w);
  return new ContentMob(id, def, pos, w);
}
var gooCtor = null;
function registerGoo(ctor) {
  gooCtor = ctor;
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
  if (applied.died)
    killMob(ctx, mob, {});
}
function killMob(ctx, mob, _opts) {
  const hero = heroOf(ctx);
  const wasAlive = hero.isAlive();
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
    default:
      break;
  }
}
function strikeHeroVsMob(ctx, hero, mob, accuracy, damageRoll) {
  const rng = ctx.rng;
  const seq = runAttackSequence(rng, {
    accuracy,
    evasion: mob.mobDefenseSkill(),
    defenderDr: mob.def.dr,
    damageRoll,
    onDefenseProc: (_r, dmg) => mobDefenseProc(ctx, mob, dmg)
  });
  if (!seq.hit) {
    ctx.log(`You miss the ${mob.name}.`);
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
  if (applied.died)
    killMob(ctx, mob, {});
}
function strikeMobVsHero(ctx, mob, hero, accuracy, damageRoll, onAttackProc) {
  const rng = ctx.rng;
  const seq = runAttackSequence(rng, {
    accuracy,
    evasion: heroDefenseSkill(hero),
    defenderDr: heroDR(hero),
    damageRoll,
    onAttackProc
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
}

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
function resolveMobSpawns(rng, depth, spawns) {
  const out = [];
  for (const s of spawns) {
    if (s.kind === "mob") {
      out.push({ pos: s.pos, mobId: pickMobId(rng, depth) });
    } else if (s.kind === "boss") {
      out.push({ pos: s.pos, mobId: "goo" });
    }
  }
  return out;
}
function buildMobs(resolved, w) {
  return resolved.map((r) => buildMob(r.mobId, nextMobId(), r.pos, w));
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
    return {
      pos: s.pos,
      itemId,
      sprite: getItem(defId).sprite,
      ...lockedChest ? { lockedChest: true } : {}
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
  generate(rng, depth) {
    resetItemGenerator();
    const result = generateLevel(rng, depth, newRunState());
    const items = resolveItemSpawns(rng, depth, result.items);
    for (const it of items)
      result.level.items.push(it);
    stashGenResult(result.level, result);
    return result.level;
  }
};

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
function createBlob(kind, length) {
  switch (kind) {
    case "fire":
      return new FireBlob(length);
    case "toxic":
      return new ToxicGasBlob(length);
    case "paralytic":
      return new ParalyticGasBlob(length);
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
  }
}
function beckonMob(mob, cell) {
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
      ch.buffs.burning = { kind: "burning", left: BURNING_DURATION };
    },
    prolongParalysis: (ch, duration) => {
      const cur = ch.buffs.paralysis?.left ?? 0;
      ch.buffs.paralysis = { kind: "paralysis", left: Math.max(cur, duration) };
      ch.paralysed = true;
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
  let chances2;
  let ids;
  switch (depth) {
    case 1:
      chances2 = [1];
      ids = ["rat"];
      break;
    case 2:
      chances2 = [1, 1];
      ids = ["rat", "gnoll"];
      break;
    case 3:
      chances2 = [1, 2, 1, 0.02];
      ids = ["rat", "gnoll", "crab", "swarm"];
      break;
    case 4:
      chances2 = [1, 2, 3, 0.02, 0.01, 0.01];
      ids = ["rat", "gnoll", "crab", "swarm", "skeleton", "thief"];
      break;
    default:
      return null;
  }
  let sum = 0;
  for (const c of chances2)
    sum += Math.max(0, c);
  if (sum <= 0)
    return null;
  const value = rng.float(0, sum);
  sum = 0;
  for (let i = 0;i < chances2.length; i++) {
    sum += Math.max(0, chances2[i]);
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
  const def = getItem(defId);
  if (def.type === "gold") {
    hero.gold += qty;
    ctx.log(`You pick up ${qty} gold.`);
  } else {
    addToInventory(hero, defId, qty);
    const label = qty > 1 ? `${qty}x ${def.name}` : def.name;
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
  const def = getItem(stack.itemId);
  switch (def.type) {
    case "potion":
      return drinkPotion(ctx, hero, slot, stack);
    case "food":
      return eatFood(ctx, hero, slot, stack);
    case "scroll":
      return readScroll(ctx, hero, slot, stack);
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
  }
}
function drinkPotion(ctx, hero, slot, stack) {
  const def = getItem(stack.itemId);
  removeFromInventory(hero, slot, 1);
  switch (stack.itemId) {
    case "potion_healing":
      hero.hp = hero.ht;
      delete hero.buffs.poison;
      ctx.log("Your wounds heal completely.");
      break;
    case "potion_strength":
      hero.str += 1;
      ctx.log("Newfound strength surges through your body.");
      break;
    default:
      ctx.log(`You drink the ${def.name}. Nothing happens.`);
      break;
  }
  return 1;
}
function readScroll(ctx, hero, slot, stack) {
  switch (stack.itemId) {
    case "scroll_upgrade": {
      const weapon = hero.weapon;
      const armor = hero.armor;
      if (!weapon && !armor) {
        ctx.log("You have nothing to upgrade.");
        return 1;
      }
      removeFromInventory(hero, slot, 1);
      if (weapon) {
        upgradeWeapon(weapon);
        ctx.log(`your ${gearDisplayName(weapon)} certainly looks better now`);
      } else {
        upgradeArmor(armor);
        ctx.log(`your ${gearDisplayName(armor)} certainly looks better now`);
      }
      return 1;
    }
    default:
      ctx.log("You cannot read that yet.");
      return 1;
  }
}
function eatFood(ctx, hero, slot, stack) {
  const def = getItem(stack.itemId);
  removeFromInventory(hero, slot, 1);
  hero.hungerLevel = satisfy(hero.hungerLevel, def.energy ?? 260);
  if (hero.hp < hero.ht) {
    hero.hp = Math.min(hero.hp + 5, hero.ht);
  }
  ctx.log("That food tasted delicious!");
  return 3;
}
function equipWeaponFromInventory(ctx, hero, slot, stack) {
  const def = getItem(stack.itemId);
  if (!def.weapon) {
    ctx.log("You can't wield that.");
    return 1;
  }
  const oldId = hero.weaponId;
  hero.weapon = { ...def.weapon };
  hero.weaponId = def.id;
  removeFromInventory(hero, slot, 1);
  if (oldId)
    addToInventory(hero, oldId, 1);
  ctx.log(`You equip the ${def.name}.`);
  return 1;
}
function equipArmorFromInventory(ctx, hero, slot, stack) {
  const def = getItem(stack.itemId);
  if (!def.armor) {
    ctx.log("You can't wear that.");
    return 1;
  }
  const oldId = hero.armorId;
  hero.armor = { ...def.armor };
  hero.armorId = def.id;
  removeFromInventory(hero, slot, 1);
  if (oldId)
    addToInventory(hero, oldId, 1);
  ctx.log(`You equip the ${def.name}.`);
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
    const def2 = getItem(hero.weaponId);
    addToInventory(hero, hero.weaponId, 1);
    hero.weapon = null;
    hero.weaponId = null;
    ctx.log(`You unwield the ${def2.name}.`);
    return 1;
  }
  if (slot === -2) {
    if (!hero.armorId) {
      ctx.log("You wear nothing.");
      return 1;
    }
    const def2 = getItem(hero.armorId);
    addToInventory(hero, hero.armorId, 1);
    hero.armor = null;
    hero.armorId = null;
    ctx.log(`You take off the ${def2.name}.`);
    return 1;
  }
  const stack = hero.inventory[slot];
  if (!stack) {
    ctx.log("Nothing in that slot.");
    return 1;
  }
  const def = getItem(stack.itemId);
  if (def.type === "weapon")
    return equipWeaponFromInventory(ctx, hero, slot, stack);
  if (def.type === "armor")
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
    if (slot === -1) {
      hero.weapon = null;
      hero.weaponId = null;
    } else {
      hero.armor = null;
      hero.armorId = null;
    }
    const def2 = getItem(equippedId);
    ctx.level.items.push({
      pos: hero.pos,
      itemId: equippedId,
      sprite: def2.sprite
    });
    ctx.log(`You drop the ${def2.name}.`);
    return 0.5;
  }
  const stack = hero.inventory[slot];
  if (!stack) {
    ctx.log("Nothing in that slot.");
    return 1;
  }
  const removed = removeFromInventory(hero, slot, stack.qty);
  const def = getItem(removed.itemId);
  ctx.level.items.push({
    pos: hero.pos,
    itemId: removed.itemId,
    sprite: def.sprite
  });
  ctx.log(`You drop the ${def.name}.`);
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
  const def = getItem(defId);
  const label = qty > 1 ? `${qty}x ${def.name}` : def.name;
  if (def.type === "gold") {
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
  switch (item.kind) {
    case "weapon":
    case "armor":
      return item.equipped ? ["equip", "drop"] : ["equip", "drop"];
    case "missile":
      return ["throw", "drop"];
    case "potion":
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
  canAttack(targetPos) {
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

// src/content/hooks.ts
function catalogKind(def) {
  switch (def.type) {
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
      return "misc";
  }
}
function contentInventoryAdapter(game) {
  const hero = game.hero;
  const items = hero.inventory.map((s, slot) => {
    const def = getItem(s.itemId);
    return {
      slot,
      id: s.itemId,
      name: def.name,
      sprite: def.sprite,
      qty: s.qty,
      kind: catalogKind(def),
      equipped: false,
      identified: true
    };
  });
  if (hero.weaponId) {
    const def = getItem(hero.weaponId);
    items.push({
      slot: -1,
      id: hero.weaponId,
      name: def.name,
      sprite: def.sprite,
      qty: 1,
      kind: "weapon",
      equipped: true,
      identified: true
    });
  }
  if (hero.armorId) {
    const def = getItem(hero.armorId);
    items.push({
      slot: -2,
      id: hero.armorId,
      name: def.name,
      sprite: def.sprite,
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
    inventory: hero.inventory.map((s) => ({ ...s })),
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
    const wdef = getItem(save.weaponId).weapon;
    hero.weapon = wdef ? { ...wdef } : null;
  }
  if (save.armorId) {
    const adef = getItem(save.armorId).armor;
    hero.armor = adef ? { ...adef } : null;
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
  mob.buffs = { ...save.buffs };
  mob.paralysed = save.paralysed;
  return mob;
}
var contentMechanics = {
  spawnHero(_rng, level) {
    return createStarterHero(level.stairsUp, level.w);
  },
  spawnMobs(rng, level) {
    const result = takeGenResult(level);
    if (!result)
      return [];
    noteSignCells(level, result.markers.signs);
    const resolved = resolveMobSpawns(rng, result.level.depth, result.mobs);
    return buildMobs(resolved, result.level.w);
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
        cost = throwDart(ctx, hero, intent.slot, target.y * ctx.level.w + target.x);
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
    hostile: m.hostile
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
    this.level = deps.gen.generate(this.rng, 1);
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
        if (live)
          return { kind: "attack", targetId: live.id };
        return null;
      }
      return { kind: "move", dx, dy };
    }
    return null;
  }
  afterAction() {
    this.level.updateFov(this.hero.x, this.hero.y, this.hero.sight);
    this.syncMobs();
    if (this.path.length > 0 && this.mobs.some((m) => m.hostile && this.level.visible[this.level.idx(m.x, m.y)])) {
      this.path = [];
      this.logMsg("You stop: danger ahead.");
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
    this.level = this.deps.gen.generate(this.rng, depth);
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
    this.updateCamera(game, vw, vh);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, vw, vh);
    const x0 = Math.max(0, Math.floor(this.camX));
    const y0 = Math.max(0, Math.floor(this.camY));
    const x1 = Math.min(level.w - 1, Math.ceil(this.camX + vw / TILE_PX));
    const y1 = Math.min(level.h - 1, Math.ceil(this.camY + vh / TILE_PX));
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
  updateCamera(game, vw, vh) {
    const viewTilesW = vw / TILE_PX;
    const viewTilesH = vh / TILE_PX;
    this.camX = game.hero.x + 0.5 - viewTilesW / 2;
    this.camY = game.hero.y + 0.5 - viewTilesH / 2;
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
      if (live)
        game.queueIntent({ kind: "attack", targetId: live.id });
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
      bossLevel: lvl.bossLevel
    },
    hero: mechanics.saveHero(game.hero),
    mobs: game.mobs.map((m) => mechanics.saveMob(m))
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
  const rng = RNG.restore(data.seed, data.rngState);
  const game = new Game(data.seed, {
    gen: { generate: () => lvl },
    mechanics
  });
  game.rng = rng;
  game.turnCount = data.turnCount;
  game.gameOver = data.gameOver;
  game.log = [...data.log];
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
  startRun(seed) {
    clearSave();
    this.kills = 0;
    this.game = new Game(seed >>> 0, { gen: contentLevelGen, mechanics: contentMechanics });
    this.input.attach(this.canvas, (sx, sy) => this.renderer.screenToTile(sx, sy), this.game);
    this.hud.logBuffer.reset();
    this.effects.reset();
    this.inventory.close();
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
    if (this.inventory.open) {
      this.inventory.handleTap(x, y, g);
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
    if (g && this.screens.state === "playing" && !g.gameOver) {
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
