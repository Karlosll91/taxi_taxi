import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { Colliders, Obb } from './collide';
import { Geo, V2, V3 } from './geo';
import { Road, RoadPoint, SIDEWALK, clearOfRoads, distToJunction, nearestRoad, offsetPoint, roads } from './roads';
import { BOUND, ROAD_Y, baseHeight, ramps } from './terrain';
import { FacadeTex, Textures, textSign } from './textures';

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Place {
  name: string;
  road: number;
  s: number;
  side: 1 | -1;
}

/** Paved squares, also drawn on the minimap. */
export const PARKS: Rect[] = [
  { x0: 17, x1: 123, z0: -310, z1: -207 },
  { x0: -229, x1: -117, z0: -310, z1: -207 },
];

/** Areas kept free of ordinary buildings because a landmark stands there. */
const RESERVED: Rect[] = [
  ...PARKS,
  { x0: -222, x1: -90, z0: 578, z1: 702 },
  { x0: 600, x1: 740, z0: 288, z1: 392 },
  { x0: -532, x1: -422, z0: 248, z1: 382 },
  { x0: -532, x1: -258, z0: 733, z1: 895 },
  { x0: -1000, x1: -834, z0: -1000, z1: 1000 },
];

const PLACE_ANCHORS: [string, number, number][] = [
  ['Parque Lleras', 70, -203],
  ['Parque de El Poblado', -233, -260],
  ['Iglesia de San José', -114, -258],
  ['Estación Poblado', -826, -285],
  ['Provenza', 385, -140],
  ['Milla de Oro', -233, 310],
  ['Centro Comercial Milla de Oro', -233, 640],
  ['Mall de la Loma', 670, 415],
  ['Clínica', -405, 315],
  ['Universidad', -400, 726],
  ['Mirador de Las Palmas', 735, -815],
  ['Loma de Los Balsos', 400, 838],
];

type Style = 'brick' | 'glass' | 'plaster' | 'office';

const P: RoadPoint = { x: 0, z: 0, tx: 0, tz: 0 };
const Q: RoadPoint = { x: 0, z: 0, tx: 0, tz: 0 };

/** Stretches of a road, at a sideways offset, that are not on another road's asphalt. */
function runs(r: Road, lat: number, clear: number): [number, number][] {
  const ok = (s: number) => {
    offsetPoint(r, s, lat, P);
    return clearOfRoads(P.x, P.z, r.id, clear);
  };
  const out: [number, number][] = [];
  let prevS = 0;
  let prevOk = ok(0);
  let start = prevOk ? 0 : -1;
  for (let s = 2; ; s += 2) {
    const ss = Math.min(s, r.len);
    const o = ok(ss);
    if (o !== prevOk) {
      let lo = prevS;
      let hi = ss;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        if (ok(mid) === prevOk) lo = mid;
        else hi = mid;
      }
      const b = (lo + hi) / 2;
      if (prevOk) out.push([start, b]);
      else start = b;
    }
    prevOk = o;
    prevS = ss;
    if (ss >= r.len) break;
  }
  if (prevOk) out.push([start, r.len]);
  return out;
}

const inRect = (x: number, z: number, r: Rect, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;

export interface City {
  group: THREE.Group;
  colliders: Colliders;
  places: Place[];
  /** Materials whose normal maps are switched off on the lowest quality level. */
  normalMapped: { mat: THREE.MeshStandardMaterial; normal: THREE.Texture }[];
  update(dt: number): void;
}

export function buildCity(tex: Textures): City {
  const group = new THREE.Group();
  const colliders = new Colliders();
  const rng = mulberry32(20240);
  const normalMapped: City['normalMapped'] = [];

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = false, receive = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.matrixAutoUpdate = false;
    group.add(m);
    return m;
  };

  // ---------------------------------------------------------------- terrain
  const grassMat = new THREE.MeshStandardMaterial({ map: tex.grass, vertexColors: true, roughness: 1, metalness: 0 });
  const terrainColor = (x: number, z: number): V3 => {
    const n = 0.86 + 0.14 * Math.sin(x / 37 + Math.sin(z / 53) * 2) * Math.sin(z / 41 + 1);
    if (Math.abs(x) > 1050 || Math.abs(z) > 1100) return [0.5 * n, 0.66 * n, 0.6 * n];
    return [n, n, 0.92 * n];
  };
  const grid = (min: number, max: number, cell: number, sink: (x: number, z: number) => number) => {
    const n = Math.round((max - min) / cell);
    const pos = new Float32Array((n + 1) * (n + 1) * 3);
    const col = new Float32Array((n + 1) * (n + 1) * 3);
    const uv = new Float32Array((n + 1) * (n + 1) * 2);
    const idx: number[] = [];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = min + i * cell;
        const z = min + j * cell;
        const k = j * (n + 1) + i;
        pos.set([x, baseHeight(x, z) - 0.1 - sink(x, z), z], k * 3);
        col.set(terrainColor(x, z), k * 3);
        uv.set([x / 14, z / 14], k * 2);
        if (i < n && j < n) idx.push(k, k + n + 1, k + 1, k + 1, k + n + 1, k + n + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  add(grid(-1000, 1000, 10, () => 0), grassMat);
  add(grid(-3000, 3000, 100, (x, z) => (Math.abs(x) < 999 && Math.abs(z) < 999 ? 8 : 0)), grassMat);
  {
    // Skirt hiding the seam between the fine and the coarse terrain.
    const g = new Geo();
    for (let t = -1000; t < 1000; t += 10) {
      for (const [ax, az, bx, bz] of [[t, -1000, t + 10, -1000], [t, 1000, t + 10, 1000], [-1000, t, -1000, t + 10], [1000, t, 1000, t + 10]]) {
        const ya = baseHeight(ax, az) - 0.1;
        const yb = baseHeight(bx, bz) - 0.1;
        const c = terrainColor(ax, az);
        const hint: V3 = [Math.sign(ax + bx), 0, Math.sign(az + bz)];
        if (Math.abs(ax) === 1000 && ax === bx) hint[2] = 0;
        else hint[0] = 0;
        g.quad([ax, ya, az], [bx, yb, bz], [bx, yb - 12, bz], [ax, ya - 12, az], [0, 0], [1, 0], [1, 1], [0, 1], hint, c);
      }
    }
    add(g.build(), grassMat);
  }
  {
    const river = new THREE.Mesh(new THREE.PlaneGeometry(90, 6000), new THREE.MeshStandardMaterial({ color: 0x5d5a40, roughness: 0.15, metalness: 0.3 }));
    river.rotation.x = -Math.PI / 2;
    river.position.set(-985, -4.3, 0);
    group.add(river);
  }

  // ---------------------------------------------------------------- roads
  const roadGeo = new Geo();
  const walkGeo = new Geo();
  const markGeo = new Geo();
  const UP: V3 = [0, 1, 0];
  const WHITE: V3 = [0.92, 0.92, 0.9];
  const YELLOW: V3 = [0.95, 0.72, 0.1];
  const ruv = (p: V3): V2 => [p[0] / 6, p[2] / 6];
  const wuv = (p: V3): V2 => [p[0] / 4, p[2] / 4];
  const at = (r: Road, s: number, lat: number, dy: number): V3 => {
    offsetPoint(r, s, lat, Q);
    return [Q.x, baseHeight(Q.x, Q.z) + dy, Q.z];
  };

  const strip = (r: Road, s0: number, s1: number, lat: number, w: number, color: V3) => {
    const m = Math.max(1, Math.ceil((s1 - s0) / 4));
    for (let i = 0; i < m; i++) {
      const a = s0 + ((s1 - s0) * i) / m;
      const b = s0 + ((s1 - s0) * (i + 1)) / m;
      markGeo.quad(at(r, a, lat - w / 2, ROAD_Y + 0.035), at(r, a, lat + w / 2, ROAD_Y + 0.035), at(r, b, lat + w / 2, ROAD_Y + 0.035), at(r, b, lat - w / 2, ROAD_Y + 0.035), [0, 0], [1, 0], [1, 1], [0, 1], UP, color);
    }
  };
  const line = (r: Road, lat: number, w: number, color: V3, dash: boolean) => {
    for (const [s0, s1] of runs(r, lat, 4.6)) {
      if (!dash) strip(r, s0, s1, lat, w, color);
      else for (let s = s0 + 2; s + 3 < s1; s += 8) strip(r, s, s + 3, lat, w, color);
    }
  };

  for (const r of roads) {
    for (let i = 0; i < r.n - 1; i++) {
      const a = at(r, i * r.step, -r.hw, ROAD_Y);
      const b = at(r, i * r.step, r.hw, ROAD_Y);
      const c = at(r, (i + 1) * r.step, r.hw, ROAD_Y);
      const d = at(r, (i + 1) * r.step, -r.hw, ROAD_Y);
      roadGeo.quad(a, b, c, d, ruv(a), ruv(b), ruv(c), ruv(d), UP);
    }
    // Raised sidewalks with a kerb, interrupted where another road crosses.
    for (const side of [1, -1]) {
      for (const [s0, s1] of runs(r, side * (r.hw + SIDEWALK / 2), 0)) {
        const m = Math.max(1, Math.ceil((s1 - s0) / 4));
        for (let i = 0; i < m; i++) {
          const sa = s0 + ((s1 - s0) * i) / m;
          const sb = s0 + ((s1 - s0) * (i + 1)) / m;
          const ia = at(r, sa, side * r.hw, 0.2);
          const ib = at(r, sb, side * r.hw, 0.2);
          const oa = at(r, sa, side * (r.hw + SIDEWALK), 0.2);
          const ob = at(r, sb, side * (r.hw + SIDEWALK), 0.2);
          const dn = (p: V3): V3 => [p[0], p[1] - 0.4, p[2]];
          walkGeo.quad(ia, oa, ob, ib, wuv(ia), wuv(oa), wuv(ob), wuv(ib), UP);
          const inward: V3 = [ia[0] - oa[0], 0, ia[2] - oa[2]];
          const outward: V3 = [-inward[0], 0, -inward[2]];
          const kerb: V3 = [0.8, 0.8, 0.8];
          walkGeo.quad(ia, ib, dn(ib), dn(ia), [0, 0], [1, 0], [1, 0.1], [0, 0.1], inward, kerb);
          walkGeo.quad(oa, ob, dn(ob), dn(oa), [0, 0], [1, 0], [1, 0.1], [0, 0.1], outward, kerb);
          if (i === 0) walkGeo.quad(ia, oa, dn(oa), dn(ia), [0, 0], [1, 0], [1, 0.1], [0, 0.1], [ia[0] - ib[0], 0, ia[2] - ib[2]], kerb);
          if (i === m - 1) walkGeo.quad(ib, ob, dn(ob), dn(ib), [0, 0], [1, 0], [1, 0.1], [0, 0.1], [ib[0] - ia[0], 0, ib[2] - ia[2]], kerb);
        }
      }
    }
    // Paint.
    if (r.lanes === 4) {
      line(r, -0.2, 0.14, YELLOW, false);
      line(r, 0.2, 0.14, YELLOW, false);
      line(r, r.hw * 0.57, 0.14, WHITE, true);
      line(r, -r.hw * 0.57, 0.14, WHITE, true);
    } else line(r, 0, 0.15, YELLOW, r.hw < 5);
    if (r.hw >= 5) {
      line(r, r.hw - 0.35, 0.14, WHITE, false);
      line(r, -(r.hw - 0.35), 0.14, WHITE, false);
    }
    for (const [s0, s1] of runs(r, 0, 1.2)) {
      if (s1 - s0 < 14) continue;
      for (let lat = -r.hw + 0.9; lat < r.hw - 0.8; lat += 1.1) {
        if (s0 > 0.5) strip(r, s0 + 0.5, s0 + 3.4, lat, 0.55, WHITE);
        if (s1 < r.len - 0.5) strip(r, s1 - 3.4, s1 - 0.5, lat, 0.55, WHITE);
      }
    }
  }
  // Paved squares.
  for (const pk of PARKS) {
    for (let x = pk.x0; x < pk.x1; x += 10) {
      for (let z = pk.z0; z < pk.z1; z += 10) {
        const x1 = Math.min(x + 10, pk.x1);
        const z1 = Math.min(z + 10, pk.z1);
        const v = (px: number, pz: number): V3 => [px, baseHeight(px, pz) + 0.12, pz];
        const a = v(x, z), b = v(x1, z), c = v(x1, z1), d = v(x, z1);
        walkGeo.quad(a, b, c, d, wuv(a), wuv(b), wuv(c), wuv(d), UP, [0.95, 0.9, 0.84]);
      }
    }
  }

  const asphaltMat = new THREE.MeshStandardMaterial({ map: tex.asphalt.map, normalMap: tex.asphalt.normal, roughness: 0.88, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const walkMat = new THREE.MeshStandardMaterial({ map: tex.sidewalk.map, normalMap: tex.sidewalk.normal, vertexColors: true, roughness: 0.9, metalness: 0 });
  const markMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  normalMapped.push({ mat: asphaltMat, normal: tex.asphalt.normal }, { mat: walkMat, normal: tex.sidewalk.normal });
  add(roadGeo.build(), asphaltMat);
  add(walkGeo.build(), walkMat);
  add(markGeo.build(), markMat, false, true);

  // ---------------------------------------------------------------- buildings
  const wallGeo: Record<Style, Geo> = { brick: new Geo(), glass: new Geo(), plaster: new Geo(), office: new Geo() };
  const shopGeo = new Geo();
  const roofGeo = new Geo();
  const plainGeo = new Geo();

  const emitBuilding = (o: Obb, H: number, style: Style, shop: boolean, tint: V3) => {
    const ux = o.c, uz = o.s, vx = -o.s, vz = o.c;
    const corner = (a: number, b: number): [number, number] => [o.x + ux * o.hx * a + vx * o.hz * b, o.z + uz * o.hx * a + vz * o.hz * b];
    const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    let gMin = Infinity;
    let gMax = -Infinity;
    for (const c of cs) {
      const h = baseHeight(c[0], c[1]);
      gMin = Math.min(gMin, h);
      gMax = Math.max(gMax, h);
    }
    const yBase = gMin - 1.5;
    const yShop = gMax + 4;
    const top = gMax + H;
    const normals: V3[] = [[-vx, 0, -vz], [ux, 0, uz], [vx, 0, vz], [-ux, 0, -uz]];
    const v0 = Math.floor(rng() * 4) / 4;
    for (let k = 0; k < 4; k++) {
      const A = cs[(k + 1) % 4];
      const B = cs[k];
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const yLow = shop ? yShop : yBase;
      const bays = Math.max(1, Math.round(len / 3.2));
      const u0 = Math.floor(rng() * 4) / 4;
      const va = v0 + (yLow - (shop ? yShop : gMax)) / 12;
      const vb = v0 + (top + 0.9 - (shop ? yShop : gMax)) / 12;
      wallGeo[style].quad([A[0], yLow, A[1]], [B[0], yLow, B[1]], [B[0], top + 0.9, B[1]], [A[0], top + 0.9, A[1]], [u0, va], [u0 + bays / 4, va], [u0 + bays / 4, vb], [u0, vb], normals[k], tint);
      if (shop) {
        const sb = Math.max(1, Math.round(len / 3.5));
        const su = Math.floor(rng() * 16) / 16;
        const vl = (yBase - gMax) / 4;
        shopGeo.quad([A[0], yBase, A[1]], [B[0], yBase, B[1]], [B[0], yShop, B[1]], [A[0], yShop, A[1]], [su, vl], [su + sb / 16, vl], [su + sb / 16, 1], [su, 1], normals[k]);
      }
    }
    const rc = cs.map((c): V3 => [c[0], top, c[1]]);
    roofGeo.quad(rc[0], rc[1], rc[2], rc[3], [rc[0][0] / 6, rc[0][2] / 6], [rc[1][0] / 6, rc[1][2] / 6], [rc[2][0] / 6, rc[2][2] / 6], [rc[3][0] / 6, rc[3][2] / 6], UP);
    if (H > 24) roofGeo.box(o.x, top + 1.7, o.z, o.hx * 0.7, 3.4, o.hz * 0.7, [0.85, 0.85, 0.85], o.c, o.s);
    colliders.addObb(o);
  };

  const TINTS: Record<Style, V3[]> = {
    brick: [[1, 1, 1], [0.92, 0.9, 0.88], [1, 0.9, 0.82], [0.85, 0.82, 0.8]],
    glass: [[1, 1, 1], [0.85, 1, 0.95], [1, 0.93, 0.82], [0.8, 0.88, 1]],
    plaster: [[1, 1, 1], [1, 0.95, 0.82], [0.98, 0.8, 0.68], [0.97, 0.88, 0.6], [0.78, 0.88, 0.95], [0.98, 0.82, 0.84], [0.82, 0.93, 0.84], [0.9, 0.62, 0.48]],
    office: [[1, 1, 1], [0.9, 0.9, 0.92], [1, 0.96, 0.9]],
  };
  const pick = <T,>(a: T[]): T => a[Math.floor(rng() * a.length)];
  const rr = (a: number, b: number) => a + rng() * (b - a);

  interface Lot {
    style: Style;
    floors: number;
    w: number;
    d: number;
    gap: number;
    shop: boolean;
  }
  const lotAt = (x: number, z: number): Lot => {
    const r = rng();
    if (x < -640) return { style: r < 0.6 ? 'office' : 'plaster', floors: Math.round(rr(2, 4)), w: rr(22, 36), d: rr(18, 24), gap: rr(2, 9), shop: r > 0.75 };
    const avenue = Math.abs(x + 240) < 62 || Math.abs(x + 560) < 62;
    if (avenue && x > -400 && z > 150) return { style: r < 0.75 ? 'glass' : 'office', floors: Math.round(rr(14, 30)), w: rr(24, 34), d: rr(22, 28), gap: rr(6, 14), shop: r < 0.4 };
    if (avenue) return { style: r < 0.4 ? 'office' : r < 0.7 ? 'glass' : 'brick', floors: Math.round(rr(5, 13)), w: rr(18, 30), d: rr(18, 24), gap: rr(2, 8), shop: r < 0.65 };
    if (x > -180 && x < 470 && z > -470 && z < 250) {
      if (r < 0.72) return { style: 'plaster', floors: Math.round(rr(1, 3)), w: rr(9, 16), d: rr(12, 18), gap: rng() < 0.7 ? 0.2 : rr(2, 5), shop: rng() < 0.85 };
      return { style: r < 0.9 ? 'brick' : 'office', floors: Math.round(rr(5, 9)), w: rr(16, 22), d: rr(16, 20), gap: rr(1, 4), shop: rng() < 0.7 };
    }
    if (x >= 470) {
      if (r < 0.68) return { style: 'brick', floors: Math.round(rr(11, 24)), w: rr(20, 28), d: rr(20, 26), gap: rr(14, 30), shop: false };
      return { style: 'plaster', floors: 2, w: rr(12, 16), d: rr(12, 15), gap: rr(6, 12), shop: false };
    }
    if (r < 0.55) return { style: 'brick', floors: Math.round(rr(5, 13)), w: rr(16, 24), d: rr(16, 22), gap: rr(2, 10), shop: rng() < 0.35 };
    if (r < 0.85) return { style: 'plaster', floors: Math.round(rr(2, 3)), w: rr(10, 16), d: rr(12, 16), gap: rr(1, 6), shop: rng() < 0.4 };
    return { style: 'office', floors: Math.round(rr(4, 9)), w: rr(18, 26), d: rr(16, 22), gap: rr(2, 8), shop: rng() < 0.5 };
  };

  const lotFree = (o: Obb): boolean => {
    const ex = Math.abs(o.c) * o.hx + Math.abs(o.s) * o.hz;
    const ez = Math.abs(o.s) * o.hx + Math.abs(o.c) * o.hz;
    if (o.x - ex < -832 || o.x + ex > 905 || o.z - ez < -905 || o.z + ez > 905) return false;
    for (const rc of RESERVED) if (o.x + ex > rc.x0 && o.x - ex < rc.x1 && o.z + ez > rc.z0 && o.z - ez < rc.z1) return false;
    for (let a = -1; a <= 1; a += 0.5) {
      for (let b = -1; b <= 1; b += 1) {
        if (!clearOfRoads(o.x + o.c * o.hx * a - o.s * o.hz * b, o.z + o.s * o.hx * a + o.c * o.hz * b, -1, SIDEWALK + 0.5)) return false;
      }
    }
    return !colliders.overlapsObb(o, 0.15);
  };

  // Landmark buildings first, so ordinary lots fit around them.
  const signs: { text: string; x: number; y: number; z: number; w: number; face: 'N' | 'S' | 'E' | 'W'; bg: string }[] = [];
  const bigBox = (x0: number, x1: number, z0: number, z1: number, floors: number, style: Style, shop: boolean, tint: V3) => {
    const o: Obb = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, c: 1, s: 0 };
    emitBuilding(o, floors * 3 + (shop ? 4 : 0), style, shop, tint);
    return baseHeight(o.x, o.z) + floors * 3 + (shop ? 4 : 0);
  };
  {
    let top = bigBox(-215, -97, 585, 695, 4, 'office', true, [1, 0.97, 0.92]);
    signs.push({ text: 'CENTRO COMERCIAL MILLA DE ORO', x: -215.3, y: top - 3, z: 640, w: 60, face: 'W', bg: '#8a1c2b' });
    top = bigBox(610, 730, 298, 385, 4, 'glass', true, [0.9, 1, 0.96]);
    signs.push({ text: 'MALL DE LA LOMA', x: 670, y: top - 3, z: 385.3, w: 44, face: 'S', bg: '#1d5c4a' });
    top = bigBox(-522, -432, 258, 372, 8, 'office', false, [1, 1, 1]);
    signs.push({ text: 'CLÍNICA', x: -431.7, y: top - 3, z: 315, w: 26, face: 'E', bg: '#0f5f9a' });
    top = bigBox(-515, -430, 750, 815, 5, 'brick', false, [1, 0.94, 0.9]);
    signs.push({ text: 'UNIVERSIDAD', x: -472, y: top - 2.5, z: 749.7, w: 36, face: 'N', bg: '#22324f' });
    bigBox(-390, -300, 760, 830, 4, 'office', false, [1, 1, 1]);
    top = bigBox(-872, -846, -345, -295, 3, 'office', false, [0.92, 1, 0.94]);
    signs.push({ text: 'ESTACIÓN POBLADO', x: -845.7, y: top - 2, z: -320, w: 30, face: 'E', bg: '#00703c' });
  }

  for (const r of roads) {
    for (const side of [1, -1]) {
      let s = 5;
      while (s < r.len - 8) {
        pointAt2(r, s);
        const lot = lotAt(P.x, P.z);
        offsetPoint(r, s + lot.w / 2, side * (r.hw + SIDEWALK + 1 + lot.d / 2), P);
        const o: Obb = { x: P.x, z: P.z, hx: lot.w / 2, hz: lot.d / 2, c: P.tx, s: P.tz };
        if (lotFree(o)) {
          emitBuilding(o, lot.floors * 3 + (lot.shop ? 4 : 0), lot.style, lot.shop, pick(TINTS[lot.style]));
          s += lot.w + lot.gap;
        } else s += 4;
      }
    }
  }
  function pointAt2(r: Road, s: number) {
    offsetPoint(r, s, 0, P);
  }

  const facadeMat = (t: FacadeTex) => new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.rm, metalnessMap: t.rm, roughness: 1, metalness: 1, vertexColors: true });
  for (const k of Object.keys(wallGeo) as Style[]) add(wallGeo[k].build(), facadeMat(tex[k]), true);
  add(shopGeo.build(), facadeMat(tex.shop), true);
  add(roofGeo.build(), new THREE.MeshStandardMaterial({ map: tex.roof, vertexColors: true, roughness: 0.95, metalness: 0 }), true);

  for (const sg of signs) {
    const h = sg.w / 6;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sg.w, h), new THREE.MeshStandardMaterial({ map: textSign(sg.text, sg.bg, '#ffffff', 1024, 170), roughness: 0.6 }));
    m.position.set(sg.x, sg.y, sg.z);
    m.rotation.y = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 }[sg.face];
    group.add(m);
  }

  // ---------------------------------------------------------------- church, metro, fountain, barriers
  const STONE: V3 = [0.93, 0.9, 0.83];
  const TILE: V3 = [0.62, 0.3, 0.2];
  {
    const cx = -150, cz = -258;
    const g0 = baseHeight(cx, cz);
    plainGeo.box(cx, g0 + 6, cz, 36, 15, 16, STONE, 1, 0, 0.25, false);
    const y0 = g0 + 13.5, y1 = g0 + 19;
    const a: V3 = [cx - 18, y0, cz - 8.6], b: V3 = [cx + 18, y0, cz - 8.6], c: V3 = [cx + 18, y0, cz + 8.6], d: V3 = [cx - 18, y0, cz + 8.6];
    const e: V3 = [cx - 18, y1, cz], f: V3 = [cx + 18, y1, cz];
    const z2: V2 = [0, 0];
    plainGeo.quad(a, b, f, e, z2, z2, z2, z2, [0, 1, -1], TILE);
    plainGeo.quad(d, c, f, e, z2, z2, z2, z2, [0, 1, 1], TILE);
    plainGeo.quad(a, d, e, e, z2, z2, z2, z2, [-1, 0, 0], STONE);
    plainGeo.quad(b, c, f, f, z2, z2, z2, z2, [1, 0, 0], STONE);
    const tx = cx - 21.5;
    plainGeo.box(tx, g0 + 13, cz, 7, 30, 7, STONE);
    plainGeo.box(tx, g0 + 2.2, cz, 7.3, 6.5, 3, [0.25, 0.16, 0.1]);
    plainGeo.box(tx, g0 + 21, cz, 7.3, 4, 2.4, [0.2, 0.2, 0.22]);
    const apex: V3 = [tx, g0 + 36, cz];
    const q = (sx: number, sz: number): V3 => [tx + 3.8 * sx, g0 + 28, cz + 3.8 * sz];
    plainGeo.quad(q(-1, -1), q(1, -1), apex, apex, z2, z2, z2, z2, [0, 1, -1], TILE);
    plainGeo.quad(q(1, -1), q(1, 1), apex, apex, z2, z2, z2, z2, [1, 1, 0], TILE);
    plainGeo.quad(q(1, 1), q(-1, 1), apex, apex, z2, z2, z2, z2, [0, 1, 1], TILE);
    plainGeo.quad(q(-1, 1), q(-1, -1), apex, apex, z2, z2, z2, z2, [-1, 1, 0], TILE);
    plainGeo.box(tx, g0 + 37.5, cz, 0.3, 3, 0.3, [0.2, 0.2, 0.2]);
    plainGeo.box(tx, g0 + 38, cz, 0.3, 0.3, 1.6, [0.2, 0.2, 0.2]);
    colliders.addObb({ x: cx, z: cz, hx: 18, hz: 8, c: 1, s: 0 });
    colliders.addObb({ x: tx, z: cz, hx: 3.6, hz: 3.6, c: 1, s: 0 });
  }
  {
    // Fountain in Parque Lleras.
    const fx = 70, fz = -258, fy = baseHeight(70, -258);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 1.2, 20), new THREE.MeshStandardMaterial({ color: 0xbdb7aa, roughness: 0.8 }));
    basin.position.set(fx, fy + 0.3, fz);
    basin.castShadow = true;
    const water = new THREE.Mesh(new THREE.CircleGeometry(3.8, 20), new THREE.MeshStandardMaterial({ color: 0x4f8fa5, roughness: 0.05, metalness: 0.5 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(fx, fy + 0.95, fz);
    const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 2.4, 10), basin.material);
    jet.position.set(fx, fy + 1.6, fz);
    group.add(basin, water, jet);
    colliders.addCircle(fx, fz, 4.4);
  }
  const CONCRETE: V3 = [0.72, 0.71, 0.68];
  const VIA_X = -884;
  const VIA_Y = 9.5;
  {
    plainGeo.box(VIA_X, VIA_Y, 0, 8, 1.3, 2000, CONCRETE);
    for (let z = -980; z <= 980; z += 40) {
      plainGeo.box(VIA_X, VIA_Y / 2 - 1, z, 1.8, VIA_Y + 1, 1.8, CONCRETE, 1, 0, 0.25, false);
      plainGeo.box(VIA_X, VIA_Y - 1, z, 6, 1, 2.2, CONCRETE, 1, 0, 0.25, false);
      if (Math.abs(z) < BOUND) colliders.addCircle(VIA_X, z, 1.3);
    }
    // Station platform and canopy.
    plainGeo.box(VIA_X, VIA_Y + 1.2, -320, 15, 1.2, 96, [0.85, 0.85, 0.82]);
    plainGeo.box(VIA_X, VIA_Y + 6.2, -320, 16, 0.5, 96, [0.0, 0.42, 0.24]);
    for (let z = -364; z <= -276; z += 11) {
      plainGeo.box(VIA_X - 7.2, VIA_Y + 3.8, z, 0.4, 4.6, 0.4, [0.9, 0.9, 0.9], 1, 0, 0.25, false);
      plainGeo.box(VIA_X + 7.2, VIA_Y + 3.8, z, 0.4, 4.6, 0.4, [0.9, 0.9, 0.9], 1, 0, 0.25, false);
    }
    plainGeo.box(-866, 6, -320, 14, 1, 5, CONCRETE);
  }
  // Barriers where a road reaches the edge of the map.
  for (const r of roads) {
    for (const end of [0, 1]) {
      const s = end ? r.len : 0;
      if (r.inter.some((i) => Math.abs(i.s - s) < 14)) continue;
      offsetPoint(r, end ? r.len - 3 : 3, 0, P);
      const y = baseHeight(P.x, P.z);
      const w = (r.hw + SIDEWALK) * 2;
      plainGeo.box(P.x, y + 0.45, P.z, 0.6, 0.9, w, [0.92, 0.92, 0.92], P.tx, P.tz);
      plainGeo.box(P.x, y + 1.05, P.z, 0.62, 0.35, w, [0.85, 0.12, 0.1], P.tx, P.tz);
      colliders.addObb({ x: P.x, z: P.z, hx: 0.4, hz: w / 2, c: P.tx, s: P.tz });
    }
  }
  add(plainGeo.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), true);

  // Metro train shuttling along the viaduct.
  const trainGeo = new Geo();
  for (let k = -1; k <= 1; k++) {
    trainGeo.box(0, 2.1, k * 23, 3, 3.3, 22, [0.94, 0.94, 0.92]);
    trainGeo.box(0, 2.6, k * 23, 3.06, 0.9, 20.5, [0.12, 0.14, 0.16], 1, 0, 0.25, false);
    trainGeo.box(0, 1.0, k * 23, 3.08, 0.5, 22, [0.0, 0.45, 0.25], 1, 0, 0.25, false);
  }
  const train = new THREE.Mesh(trainGeo.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3 }));
  train.position.set(VIA_X, VIA_Y + 0.6, 700);
  train.castShadow = true;
  group.add(train);
  let trainDir = -1;
  let trainWait = 0;
  let trainStopped = false;

  // ---------------------------------------------------------------- jump ramps
  {
    const g = new Geo();
    const specs: [string, number, number][] = [
      ['Avenida El Poblado', 0.12, 1], ['Avenida El Poblado', 0.47, -1], ['Avenida El Poblado', 0.8, 1],
      ['Avenida Las Vegas', 0.3, 1], ['Avenida Las Vegas', 0.72, -1],
      ['Avenida Regional', 0.2, 1], ['Avenida Regional', 0.62, -1],
      ['Calle 10', 0.52, -1], ['Calle 10', 0.2, -1],
    ];
    for (const [name, frac, dir] of specs) {
      const r = roads.find((x) => x.name === name)!;
      let s = frac * r.len;
      while (distToJunction(r, s) < 45) s += 12;
      offsetPoint(r, s, 0, P);
      const ramp = { x: P.x, z: P.z, sin: P.tx * dir, cos: P.tz * dir, len: 7, halfW: 2, height: 1.5 };
      ramps.push(ramp);
      const pt = (along: number, lat: number, up: number): V3 => {
        const x = ramp.x + ramp.sin * along + ramp.cos * lat;
        const z = ramp.z + ramp.cos * along - ramp.sin * lat;
        return [x, baseHeight(x, z) + ROAD_Y + up, z];
      };
      const sl = pt(0, -2, 0), sr = pt(0, 2, 0), el = pt(7, -2, 0), er = pt(7, 2, 0), tl = pt(7, -2, 1.5), tr = pt(7, 2, 1.5);
      g.quad(sl, sr, tr, tl, [0, 0], [1, 0], [1, 2], [0, 2], UP);
      g.quad(el, er, tr, tl, [0, 0], [1, 0], [1, 0.4], [0, 0.4], [ramp.sin, 0, ramp.cos]);
      g.quad(sl, el, tl, tl, [0, 0], [2, 0], [2, 0.4], [2, 0.4], [-ramp.cos, 0, ramp.sin]);
      g.quad(sr, er, tr, tr, [0, 0], [2, 0], [2, 0.4], [2, 0.4], [ramp.cos, 0, -ramp.sin]);
    }
    add(g.build(), new THREE.MeshStandardMaterial({ map: tex.hazard, roughness: 0.7 }), true);
  }

  // ---------------------------------------------------------------- trees
  {
    const spots: [number, number, number][] = [];
    const tryTree = (x: number, z: number, exclude: number, clear: number, size: number) => {
      if (!clearOfRoads(x, z, exclude, clear)) return;
      if (colliders.pointInside(x, z, 1.6)) return;
      spots.push([x, z, size]);
      if (Math.abs(x) < BOUND && Math.abs(z) < BOUND) colliders.addCircle(x, z, 0.4);
    };
    for (const r of roads) {
      for (const side of [1, -1]) {
        for (let s = 9 + rng() * 10; s < r.len - 6; s += 17 + rng() * 20) {
          if (rng() < 0.2) continue;
          offsetPoint(r, s, side * (r.hw + SIDEWALK - 0.7), P);
          tryTree(P.x, P.z, r.id, SIDEWALK - 0.4, 0.8 + rng() * 0.4);
        }
      }
    }
    for (const pk of PARKS) {
      for (let i = 0; i < 26; i++) {
        const x = rr(pk.x0 + 5, pk.x1 - 5);
        const z = rr(pk.z0 + 5, pk.z1 - 5);
        if (Math.hypot(x - 70, z + 258) < 10) continue;
        tryTree(x, z, -1, 1, 1 + rng() * 0.5);
      }
    }
    for (let i = 0; i < 1700; i++) {
      const x = rr(-830, 1500);
      const z = rr(-1300, 1300);
      if (RESERVED.some((rc) => inRect(x, z, rc, 2))) continue;
      tryTree(x, z, -1, SIDEWALK + 2, 0.9 + rng() * 0.9);
    }
    const crown = new THREE.IcosahedronGeometry(1, 1);
    const cp = crown.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
      const k = 0.82 + 0.3 * Math.abs(Math.sin(x * 12.9 + y * 78.2 + z * 37.7) * 43758.5 % 1);
      cp.setXYZ(i, x * k, y * k * 0.8, z * k);
    }
    // Sphere-like normals give the crowns soft shading instead of hard facets.
    const cn = crown.attributes.normal;
    for (let i = 0; i < cp.count; i++) {
      const l = Math.hypot(cp.getX(i), cp.getY(i), cp.getZ(i)) || 1;
      cn.setXYZ(i, cp.getX(i) / l, cp.getY(i) / l, cp.getZ(i) / l);
    }
    const trunk = new THREE.CylinderGeometry(0.16, 0.26, 1, 6);
    trunk.translate(0, 0.5, 0);
    const leafMat = new THREE.MeshStandardMaterial({ map: tex.leaves, roughness: 0.95, metalness: 0 });
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 });
    // One instanced batch per 250 m cell so off-screen trees are culled.
    const cells = new Map<string, [number, number, number][]>();
    for (const sp of spots) {
      const k = `${Math.floor(sp[0] / 250)},${Math.floor(sp[1] / 250)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k)!.push(sp);
    }
    const m = new THREE.Matrix4();
    const qn = new THREE.Quaternion();
    const col = new THREE.Color();
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (const list of cells.values()) {
      const crowns = new THREE.InstancedMesh(crown, leafMat, list.length);
      const trunks = new THREE.InstancedMesh(trunk, barkMat, list.length);
      list.forEach(([x, z, size], i) => {
        const y = baseHeight(x, z) - 0.2;
        const th = (2.6 + rng() * 2) * size;
        const cr = (2.1 + rng() * 1.3) * size;
        m.compose(new THREE.Vector3(x, y, z), qn.identity(), new THREE.Vector3(size, th, size));
        trunks.setMatrixAt(i, m);
        qn.setFromAxisAngle(yAxis, rng() * 6.28);
        m.compose(new THREE.Vector3(x, y + th + cr * 0.45, z), qn, new THREE.Vector3(cr, cr, cr));
        crowns.setMatrixAt(i, m);
        crowns.setColorAt(i, col.setHSL(0.26 + rng() * 0.08, 0.5, 0.42 + rng() * 0.2));
      });
      crowns.computeBoundingSphere();
      trunks.computeBoundingSphere();
      crowns.castShadow = trunks.castShadow = true;
      crowns.receiveShadow = true;
      group.add(crowns, trunks);
    }
  }

  // ---------------------------------------------------------------- named places
  const places: Place[] = [];
  for (const [name, x, z] of PLACE_ANCHORS) {
    const nr = nearestRoad(x, z);
    if (nr.road < 0) continue;
    const r = roads[nr.road];
    let s = Math.min(Math.max(nr.s, 20), r.len - 20);
    for (let k = 0; k < 6 && distToJunction(r, s) < r.hw + 20; k++) s = Math.min(r.len - 20, s + 12);
    places.push({ name, road: r.id, s, side: nr.lat >= 0 ? 1 : -1 });
  }

  group.traverse((o) => o.updateMatrix());
  train.matrixAutoUpdate = true;

  return {
    group,
    colliders,
    places,
    normalMapped,
    update(dt: number) {
      if (trainWait > 0) {
        trainWait -= dt;
        return;
      }
      train.position.z += trainDir * 22 * dt;
      if (!trainStopped && Math.abs(train.position.z + 320) < 1) {
        trainWait = 7;
        trainStopped = true;
      }
      if (Math.abs(train.position.z) > 900) {
        trainDir = -trainDir;
        train.position.z = Math.sign(train.position.z) * 900;
        trainStopped = false;
      }
    },
  };
}
