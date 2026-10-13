/**
 * Decimal money with 3-decimal precision (covers AED/SAR/QAR and KWD/BHD/OMR).
 * Amounts travel as strings ("1250.000") and are computed in integer thousandths — never floating point.
 */
export const MONEY_SCALE = 3;
const FACTOR = 10n ** BigInt(MONEY_SCALE);

export type Money = { amount: string; currency: string };

export function toMinor(amount: string): bigint {
  const m = /^(-)?(\d+)(?:\.(\d{1,3}))?$/.exec(amount.trim());
  if (!m) throw new Error(`Invalid money amount: ${amount}`);
  const [, sign, whole, frac = ''] = m;
  const v = BigInt(whole!) * FACTOR + BigInt(frac.padEnd(MONEY_SCALE, '0'));
  return sign ? -v : v;
}

export function fromMinor(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = abs / FACTOR;
  const frac = (abs % FACTOR).toString().padStart(MONEY_SCALE, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

export const isMoneyAmount = (v: string): boolean => /^-?\d+(\.\d{1,3})?$/.test(v.trim());

export const addAmounts = (...amounts: string[]): string => fromMinor(amounts.reduce((s, a) => s + toMinor(a), 0n));

export const multiplyAmount = (amount: string, qty: number): string => fromMinor(toMinor(amount) * BigInt(qty));

/** Percentage with up to 2 decimals, rounded half-up to 3 decimals. */
export function percentOf(amount: string, percent: string | number): string {
  const p = BigInt(Math.round(Number(percent) * 100)); // basis points
  const raw = toMinor(amount) * p; // scaled by 10000
  const q = raw / 10000n;
  const r = raw % 10000n;
  return fromMinor(r * 2n >= 10000n ? q + 1n : q);
}

export function formatMoney(m: Money, locale = 'en'): string {
  const n = Number(m.amount);
  const digits = ['KWD', 'BHD', 'OMR', 'JOD'].includes(m.currency) ? 3 : 2;
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}
