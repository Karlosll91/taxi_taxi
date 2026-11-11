/** Static 2D colliders (buildings as oriented boxes, trees as circles) in a spatial grid. */

export interface Obb {
  x: number;
  z: number;
  hx: number;
  hz: number;
  /** Unit axis of the box's local x direction. */
  c: number;
  s: number;
}

export interface Hit {
  nx: number;
  nz: number;
  depth: number;
}

const CELL = 32;
const key = (ix: number, iz: number) => (ix + 512) * 2048 + (iz + 512);

export class Colliders {
  obbs: Obb[] = [];
  circles: { x: number; z: number; r: number }[] = [];
  private map = new Map<number, number[]>();

  private insert(id: number, minX: number, maxX: number, minZ: number, maxZ: number) {
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const k = key(ix, iz);
        let l = this.map.get(k);
        if (!l) this.map.set(k, (l = []));
        l.push(id);
      }
    }
  }

  addObb(o: Obb) {
    const ex = Math.abs(o.c) * o.hx + Math.abs(o.s) * o.hz;
    const ez = Math.abs(o.s) * o.hx + Math.abs(o.c) * o.hz;
    this.obbs.push(o);
    this.insert(this.obbs.length - 1, o.x - ex, o.x + ex, o.z - ez, o.z + ez);
  }

  addCircle(x: number, z: number, r: number) {
    this.circles.push({ x, z, r });
    this.insert(-this.circles.length, x - r, x + r, z - r, z + r);
  }

  /** Deepest penetration of a circle into any collider. Returns false when free. */
  resolveCircle(px: number, pz: number, r: number, out: Hit): boolean {
    out.depth = 0;
    const x0 = Math.floor((px - r) / CELL);
    const x1 = Math.floor((px + r) / CELL);
    const z0 = Math.floor((pz - r) / CELL);
    const z1 = Math.floor((pz + r) / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const l = this.map.get(key(ix, iz));
        if (!l) continue;
        for (let k = 0; k < l.length; k++) {
          const id = l[k];
          if (id < 0) {
            const c = this.circles[-id - 1];
            const dx = px - c.x;
            const dz = pz - c.z;
            const d = Math.hypot(dx, dz);
            const pen = r + c.r - d;
            if (pen > out.depth) {
              out.depth = pen;
              out.nx = d > 1e-4 ? dx / d : 1;
              out.nz = d > 1e-4 ? dz / d : 0;
            }
            continue;
          }
          const o = this.obbs[id];
          const dx = px - o.x;
          const dz = pz - o.z;
          const lx = dx * o.c + dz * o.s;
          const lz = -dx * o.s + dz * o.c;
          const qx = lx < -o.hx ? -o.hx : lx > o.hx ? o.hx : lx;
          const qz = lz < -o.hz ? -o.hz : lz > o.hz ? o.hz : lz;
          const ex = lx - qx;
          const ez = lz - qz;
          const d2 = ex * ex + ez * ez;
          let nlx: number;
          let nlz: number;
          let pen: number;
          if (d2 < 1e-8) {
            const penX = o.hx - Math.abs(lx);
            const penZ = o.hz - Math.abs(lz);
            if (penX < penZ) {
              nlx = lx < 0 ? -1 : 1;
              nlz = 0;
              pen = penX + r;
            } else {
              nlx = 0;
              nlz = lz < 0 ? -1 : 1;
              pen = penZ + r;
            }
          } else if (d2 < r * r) {
            const d = Math.sqrt(d2);
            nlx = ex / d;
            nlz = ez / d;
            pen = r - d;
          } else continue;
          if (pen > out.depth) {
            out.depth = pen;
            out.nx = nlx * o.c - nlz * o.s;
            out.nz = nlx * o.s + nlz * o.c;
          }
        }
      }
    }
    return out.depth > 0;
  }

  /** True when a box (given as centre, half extents, axis) overlaps an existing box, with a margin. */
  overlapsObb(n: Obb, margin: number): boolean {
    const rad = Math.hypot(n.hx, n.hz) + margin;
    const seen = new Set<number>();
    for (let ix = Math.floor((n.x - rad) / CELL); ix <= Math.floor((n.x + rad) / CELL); ix++) {
      for (let iz = Math.floor((n.z - rad) / CELL); iz <= Math.floor((n.z + rad) / CELL); iz++) {
        const l = this.map.get(key(ix, iz));
        if (!l) continue;
        for (const id of l) {
          if (id < 0 || seen.has(id)) continue;
          seen.add(id);
          if (sat(n, this.obbs[id], margin)) return true;
        }
      }
    }
    return false;
  }

  pointInside(x: number, z: number, margin = 0): boolean {
    const l = this.map.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!l) return false;
    for (const id of l) {
      if (id < 0) continue;
      const o = this.obbs[id];
      const dx = x - o.x;
      const dz = z - o.z;
      if (Math.abs(dx * o.c + dz * o.s) < o.hx + margin && Math.abs(-dx * o.s + dz * o.c) < o.hz + margin) return true;
    }
    return false;
  }
}

function sat(a: Obb, b: Obb, margin: number): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const axes = [a.c, a.s, -a.s, a.c, b.c, b.s, -b.s, b.c];
  for (let i = 0; i < 8; i += 2) {
    const ux = axes[i];
    const uz = axes[i + 1];
    const ra = a.hx * Math.abs(a.c * ux + a.s * uz) + a.hz * Math.abs(-a.s * ux + a.c * uz);
    const rb = b.hx * Math.abs(b.c * ux + b.s * uz) + b.hz * Math.abs(-b.s * ux + b.c * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb + margin) return false;
  }
  return true;
}
