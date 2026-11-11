import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Geo, V2, V3 } from '../world/geo';
import { makeCanvas, textSign } from '../world/textures';

const Z2: V2 = [0, 0];
const GLASS: V3 = [0.16, 0.2, 0.24];
const DARK: V3 = [0.2, 0.2, 0.21];

/** Extrudes a side profile (z, y, half-width) across the car's width, with end caps. */
function extrude(g: Geo, pts: [number, number, number][], color: V3) {
  let cz = 0;
  let cy = 0;
  for (const p of pts) {
    cz += p[0] / pts.length;
    cy += p[1] / pts.length;
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const mz = (a[0] + b[0]) / 2 - cz;
    const my = (a[1] + b[1]) / 2 - cy;
    g.quad([-a[2], a[1], a[0]], [a[2], a[1], a[0]], [b[2], b[1], b[0]], [-b[2], b[1], b[0]], Z2, Z2, Z2, Z2, [0, my, mz], color);
    for (const sd of [1, -1]) g.quad([sd * a[2], a[1], a[0]], [sd * b[2], b[1], b[0]], [sd * b[2] * 0.98, cy, cz], [sd * b[2] * 0.98, cy, cz], Z2, Z2, Z2, Z2, [sd, 0, 0], color);
  }
}

function colored(geo: THREE.BufferGeometry, c: V3): THREE.BufferGeometry {
  const g = geo.index ? geo : geo.toNonIndexed();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set(c.map((v) => Math.pow(v, 2.2)), i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.index) g.setIndex([...Array(n).keys()]);
  return g;
}

function wheelGeo(r: number, w: number): THREE.BufferGeometry {
  const tyre = new THREE.CylinderGeometry(r, r, w, 16);
  const hub = new THREE.CylinderGeometry(r * 0.58, r * 0.58, w + 0.02, 12);
  const g = mergeGeometries([colored(tyre, [0.05, 0.05, 0.05]), colored(hub, [0.55, 0.56, 0.58])])!;
  g.rotateZ(Math.PI / 2);
  return g;
}

interface BodySpec {
  L: number;
  W: number;
  hatch: boolean;
  paint: V3;
}

/** Body shell with glass, bumpers and lights, origin on the ground under the centre. */
function bodyGeo(spec: BodySpec, g = new Geo()): Geo {
  const { L, W, hatch, paint } = spec;
  const f = L / 2;
  const r = -L / 2;
  const w = W / 2;
  extrude(g, [[f, 0.32, w - 0.06], [f, 0.62, w - 0.03], [f - 0.14, 0.78, w], [0.24 * L, 0.92, w], [r + 0.12, 0.96, w], [r, 0.86, w - 0.03], [r, 0.32, w - 0.06]], paint);
  const cab: [number, number, number][] = hatch
    ? [[0.26 * L, 0.9, w - 0.04], [0.07 * L, 1.43, w - 0.2], [-0.3 * L, 1.45, w - 0.2], [r + 0.2, 0.95, w - 0.05]]
    : [[0.24 * L, 0.9, w - 0.04], [0.06 * L, 1.42, w - 0.2], [-0.22 * L, 1.42, w - 0.2], [-0.37 * L, 0.95, w - 0.05]];
  extrude(g, cab, paint);
  // Windscreen and rear window sit just above the sloped cabin faces.
  const pane = (a: [number, number, number], b: [number, number, number], t0: number, t1: number) => {
    const dz = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dz, dy);
    let nz = dy / l;
    let ny = -dz / l;
    if (ny < 0) {
      nz = -nz;
      ny = -ny;
    }
    const pt = (t: number, sd: number): V3 => [sd * (a[2] + (b[2] - a[2]) * t - 0.09), a[1] + dy * t + ny * 0.02, a[0] + dz * t + nz * 0.02];
    g.quad(pt(t0, -1), pt(t0, 1), pt(t1, 1), pt(t1, -1), Z2, Z2, Z2, Z2, [0, ny, nz], GLASS);
  };
  pane(cab[0], cab[1], 0.1, 0.92);
  pane(cab[3], cab[2], 0.12, 0.92);
  const hwAt = (y: number) => w - 0.04 - ((y - 0.93) / 0.51) * 0.16 + 0.02;
  const side = (zs: [number, number, number, number]) => {
    for (const sd of [1, -1]) {
      g.quad([sd * hwAt(0.99), 0.99, zs[0]], [sd * hwAt(0.99), 0.99, zs[1]], [sd * hwAt(1.37), 1.37, zs[2]], [sd * hwAt(1.37), 1.37, zs[3]], Z2, Z2, Z2, Z2, [sd, 0.2, 0], GLASS);
    }
  };
  side([cab[0][0] - 0.22, 0.0, 0.0, cab[1][0] + 0.02]);
  side([-0.07, hatch ? r + 0.5 : cab[3][0] + 0.22, cab[2][0] + 0.03, -0.07]);
  // Bumpers, grille, lights and plates.
  g.box(0, 0.42, f + 0.02, W - 0.1, 0.2, 0.12, DARK);
  g.box(0, 0.42, r - 0.02, W - 0.1, 0.2, 0.12, DARK);
  g.box(0, 0.62, f + 0.01, W * 0.42, 0.13, 0.06, DARK);
  for (const sd of [1, -1]) {
    g.box(sd * (w - 0.3), 0.68, f - 0.02, 0.36, 0.13, 0.1, [1, 1, 0.92]);
    g.box(sd * (w - 0.24), 0.8, r, 0.3, 0.14, 0.08, [0.75, 0.04, 0.03]);
  }
  g.box(0, 0.5, r - 0.085, 0.42, 0.14, 0.02, [0.95, 0.95, 0.95]);
  return g;
}

function withWheels(body: Geo, L: number, W: number, radius: number): THREE.BufferGeometry {
  const parts = [body.build()];
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const wg = wheelGeo(radius, 0.22);
      wg.translate(sx * (W / 2 - 0.1), radius, sz * L * 0.32);
      parts.push(wg);
    }
  }
  return mergeGeometries(parts)!;
}

/** One merged geometry per traffic vehicle type; paint is white so instances can be tinted. */
export function trafficGeometries(): { car: THREE.BufferGeometry; bus: THREE.BufferGeometry } {
  const car = withWheels(bodyGeo({ L: 4.3, W: 1.75, hatch: false, paint: [1, 1, 1] }), 4.3, 1.75, 0.32);
  const b = new Geo();
  b.box(0, 1.75, 0, 2.5, 2.7, 9.6, [1, 1, 1]);
  b.box(0, 2.15, 0, 2.54, 0.95, 9.0, GLASS, 1, 0, 0.25, false);
  b.box(0, 2.0, 4.72, 2.3, 1.3, 0.2, GLASS, 1, 0, 0.25, false);
  b.box(0, 0.55, 4.82, 2.5, 0.3, 0.1, DARK);
  b.box(0, 0.55, -4.82, 2.5, 0.3, 0.1, DARK);
  for (const sd of [1, -1]) {
    b.box(sd * 0.9, 0.85, 4.81, 0.4, 0.18, 0.06, [1, 1, 0.9]);
    b.box(sd * 0.95, 0.9, -4.81, 0.3, 0.3, 0.06, [0.75, 0.04, 0.03]);
  }
  const parts = [b.build()];
  for (const sx of [1, -1]) {
    for (const z of [3.1, -2.9]) {
      const wg = wheelGeo(0.5, 0.3);
      wg.translate(sx * 1.12, 0.5, z);
      parts.push(wg);
    }
  }
  return { car, bus: mergeGeometries(parts)! };
}

export interface TaxiModel {
  root: THREE.Group;
  /** Follows the slope of the ground; holds the body and the wheels. */
  tilt: THREE.Group;
  /** Leans with braking and cornering on top of the slope. */
  chassis: THREE.Group;
  wheels: THREE.Mesh[];
  brake: THREE.MeshStandardMaterial;
}

/** The player's taxi: a small yellow hatchback with a roof light and door lettering. */
export function buildTaxi(): TaxiModel {
  const L = 3.9;
  const W = 1.7;
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(tilt);
  tilt.add(chassis);
  const paint = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 });
  const body = new THREE.Mesh(bodyGeo({ L, W, hatch: true, paint: [0.98, 0.72, 0.02] }).build(), paint);
  body.castShadow = true;
  chassis.add(body);

  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.22), [
    new THREE.MeshStandardMaterial({ color: 0xf5f5f0 }),
    new THREE.MeshStandardMaterial({ color: 0xf5f5f0 }),
    new THREE.MeshStandardMaterial({ color: 0xf5f5f0 }),
    new THREE.MeshStandardMaterial({ color: 0xf5f5f0 }),
    new THREE.MeshStandardMaterial({ map: textSign('TAXI', '#f5f5f0', '#111', 256, 80), emissive: 0x333322 }),
    new THREE.MeshStandardMaterial({ map: textSign('TAXI', '#f5f5f0', '#111', 256, 80), emissive: 0x333322 }),
  ]);
  sign.position.set(0, 1.56, -0.15);
  chassis.add(sign);

  // Door lettering on a transparent decal.
  const c = makeCanvas(256, 128);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.font = 'bold 54px system-ui, sans-serif';
  ctx.fillText('TAXI', 128, 58);
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillText('POBLADO 4·44', 128, 104);
  const decalTex = new THREE.CanvasTexture(c);
  decalTex.colorSpace = THREE.SRGBColorSpace;
  const decalMat = new THREE.MeshStandardMaterial({ map: decalTex, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const sd of [1, -1]) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.42), decalMat);
    d.position.set(sd * (W / 2 + 0.006), 0.7, -0.15);
    d.rotation.y = (sd * Math.PI) / 2;
    chassis.add(d);
  }

  const brake = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a10, emissiveIntensity: 0 });
  for (const sd of [1, -1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.04), brake);
    b.position.set(sd * (W / 2 - 0.24), 0.8, -L / 2 - 0.035);
    chassis.add(b);
  }

  const wheels: THREE.Mesh[] = [];
  const wg = wheelGeo(0.31, 0.22);
  const wm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 });
  for (const sz of [1, -1]) {
    for (const sx of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (W / 2 - 0.1), 0.31, sz * 1.25);
      const wheel = new THREE.Mesh(wg, wm);
      wheel.castShadow = true;
      pivot.add(wheel);
      tilt.add(pivot);
      wheels.push(wheel);
    }
  }
  return { root, tilt, chassis, wheels, brake };
}

/** Simple standing figure split in two geometries: clothes (tinted per person) and the rest. */
export function personGeometries(): { clothes: THREE.BufferGeometry; rest: THREE.BufferGeometry } {
  const torso = new THREE.CapsuleGeometry(0.19, 0.42, 3, 8);
  torso.translate(0, 1.15, 0);
  const arms: THREE.BufferGeometry[] = [];
  const legs: THREE.BufferGeometry[] = [];
  for (const sd of [1, -1]) {
    const arm = new THREE.CapsuleGeometry(0.06, 0.5, 2, 6);
    arm.translate(sd * 0.27, 1.12, 0);
    arms.push(colored(arm, [1, 1, 1]));
    const leg = new THREE.CapsuleGeometry(0.085, 0.62, 2, 6);
    leg.translate(sd * 0.1, 0.42, 0);
    legs.push(colored(leg, [0.14, 0.16, 0.24]));
  }
  const head = new THREE.SphereGeometry(0.135, 10, 8);
  head.translate(0, 1.66, 0);
  const hair = new THREE.SphereGeometry(0.142, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
  hair.translate(0, 1.675, -0.01);
  return {
    clothes: mergeGeometries([colored(torso, [1, 1, 1]), ...arms])!,
    rest: mergeGeometries([colored(head, [0.78, 0.56, 0.42]), colored(hair, [0.1, 0.07, 0.05]), ...legs])!,
  };
}
