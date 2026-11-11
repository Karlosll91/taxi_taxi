import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Traffic } from '../src/traffic/traffic';
import { Car, CarInput } from '../src/vehicle/car';
import { Colliders } from '../src/world/collide';
import { offsetPoint, roads } from '../src/world/roads';

const DT = 1 / 120;
const run = (car: Car, input: CarInput, seconds: number, col = new Colliders()) => {
  for (let t = 0; t < seconds; t += DT) car.step(DT, input, col);
};
const onRegional = () => {
  const r = roads.find((x) => x.name === 'Avenida Regional')!;
  const p = offsetPoint(r, 100, 3, { x: 0, z: 0, tx: 0, tz: 0 });
  const car = new Car();
  car.place(p.x, p.z, Math.atan2(p.tx, p.tz));
  return car;
};

describe('taxi physics', () => {
  it('accelerates to highway speed and brakes to a stop', () => {
    const car = onRegional();
    run(car, { steer: 0, throttle: 1, brake: 0, handbrake: false }, 4);
    expect(car.speed * 3.6).toBeGreaterThan(80);
    run(car, { steer: 0, throttle: 1, brake: 0, handbrake: false }, 10);
    expect(car.speed * 3.6).toBeGreaterThan(120);
    expect(car.speed * 3.6).toBeLessThan(145);
    run(car, { steer: 0, throttle: 0, brake: 1, handbrake: false }, 1.6);
    expect(car.forward).toBeLessThan(1);
  });

  it('turns right when steering right and drifts on the handbrake', () => {
    const car = onRegional();
    run(car, { steer: 0, throttle: 1, brake: 0, handbrake: false }, 3);
    const h0 = car.heading;
    run(car, { steer: 1, throttle: 1, brake: 0, handbrake: false }, 0.5);
    expect(car.heading).toBeLessThan(h0 - 0.1);
    expect(car.drifting).toBe(false);
    run(car, { steer: 1, throttle: 1, brake: 0, handbrake: true }, 0.6);
    expect(car.drifting).toBe(true);
  });

  it('reverses and stays parked on a slope', () => {
    const car = new Car();
    const r = roads.find((x) => x.name === 'Calle 10')!;
    const p = offsetPoint(r, 900, 2, { x: 0, z: 0, tx: 0, tz: 0 });
    car.place(p.x, p.z, Math.atan2(p.tx, p.tz));
    run(car, { steer: 0, throttle: 0, brake: 0, handbrake: false }, 3);
    expect(Math.hypot(car.x - p.x, car.z - p.z)).toBeLessThan(0.5);
    run(car, { steer: 0, throttle: 0, brake: 1, handbrake: false }, 2);
    expect(car.forward).toBeLessThan(-3);
  });

  it('is stopped by a wall and reports the crash', () => {
    const car = onRegional();
    const col = new Colliders();
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const wall = { x: car.x + fx * 60, z: car.z + fz * 60 };
    col.addObb({ ...wall, hx: 20, hz: 20, c: 1, s: 0 });
    run(car, { steer: 0, throttle: 1, brake: 0, handbrake: false }, 6, col);
    expect(car.crash).toBeGreaterThan(8);
    expect(Math.hypot(car.x - wall.x, car.z - wall.z)).toBeGreaterThan(19);
  });
});

describe('traffic', () => {
  it('keeps every vehicle moving on valid coordinates for a minute', () => {
    const car = onRegional();
    let hits = 0;
    const traffic = new Traffic(new THREE.Scene(), { nearMiss: () => {}, hit: () => hits++ });
    traffic.setCount(30, car.x, car.z);
    const start: number[] = [];
    traffic.each((x, z) => start.push(x, z));
    for (let t = 0; t < 60; t += 1 / 30) traffic.update(1 / 30, car, true);
    let moved = 0;
    let i = 0;
    traffic.each((x, z) => {
      expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true);
      if (Math.hypot(x - start[i], z - start[i + 1]) > 20) moved++;
      i += 2;
    });
    expect(moved).toBeGreaterThan(20);
  });
});
