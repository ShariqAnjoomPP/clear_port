/**
 * Free time on a B/L ("9 days combined detention & demurrage at port of discharge") counts from arrival.
 * The arrival day is day 1, so 9 days from 2026-09-14 ends on 2026-09-22 (inclusive).
 */
export function freeTimeEnd(arrival: string, days: number): string {
  const d = new Date(`${arrival}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${arrival}`);
  d.setUTCDate(d.getUTCDate() + Math.max(0, days - 1));
  return d.toISOString().slice(0, 10);
}
