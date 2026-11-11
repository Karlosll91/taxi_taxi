import { smoothstep } from '../core/math';

/** The taxi cannot leave this square (metres from the map centre). */
export const BOUND = 930;
/** Height of the road surface above the mathematical ground. */
export const ROAD_Y = 0.06;

export interface Ramp {
  x: number;
  z: number;
  /** Direction of travel that climbs the ramp. */
  sin: number;
  cos: number;
  len: number;
  halfW: number;
  height: number;
}

export const ramps: Ramp[] = [];

/**
 * Natural ground height. El Poblado climbs from the river in the west (-x)
 * to the hills in the east (+x); beyond the playable area the valley walls rise.
 */
export function baseHeight(x: number, z: number): number {
  let h = 120 * smoothstep(-650, 1150, x);
  const u = smoothstep(-300, 500, x);
  h += u * (9 * Math.sin(x / 170 + 1.3) * Math.sin(z / 230 + 0.4) + 6 * Math.sin(z / 140 + x / 400));
  const dr = (x + 985) / 45;
  h -= 6 * Math.exp(-dr * dr);
  if (x > 960) {
    const d = x - 960;
    h += 0.00017 * d * d + smoothstep(0, 700, d) * 70 * Math.sin(z / 310 + x / 500) * Math.sin(x / 270);
  }
  if (x < -1100) {
    const d = -1100 - x;
    h += 0.00017 * d * d + smoothstep(0, 700, d) * 60 * Math.sin(z / 280 + 2) * Math.sin(x / 240);
  }
  const dn = Math.abs(z) - 1000;
  if (dn > 0) h += 0.00002 * dn * dn;
  return h;
}

export function rampHeight(x: number, z: number): number {
  for (let i = 0; i < ramps.length; i++) {
    const r = ramps[i];
    const dx = x - r.x;
    const dz = z - r.z;
    const along = dx * r.sin + dz * r.cos;
    if (along < 0 || along > r.len) continue;
    const lat = dx * r.cos - dz * r.sin;
    if (lat < -r.halfW || lat > r.halfW) continue;
    return (r.height * along) / r.len;
  }
  return 0;
}

/** Height the taxi drives on: natural ground plus any jump ramp. */
export function groundHeight(x: number, z: number): number {
  return baseHeight(x, z) + rampHeight(x, z);
}
