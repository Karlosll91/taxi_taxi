/**
 * Road network of the stylised El Poblado map.
 * Axes: +x is east (uphill), +z is south. Units are metres.
 */

export interface RoadDef {
  name: string;
  pts: [number, number][];
  width: number;
  lanes: 2 | 4;
}

export interface Inter {
  s: number;
  road: number;
  os: number;
}

export interface Road {
  id: number;
  name: string;
  hw: number;
  lanes: 2 | 4;
  n: number;
  step: number;
  len: number;
  px: Float32Array;
  pz: Float32Array;
  tx: Float32Array;
  tz: Float32Array;
  inter: Inter[];
  def: RoadDef;
}

export const SIDEWALK = 3;
const STEP = 4;
const CELL = 50;

const ns = (name: string, x: number, z0: number, z1: number, width = 8, lanes: 2 | 4 = 2, wig = 0): RoadDef => {
  const pts: [number, number][] = [];
  const n = wig ? 7 : 1;
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    pts.push([x + wig * Math.sin(z / 260 + x), z]);
  }
  return { name, pts, width, lanes };
};
const ew = (name: string, z: number, x0: number, x1: number, width = 8, lanes: 2 | 4 = 2): RoadDef => ({
  name,
  pts: [
    [x0, z],
    [x1, z],
  ],
  width,
  lanes,
});

export const ROAD_DEFS: RoadDef[] = [
  ns('Avenida Regional', -820, -900, 900, 16, 4),
  ns('Avenida Las Vegas', -560, -900, 900, 16, 4, 12),
  ns('Carrera 46', -400, -620, 400, 9),
  ns('Avenida El Poblado', -240, -900, 900, 16, 4),
  ns('Carrera 42', -110, -620, 560, 8),
  ns('Carrera 40', 10, -450, 230, 8),
  ns('Carrera 38', 130, -620, 400, 8),
  ns('Carrera 36', 260, -450, 230, 8),
  ns('Carrera 35', 380, -620, 560, 9),
  {
    name: 'Transversal Inferior',
    pts: [[520, -900], [560, -620], [530, -450], [545, -320], [520, -200], [550, -80], [535, 50], [540, 230], [560, 400], [530, 560], [545, 720], [540, 900]],
    width: 11,
    lanes: 2,
  },
  {
    name: 'Transversal Superior',
    pts: [[760, -900], [800, -620], [770, -300], [810, -60], [780, 260], [800, 400], [770, 640], [800, 900]],
    width: 11,
    lanes: 2,
  },
  ew('Calle 16', -760, -820, 540, 9),
  ew('Calle 12', -620, -820, 380, 9),
  ew('Calle 11', -450, -560, 540, 8),
  { name: 'Calle 10', pts: [[-820, -320], [-240, -320], [380, -320], [545, -320], [660, -350], [770, -300]], width: 14, lanes: 4 },
  ew('Calle 9', -200, -400, 540, 8),
  ew('Calle 8', -80, -240, 540, 8),
  ew('Calle 7', 50, -560, 380, 8),
  ew('Calle 5', 230, -820, 540, 9),
  { name: 'Calle 2', pts: [[-560, 400], [380, 400], [560, 400], [680, 425], [800, 400]], width: 9, lanes: 2 },
  ew('Calle 2 Sur', 560, -240, 540, 8),
  ew('Calle 5 Sur', 720, -820, 545, 10),
  { name: 'Loma de Los Balsos', pts: [[-240, 850], [0, 835], [250, 860], [545, 800], [690, 720], [790, 660]], width: 10, lanes: 2 },
  { name: 'Vía Las Palmas', pts: [[380, -620], [545, -690], [680, -790], [790, -850], [900, -880]], width: 12, lanes: 2 },
  { name: 'Loma El Tesoro', pts: [[540, 230], [650, 180], [780, 260]], width: 10, lanes: 2 },
];

export const roads: Road[] = [];
const hash = new Map<number, number[]>();
const key = (ix: number, iz: number) => (ix + 512) * 2048 + (iz + 512);

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function buildRoad(id: number, def: RoadDef): Road {
  const P = def.pts;
  const dense: [number, number][] = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[Math.max(0, i - 1)];
    const b = P[i];
    const c = P[i + 1];
    const d = P[Math.min(P.length - 1, i + 2)];
    const segLen = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const m = Math.max(2, Math.ceil(segLen / 2));
    for (let j = 0; j < m; j++) {
      const t = j / m;
      dense.push(P.length === 2 ? [b[0] + (c[0] - b[0]) * t, b[1] + (c[1] - b[1]) * t] : [catmull(a[0], b[0], c[0], d[0], t), catmull(a[1], b[1], c[1], d[1], t)]);
    }
  }
  dense.push(P[P.length - 1]);
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const len = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(len / STEP) + 1);
  const step = len / (n - 1);
  const px = new Float32Array(n);
  const pz = new Float32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(len, i * step);
    while (k < cum.length - 2 && cum[k + 1] < s) k++;
    const t = cum[k + 1] > cum[k] ? (s - cum[k]) / (cum[k + 1] - cum[k]) : 0;
    px[i] = dense[k][0] + (dense[k + 1][0] - dense[k][0]) * t;
    pz[i] = dense[k][1] + (dense[k + 1][1] - dense[k][1]) * t;
  }
  const tx = new Float32Array(n);
  const tz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dx = px[b] - px[a];
    const dz = pz[b] - pz[a];
    const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l;
    tz[i] = dz / l;
  }
  return { id, name: def.name, hw: def.width / 2, lanes: def.lanes, n, step, len, px, pz, tx, tz, inter: [], def };
}

export interface RoadPoint {
  x: number;
  z: number;
  tx: number;
  tz: number;
}

export function pointAt(r: Road, s: number, out: RoadPoint): RoadPoint {
  const f = Math.min(Math.max(s, 0), r.len) / r.step;
  const i = Math.min(Math.floor(f), r.n - 2);
  const t = f - i;
  out.x = r.px[i] + (r.px[i + 1] - r.px[i]) * t;
  out.z = r.pz[i] + (r.pz[i + 1] - r.pz[i]) * t;
  out.tx = r.tx[i] + (r.tx[i + 1] - r.tx[i]) * t;
  out.tz = r.tz[i] + (r.tz[i + 1] - r.tz[i]) * t;
  return out;
}

/** Point at distance s along the road, shifted `lat` metres to the right of travel. */
export function offsetPoint(r: Road, s: number, lat: number, out: RoadPoint): RoadPoint {
  pointAt(r, s, out);
  const l = Math.hypot(out.tx, out.tz) || 1;
  out.tx /= l;
  out.tz /= l;
  out.x += -out.tz * lat;
  out.z += out.tx * lat;
  return out;
}

export interface Nearest {
  road: number;
  s: number;
  dist: number;
  lat: number;
}

const near: Nearest = { road: -1, s: 0, dist: Infinity, lat: 0 };

function segDist(r: Road, i: number, x: number, z: number): number {
  const ax = r.px[i];
  const az = r.pz[i];
  const bx = r.px[i + 1] - ax;
  const bz = r.pz[i + 1] - az;
  const l2 = bx * bx + bz * bz;
  let t = l2 > 0 ? ((x - ax) * bx + (z - az) * bz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  segT = t;
  return Math.hypot(x - ax - bx * t, z - az - bz * t);
}
let segT = 0;

/** Nearest road centre line within about 50 m. The returned object is reused between calls. */
export function nearestRoad(x: number, z: number, exclude = -1): Nearest {
  near.road = -1;
  near.dist = Infinity;
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const list = hash.get(key(ix, iz));
      if (!list) continue;
      for (let k = 0; k < list.length; k += 2) {
        const rid = list[k];
        if (rid === exclude) continue;
        const r = roads[rid];
        const i = list[k + 1];
        const d = segDist(r, i, x, z);
        if (d < near.dist) {
          near.dist = d;
          near.road = rid;
          near.s = (i + segT) * r.step;
          const ax = r.px[i] + (r.px[i + 1] - r.px[i]) * segT;
          const az = r.pz[i] + (r.pz[i + 1] - r.pz[i]) * segT;
          near.lat = (x - ax) * -r.tz[i] + (z - az) * r.tx[i];
        }
      }
    }
  }
  return near;
}

/** True when the point is at least `clear` metres outside the asphalt of every road except `exclude`. */
export function clearOfRoads(x: number, z: number, exclude: number, clear: number): boolean {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const list = hash.get(key(ix, iz));
      if (!list) continue;
      for (let k = 0; k < list.length; k += 2) {
        const rid = list[k];
        if (rid === exclude) continue;
        const r = roads[rid];
        if (segDist(r, list[k + 1], x, z) < r.hw + clear) return false;
      }
    }
  }
  return true;
}

function nearestBrute(x: number, z: number, exclude: number): { road: number; x: number; z: number; dist: number } {
  const best = { road: -1, x: 0, z: 0, dist: Infinity };
  for (const r of roads) {
    if (r.id === exclude) continue;
    for (let i = 0; i < r.n - 1; i++) {
      const d = segDist(r, i, x, z);
      if (d < best.dist) {
        best.dist = d;
        best.road = r.id;
        best.x = r.px[i] + (r.px[i + 1] - r.px[i]) * segT;
        best.z = r.pz[i] + (r.pz[i + 1] - r.pz[i]) * segT;
      }
    }
  }
  return best;
}

function addInter(a: Road, sa: number, b: Road, sb: number) {
  if (a.inter.some((i) => i.road === b.id && Math.abs(i.s - sa) < 12)) return;
  a.inter.push({ s: sa, road: b.id, os: sb });
  b.inter.push({ s: sb, road: a.id, os: sa });
}

function build() {
  ROAD_DEFS.forEach((d, i) => roads.push(buildRoad(i, d)));
  // Snap loose road ends onto the road they meet so junctions are exact.
  for (let pass = 0; pass < 2; pass++) {
    for (const r of roads) {
      let changed = false;
      for (const end of [0, r.def.pts.length - 1]) {
        const p = r.def.pts[end];
        const nb = nearestBrute(p[0], p[1], r.id);
        if (nb.dist < 45 && nb.dist > 0.02) {
          r.def.pts[end] = [nb.x, nb.z];
          changed = true;
        }
      }
      if (changed) roads[r.id] = buildRoad(r.id, r.def);
    }
  }
  for (const r of roads) {
    for (let i = 0; i < r.n - 1; i++) {
      const k = key(Math.floor((r.px[i] + r.px[i + 1]) / 2 / CELL), Math.floor((r.pz[i] + r.pz[i + 1]) / 2 / CELL));
      let list = hash.get(k);
      if (!list) hash.set(k, (list = []));
      list.push(r.id, i);
    }
  }
  // Crossings.
  for (const a of roads) {
    for (let i = 0; i < a.n - 1; i++) {
      const ax = a.px[i];
      const az = a.pz[i];
      const adx = a.px[i + 1] - ax;
      const adz = a.pz[i + 1] - az;
      const cx = Math.floor((ax + adx / 2) / CELL);
      const cz = Math.floor((az + adz / 2) / CELL);
      for (let ix = cx - 1; ix <= cx + 1; ix++) {
        for (let iz = cz - 1; iz <= cz + 1; iz++) {
          const list = hash.get(key(ix, iz));
          if (!list) continue;
          for (let k = 0; k < list.length; k += 2) {
            if (list[k] <= a.id) continue;
            const b = roads[list[k]];
            const j = list[k + 1];
            const bx = b.px[j];
            const bz = b.pz[j];
            const bdx = b.px[j + 1] - bx;
            const bdz = b.pz[j + 1] - bz;
            const den = adx * bdz - adz * bdx;
            if (Math.abs(den) < 1e-6) continue;
            const t = ((bx - ax) * bdz - (bz - az) * bdx) / den;
            const u = ((bx - ax) * adz - (bz - az) * adx) / den;
            if (t < 0 || t > 1 || u < 0 || u > 1) continue;
            addInter(a, (i + t) * a.step, b, (j + u) * b.step);
          }
        }
      }
    }
  }
  // Ends that touch another road (T-junctions and corners).
  for (const a of roads) {
    for (const s of [0, a.len]) {
      const i = s === 0 ? 0 : a.n - 1;
      const nr = nearestRoad(a.px[i], a.pz[i], a.id);
      if (nr.road >= 0 && nr.dist < 1.5) addInter(a, s, roads[nr.road], nr.s);
    }
  }
  for (const r of roads) r.inter.sort((p, q) => p.s - q.s);
}

build();

/** Distance along the road to its closest junction. */
export function distToJunction(r: Road, s: number): number {
  let d = Infinity;
  for (const i of r.inter) d = Math.min(d, Math.abs(i.s - s));
  return d;
}

/** Human-readable address such as "Calle 9 con Carrera 38". */
export function addressOf(r: Road, s: number): string {
  let best: Inter | null = null;
  for (const i of r.inter) if (!best || Math.abs(i.s - s) < Math.abs(best.s - s)) best = i;
  return best ? `${r.name} con ${roads[best.road].name}` : r.name;
}
