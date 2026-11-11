import { describe, expect, it } from 'vitest';
import { Colliders, Hit } from '../src/world/collide';
import { addressOf, clearOfRoads, nearestRoad, offsetPoint, roads } from '../src/world/roads';
import { baseHeight } from '../src/world/terrain';

describe('road network', () => {
  it('connects every road to at least one other', () => {
    for (const r of roads) expect(r.inter.length, r.name).toBeGreaterThan(0);
  });

  it('snaps loose ends exactly onto the road they meet', () => {
    const calle8 = roads.find((r) => r.name === 'Calle 8')!;
    const end = nearestRoad(calle8.px[calle8.n - 1], calle8.pz[calle8.n - 1], calle8.id);
    expect(roads[end.road].name).toBe('Transversal Inferior');
    expect(end.dist).toBeLessThan(0.5);
  });

  it('finds the nearest road and which side a point is on', () => {
    const r = roads.find((x) => x.name === 'Calle 9')!;
    const p = offsetPoint(r, 300, 3, { x: 0, z: 0, tx: 0, tz: 0 });
    const n = nearestRoad(p.x, p.z);
    expect(n.road).toBe(r.id);
    expect(n.lat).toBeCloseTo(3, 1);
    expect(n.s).toBeCloseTo(300, 0);
    expect(clearOfRoads(p.x, p.z, -1, 0)).toBe(false);
    expect(clearOfRoads(60, -260, -1, 3)).toBe(true);
  });

  it('names addresses by the closest cross street', () => {
    const r = roads.find((x) => x.name === 'Calle 9')!;
    expect(addressOf(r, r.inter[0].s + 5)).toBe(`Calle 9 con ${roads[r.inter[0].road].name}`);
  });

  it('keeps road gradients drivable', () => {
    let worst = 0;
    for (const r of roads) {
      for (let i = 1; i < r.n; i++) {
        const g = Math.abs(baseHeight(r.px[i], r.pz[i]) - baseHeight(r.px[i - 1], r.pz[i - 1])) / r.step;
        worst = Math.max(worst, g);
      }
    }
    expect(worst).toBeLessThan(0.22);
  });
});

describe('colliders', () => {
  const c = new Colliders();
  c.addObb({ x: 10, z: 0, hx: 5, hz: 2, c: 1, s: 0 });
  c.addCircle(-10, 0, 1);
  const hit: Hit = { nx: 0, nz: 0, depth: 0 };

  it('pushes a circle out of a box along the nearest face', () => {
    expect(c.resolveCircle(4.5, 0, 1, hit)).toBe(true);
    expect(hit.nx).toBeCloseTo(-1);
    expect(hit.depth).toBeCloseTo(0.5);
    expect(c.resolveCircle(0, 0, 1, hit)).toBe(false);
  });

  it('handles circles and point tests', () => {
    expect(c.resolveCircle(-8.5, 0, 1, hit)).toBe(true);
    expect(hit.nx).toBeCloseTo(1);
    expect(c.pointInside(10, 1)).toBe(true);
    expect(c.pointInside(10, 3)).toBe(false);
    expect(c.overlapsObb({ x: 14, z: 3, hx: 2, hz: 2, c: Math.SQRT1_2, s: Math.SQRT1_2 }, 0)).toBe(true);
    expect(c.overlapsObb({ x: 30, z: 3, hx: 2, hz: 2, c: 1, s: 0 }, 0)).toBe(false);
  });
});
