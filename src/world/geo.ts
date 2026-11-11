import * as THREE from 'three';

export type V3 = [number, number, number];
export type V2 = [number, number];
const WHITE: V3 = [1, 1, 1];

/** Accumulates quads into one mesh so the whole city needs only a handful of draw calls. */
export class Geo {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  /** Quad a-b-c-d. Winding is flipped if needed so the face points along `hint`. */
  quad(a: V3, b: V3, c: V3, d: V3, ua: V2, ub: V2, uc: V2, ud: V2, hint: V3, color: V3 = WHITE) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = d[0] - a[0], e2y = d[1] - a[1], e2z = d[2] - a[2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0;
    const base = this.pos.length / 3;
    const vs = flip ? [a, d, c, b] : [a, b, c, d];
    const us = flip ? [ua, ud, uc, ub] : [ua, ub, uc, ud];
    const s = flip ? -1 : 1;
    for (let i = 0; i < 4; i++) {
      this.pos.push(vs[i][0], vs[i][1], vs[i][2]);
      this.nor.push(nx * s, ny * s, nz * s);
      this.uv.push(us[i][0], us[i][1]);
      this.col.push(color[0], color[1], color[2]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Axis-aligned or y-rotated box; uv is a simple planar mapping scaled in metres. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: V3 = WHITE, c = 1, s = 0, uvScale = 0.25, top = true) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const p = (lx: number, ly: number, lz: number): V3 => [cx + lx * c - lz * s, cy + ly, cz + lx * s + lz * c];
    const n = (lx: number, lz: number): V3 => [lx * c - lz * s, 0, lx * s + lz * c];
    const u = (w: number, h: number): [V2, V2, V2, V2] => [[0, 0], [w * uvScale, 0], [w * uvScale, h * uvScale], [0, h * uvScale]];
    const sides: [V3, V3, V3, V3, V3, number][] = [
      [p(hx, -hy, hz), p(-hx, -hy, hz), p(-hx, hy, hz), p(hx, hy, hz), n(0, 1), sx],
      [p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, hy, -hz), p(-hx, hy, -hz), n(0, -1), sx],
      [p(hx, -hy, -hz), p(hx, -hy, hz), p(hx, hy, hz), p(hx, hy, -hz), n(1, 0), sz],
      [p(-hx, -hy, hz), p(-hx, -hy, -hz), p(-hx, hy, -hz), p(-hx, hy, hz), n(-1, 0), sz],
    ];
    for (const f of sides) {
      const uvs = u(f[5], sy);
      this.quad(f[0], f[1], f[2], f[3], uvs[0], uvs[1], uvs[2], uvs[3], f[4], color);
    }
    if (top) {
      const uvs = u(sx, sz);
      this.quad(p(-hx, hy, -hz), p(hx, hy, -hz), p(hx, hy, hz), p(-hx, hy, hz), uvs[0], uvs[1], uvs[2], uvs[3], [0, 1, 0], color);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    // Colours are written as sRGB (what you would pick in a paint program); the renderer wants linear.
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col.map((c) => Math.pow(c, 2.2)), 3));
    g.setIndex(this.idx);
    return g;
  }
}
