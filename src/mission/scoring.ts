/** Pure scoring rules, kept free of rendering code so they can be unit-tested. */

export type TripClass = 'corta' | 'media' | 'larga';
export type TipKind = 'near' | 'drift' | 'jump';
export type Rating = 'rapido' | 'bien' | 'lento';
export type Mode = 'normal' | 'fijo3' | 'fijo5' | 'fijo10' | 'libre';

const round = (v: number, step: number) => Math.round(v / step) * step;

/** Trip length class from the street distance in metres. */
export const classify = (dist: number): TripClass => (dist < 600 ? 'corta' : dist < 1200 ? 'media' : 'larga');

/** Seconds the passenger allows for the trip. */
export const tripTime = (dist: number) => Math.round(14 + dist / 13);

/** Fare in Colombian pesos before bonuses. */
export const baseFare = (dist: number) => round(4500 + dist * 9, 100);

/** Seconds added to the shift clock when a passenger gets in. */
export const pickupBonus = (dist: number) => Math.round(tripTime(dist) * 0.45);

export function delivery(fractionLeft: number): { rating: Rating; mult: number; bonus: number } {
  if (fractionLeft > 0.45) return { rating: 'rapido', mult: 1.5, bonus: 8 };
  if (fractionLeft > 0.15) return { rating: 'bien', mult: 1.2, bonus: 4 };
  return { rating: 'lento', mult: 1, bonus: 1 };
}

const TIP_BASE: Record<TipKind, number> = { near: 400, drift: 300, jump: 600 };

/** Tip for a stunt; `combo` counts stunts since the last crash, including this one. */
export const tipValue = (kind: TipKind, combo: number) => round(TIP_BASE[kind] * Math.min(4, 1 + 0.25 * (combo - 1)), 50);

export const RANKS = ['Novato', 'Taxista', 'Berraco', 'Leyenda del Poblado'] as const;

export function rank(earnings: number): (typeof RANKS)[number] {
  if (earnings < 25000) return RANKS[0];
  if (earnings < 70000) return RANKS[1];
  if (earnings < 140000) return RANKS[2];
  return RANKS[3];
}

/** Session length in seconds; Infinity for free roam. */
export function sessionSeconds(mode: Mode): number {
  return { normal: 70, fijo3: 180, fijo5: 300, fijo10: 600, libre: Infinity }[mode];
}

export const formatCOP = (n: number) => '$ ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}
