import * as THREE from 'three';
import { angDiff, damp, mulberry32 } from '../core/math';
import { Car } from '../vehicle/car';
import { personGeometries, trafficGeometries } from '../vehicle/models';
import { Road, RoadPoint, offsetPoint, roads } from '../world/roads';
import { ROAD_Y, baseHeight, groundHeight } from '../world/terrain';

const P: RoadPoint = { x: 0, z: 0, tx: 0, tz: 0 };
const rng = mulberry32(99);
const totalLen = roads.reduce((a, r) => a + r.len, 0);

function randomRoad(): Road {
  let t = rng() * totalLen;
  for (const r of roads) {
    t -= r.len;
    if (t <= 0) return r;
  }
  return roads[0];
}

interface Veh {
  bus: boolean;
  road: number;
  s: number;
  dir: 1 | -1;
  lane: number;
  speed: number;
  cruise: number;
  x: number;
  z: number;
  heading: number;
  ox: number;
  oz: number;
  knocked: number;
  vx: number;
  vz: number;
  spin: number;
  near: boolean;
  hitCooldown: number;
  hold: number;
  scale: number;
}

const CAR_CIRCLES = [0.95, -0.95];
const BUS_CIRCLES = [3.4, 1.15, -1.15, -3.4];
const PAINTS = [0xf2f2f2, 0xd0d3d6, 0x8b9096, 0x2a2c30, 0x9c1f1f, 0x1f3f7a, 0xf7b602, 0xf7b602, 0x5b6d5a, 0xb9a58a];
const BUS_PAINTS = [0x1c7a4a, 0xd9dde0, 0xc23b22, 0x2c5fa8];

export interface TrafficEvents {
  nearMiss(): void;
  hit(impact: number): void;
}

/** Cars and buses that follow the road graph near the player and can be knocked aside. */
export class Traffic {
  private list: Veh[] = [];
  private carMesh: THREE.InstancedMesh;
  private busMesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private pos = new THREE.Vector3();
  private scl = new THREE.Vector3();
  private col = new THREE.Color();
  private target = 0;

  constructor(scene: THREE.Scene, private events: TrafficEvents) {
    const g = trafficGeometries();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.25 });
    this.carMesh = new THREE.InstancedMesh(g.car, mat, 64);
    this.busMesh = new THREE.InstancedMesh(g.bus, mat, 12);
    for (const m of [this.carMesh, this.busMesh]) {
      m.frustumCulled = false;
      m.castShadow = true;
      m.count = 0;
      scene.add(m);
    }
  }

  setCount(n: number, px: number, pz: number) {
    this.target = n;
    while (this.list.length < n) {
      const bus = this.list.length % 7 === 3;
      const v: Veh = { bus, road: 0, s: 0, dir: 1, lane: 0, speed: 0, cruise: 1, x: 0, z: 0, heading: 0, ox: 0, oz: 0, knocked: 0, vx: 0, vz: 0, spin: 0, near: false, hitCooldown: 0, hold: 0, scale: 1 };
      this.list.push(v);
      this.spawn(v, px, pz, 40);
    }
    this.list.length = n;
    this.paint();
  }

  /** Re-places every vehicle, used when a new shift starts. */
  reset(px: number, pz: number) {
    for (const v of this.list) this.spawn(v, px, pz, 40);
  }

  private paint() {
    let ci = 0;
    let bi = 0;
    this.list.forEach((v, i) => {
      if (v.bus) this.busMesh.setColorAt(bi++, this.col.setHex(BUS_PAINTS[i % BUS_PAINTS.length]));
      else this.carMesh.setColorAt(ci++, this.col.setHex(PAINTS[(i * 7) % PAINTS.length]));
    });
    if (this.carMesh.instanceColor) this.carMesh.instanceColor.needsUpdate = true;
    if (this.busMesh.instanceColor) this.busMesh.instanceColor.needsUpdate = true;
  }

  private laneFor(v: Veh, r: Road) {
    v.lane = r.lanes === 4 ? r.hw * (v.bus || rng() < 0.5 ? 0.78 : 0.36) : r.hw * 0.5;
  }

  private spawn(v: Veh, px: number, pz: number, minDist: number) {
    for (let k = 0; k < 30; k++) {
      const r = randomRoad();
      if (v.bus && r.hw < 5) continue;
      const s = 10 + rng() * (r.len - 20);
      offsetPoint(r, s, 0, P);
      const d = Math.hypot(P.x - px, P.z - pz);
      if (d < minDist || d > 340) continue;
      if (this.list.some((o) => o !== v && Math.hypot(o.x - P.x, o.z - P.z) < 16)) continue;
      v.road = r.id;
      v.s = s;
      v.dir = rng() < 0.5 ? 1 : -1;
      this.laneFor(v, r);
      v.cruise = 0.85 + rng() * 0.3;
      v.speed = 8;
      v.ox = v.oz = 0;
      v.knocked = 0;
      v.near = false;
      v.hold = 0;
      v.scale = 1;
      offsetPoint(r, s, v.dir * v.lane, P);
      v.x = P.x;
      v.z = P.z;
      v.heading = Math.atan2(P.tx * v.dir, P.tz * v.dir);
      return;
    }
    // No free spot this frame: park it far away and retry on the next update.
    v.x = 1e5;
    v.z = 1e5;
    v.s = -1;
  }

  private turn(v: Veh, from: Road, onto: Road, os: number, must: boolean): boolean {
    const dirs: (1 | -1)[] = rng() < 0.5 ? [1, -1] : [-1, 1];
    for (const d of dirs) {
      const room = d > 0 ? onto.len - os : os;
      if (room < 30) continue;
      if (v.bus && onto.hw < 5 && !must) return false;
      v.road = onto.id;
      v.dir = d;
      v.s = os + d * (from.hw * 0.6 + 2);
      this.laneFor(v, onto);
      offsetPoint(onto, v.s, v.dir * v.lane, P);
      v.ox = v.x - P.x;
      v.oz = v.z - P.z;
      return true;
    }
    return false;
  }

  update(dt: number, car: Car, active: boolean) {
    const list = this.list;
    const pfx = Math.sin(car.heading);
    const pfz = Math.cos(car.heading);
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (v.s < 0 && v.knocked <= 0) {
        this.spawn(v, car.x, car.z, 130);
        continue;
      }
      v.hitCooldown -= dt;
      const fx = Math.sin(v.heading);
      const fz = Math.cos(v.heading);
      if (v.knocked > 0) {
        v.knocked -= dt;
        v.x += v.vx * dt;
        v.z += v.vz * dt;
        const k = Math.exp(-1.6 * dt);
        v.vx *= k;
        v.vz *= k;
        v.heading += v.spin * dt;
        v.spin *= Math.exp(-1.2 * dt);
        if (v.knocked < 0.4) v.scale = Math.max(0.01, v.knocked / 0.4);
        if (v.knocked <= 0) this.spawn(v, car.x, car.z, 130);
      } else {
        const r = roads[v.road];
        // Look ahead for anything in the way.
        let blocked = v.hold > 0;
        v.hold -= dt;
        const reach = 7 + v.speed * 1.1 + (v.bus ? 5 : 0);
        for (let j = 0; j < list.length + 1 && !blocked; j++) {
          let ox: number, oz: number, ofx: number, ofz: number;
          if (j === list.length) {
            ox = car.x;
            oz = car.z;
            ofx = pfx;
            ofz = pfz;
          } else {
            if (j === i) continue;
            const o = list[j];
            ox = o.x;
            oz = o.z;
            ofx = Math.sin(o.heading);
            ofz = Math.cos(o.heading);
          }
          const dx = ox - v.x;
          const dz = oz - v.z;
          const ahead = dx * fx + dz * fz;
          if (ahead <= 0 || ahead > reach) continue;
          if (Math.abs(dx * fz - dz * fx) > 2.3) continue;
          // Two vehicles crossing each other: the lower index goes first.
          if (j < list.length && ofx * fx + ofz * fz < 0.4 && i < j) continue;
          blocked = true;
        }
        const want = blocked ? 0 : (r.lanes === 4 ? 15 : 10.5) * v.cruise * (v.bus ? 0.8 : 1);
        v.speed += Math.max(-14 * dt, Math.min(4 * dt, want - v.speed));
        const s0 = v.s;
        v.s += v.dir * v.speed * dt;
        let done = false;
        for (const it of r.inter) {
          const crossed = v.dir > 0 ? s0 < it.s && v.s >= it.s : s0 > it.s && v.s <= it.s;
          if (!crossed) continue;
          const atEnd = v.dir > 0 ? r.len - it.s < 8 : it.s < 8;
          if (atEnd || rng() < 0.3) done = this.turn(v, r, roads[it.road], it.os, atEnd);
          if (done) break;
        }
        if (!done && (v.s < 1 || v.s > r.len - 1)) {
          this.spawn(v, car.x, car.z, 130);
          continue;
        }
        const rr = roads[v.road];
        offsetPoint(rr, v.s, v.dir * v.lane, P);
        const k = Math.exp(-2.2 * dt);
        v.ox *= k;
        v.oz *= k;
        const nx = P.x + v.ox;
        const nz = P.z + v.oz;
        const mx = nx - v.x;
        const mz = nz - v.z;
        if (mx * mx + mz * mz > 1e-5) v.heading += angDiff(Math.atan2(mx, mz), v.heading) * damp(10, dt);
        v.x = nx;
        v.z = nz;
        if (Math.hypot(v.x - car.x, v.z - car.z) > 430) {
          this.spawn(v, car.x, car.z, 130);
          continue;
        }
      }

      // Contact and near-miss against the taxi.
      if (!active) continue;
      const cd = Math.hypot(v.x - car.x, v.z - car.z);
      if (cd > 14) {
        if (v.near && v.hitCooldown <= 0) this.events.nearMiss();
        v.near = false;
        continue;
      }
      const circles = v.bus ? BUS_CIRCLES : CAR_CIRCLES;
      const vr = v.bus ? 1.45 : 1.05;
      let gap = Infinity;
      for (const co of circles) {
        const ax = v.x + Math.sin(v.heading) * co;
        const az = v.z + Math.cos(v.heading) * co;
        for (const po of [1.15, -1.15]) {
          const bx = car.x + pfx * po;
          const bz = car.z + pfz * po;
          const dx = bx - ax;
          const dz = bz - az;
          const d = Math.hypot(dx, dz) || 0.001;
          const pen = vr + 1.0 - d;
          gap = Math.min(gap, -pen);
          if (pen <= 0 || car.y - groundHeight(car.x, car.z) > 1.7) continue;
          const nx = dx / d;
          const nz = dz / d;
          car.x += nx * pen;
          car.z += nz * pen;
          const wvx = v.knocked > 0 ? v.vx : Math.sin(v.heading) * v.speed;
          const wvz = v.knocked > 0 ? v.vz : Math.cos(v.heading) * v.speed;
          const vn = (car.vx - wvx) * nx + (car.vz - wvz) * nz;
          if (vn >= 0) continue;
          const give = v.bus ? 1.3 : 0.75;
          car.vx -= nx * vn * give;
          car.vz -= nz * vn * give;
          if (-vn > 2.5) {
            car.crash = Math.max(car.crash, -vn);
            if (v.hitCooldown <= 0) this.events.hit(-vn);
            v.hitCooldown = 2;
            v.near = false;
          }
          if (v.bus) v.hold = 1.5;
          else if (-vn > 2.5) {
            v.knocked = 4;
            v.vx = wvx * 0.5 + nx * vn * 0.8 + car.vx * 0.25;
            v.vz = wvz * 0.5 + nz * vn * 0.8 + car.vz * 0.25;
            v.spin = (rng() - 0.5) * Math.min(8, -vn * 0.5);
          }
        }
      }
      if (gap < 1.2 && car.speed > 12 && v.hitCooldown <= 0) v.near = true;
      else if (gap > 3.5 && v.near) {
        if (v.hitCooldown <= 0) this.events.nearMiss();
        v.near = false;
      }
    }

    let ci = 0;
    let bi = 0;
    for (const v of list) {
      const fx = Math.sin(v.heading);
      const fz = Math.cos(v.heading);
      const slope = (baseHeight(v.x + fx * 2, v.z + fz * 2) - baseHeight(v.x - fx * 2, v.z - fz * 2)) / 4;
      this.e.set(-Math.atan(slope), v.heading, 0);
      this.q.setFromEuler(this.e);
      this.pos.set(v.x, baseHeight(v.x, v.z) + ROAD_Y, v.z);
      this.scl.setScalar(v.scale);
      this.m.compose(this.pos, this.q, this.scl);
      if (v.bus) this.busMesh.setMatrixAt(bi++, this.m);
      else this.carMesh.setMatrixAt(ci++, this.m);
    }
    this.carMesh.count = ci;
    this.busMesh.count = bi;
    this.carMesh.instanceMatrix.needsUpdate = true;
    this.busMesh.instanceMatrix.needsUpdate = true;
  }

  /** Positions for the minimap. */
  each(fn: (x: number, z: number) => void) {
    for (const v of this.list) fn(v.x, v.z);
  }
}

const PED_TINTS = [0xd94f3d, 0x3d7bd9, 0xf2f2f2, 0x2e2e33, 0xe8b93b, 0x4fa36b, 0xc86fb0, 0x8a5a3c, 0x6fb7c8];

/** Makes one standing person, used for passengers. */
export function makePerson(tint: number): THREE.Group {
  const g = personGeometries();
  const grp = new THREE.Group();
  const a = new THREE.Mesh(g.clothes, new THREE.MeshStandardMaterial({ color: tint, roughness: 0.9 }));
  const b = new THREE.Mesh(g.rest, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  a.castShadow = b.castShadow = true;
  grp.add(a, b);
  return grp;
}

/** Pedestrians walking the sidewalks near the player. They step aside and cannot be hit. */
export class Pedestrians {
  private n = 0;
  private road: number[] = [];
  private s: number[] = [];
  private dir: number[] = [];
  private side: number[] = [];
  private lat: number[] = [];
  private dodge: number[] = [];
  private phase: number[] = [];
  private px: number[] = [];
  private pz: number[] = [];
  private clothes: THREE.InstancedMesh;
  private rest: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private pos = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    const g = personGeometries();
    this.clothes = new THREE.InstancedMesh(g.clothes, new THREE.MeshStandardMaterial({ roughness: 0.9 }), 80);
    this.rest = new THREE.InstancedMesh(g.rest, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 80);
    const c = new THREE.Color();
    for (let i = 0; i < 80; i++) this.clothes.setColorAt(i, c.setHex(PED_TINTS[i % PED_TINTS.length]));
    for (const m of [this.clothes, this.rest]) {
      m.frustumCulled = false;
      m.castShadow = true;
      m.count = 0;
      scene.add(m);
    }
  }

  setCount(n: number, px: number, pz: number) {
    for (let i = this.n; i < n; i++) this.spawn(i, px, pz, 20);
    this.n = n;
  }

  private spawn(i: number, px: number, pz: number, minDist: number) {
    for (let k = 0; k < 20; k++) {
      const r = randomRoad();
      const s = 5 + rng() * (r.len - 10);
      offsetPoint(r, s, 0, P);
      const d = Math.hypot(P.x - px, P.z - pz);
      if (d < minDist || d > 190) continue;
      this.road[i] = r.id;
      this.s[i] = s;
      this.dir[i] = rng() < 0.5 ? 1 : -1;
      this.side[i] = rng() < 0.5 ? 1 : -1;
      this.lat[i] = r.hw + 0.8 + rng() * 1.6;
      this.dodge[i] = 0;
      this.phase[i] = rng() * 6;
      this.px[i] = P.x;
      this.pz[i] = P.z;
      return;
    }
    this.s[i] = -1;
    this.px[i] = 1e5;
  }

  update(dt: number, car: Car) {
    for (let i = 0; i < this.n; i++) {
      if (this.s[i] < 0) {
        this.spawn(i, car.x, car.z, 70);
        continue;
      }
      const r = roads[this.road[i]];
      this.s[i] += this.dir[i] * 1.35 * dt;
      this.phase[i] += dt * 9;
      const dCar = Math.hypot(this.px[i] - car.x, this.pz[i] - car.z);
      if (this.s[i] < 2 || this.s[i] > r.len - 2 || dCar > 230) {
        this.spawn(i, car.x, car.z, 70);
        continue;
      }
      if (dCar < 3.4 && car.speed > 3) this.dodge[i] = Math.min(3.2, this.dodge[i] + 14 * dt);
      else this.dodge[i] = Math.max(0, this.dodge[i] - 1.2 * dt);
      offsetPoint(r, this.s[i], this.side[i] * (this.lat[i] + this.dodge[i]), P);
      this.px[i] = P.x;
      this.pz[i] = P.z;
      const hop = this.dodge[i] > 0.05 && dCar < 6 ? 0.25 : 0;
      this.pos.set(P.x, baseHeight(P.x, P.z) + 0.2 + Math.abs(Math.sin(this.phase[i])) * 0.04 + hop, P.z);
      this.q.setFromAxisAngle(this.up, Math.atan2(P.tx * this.dir[i], P.tz * this.dir[i]));
      this.m.compose(this.pos, this.q, this.one);
      this.clothes.setMatrixAt(i, this.m);
      this.rest.setMatrixAt(i, this.m);
    }
    this.clothes.count = this.rest.count = this.n;
    this.clothes.instanceMatrix.needsUpdate = true;
    this.rest.instanceMatrix.needsUpdate = true;
  }
}
