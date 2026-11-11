import { describe, expect, it } from 'vitest';
import { baseFare, classify, delivery, formatClock, formatCOP, pickupBonus, rank, sessionSeconds, tipValue, tripTime } from '../src/mission/scoring';

describe('scoring', () => {
  it('classifies trips by distance', () => {
    expect(classify(300)).toBe('corta');
    expect(classify(800)).toBe('media');
    expect(classify(1500)).toBe('larga');
  });

  it('pays more and allows more time for longer trips', () => {
    expect(baseFare(1200)).toBeGreaterThan(baseFare(400));
    expect(tripTime(1200)).toBeGreaterThan(tripTime(400));
    expect(baseFare(500) % 100).toBe(0);
    expect(pickupBonus(800)).toBeLessThan(tripTime(800));
  });

  it('rewards fast deliveries', () => {
    expect(delivery(0.6)).toEqual({ rating: 'rapido', mult: 1.5, bonus: 8 });
    expect(delivery(0.3).rating).toBe('bien');
    expect(delivery(0.05)).toEqual({ rating: 'lento', mult: 1, bonus: 1 });
  });

  it('grows tips with the combo up to a cap', () => {
    expect(tipValue('near', 1)).toBe(400);
    expect(tipValue('near', 3)).toBe(600);
    expect(tipValue('jump', 50)).toBe(2400);
  });

  it('ranks by earnings', () => {
    expect(rank(0)).toBe('Novato');
    expect(rank(30000)).toBe('Taxista');
    expect(rank(100000)).toBe('Berraco');
    expect(rank(500000)).toBe('Leyenda del Poblado');
  });

  it('formats pesos and the clock the Colombian way', () => {
    expect(formatCOP(23500)).toBe('$ 23.500');
    expect(formatCOP(1234567)).toBe('$ 1.234.567');
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(-3)).toBe('0:00');
    expect(sessionSeconds('fijo5')).toBe(300);
    expect(sessionSeconds('libre')).toBe(Infinity);
  });
});
