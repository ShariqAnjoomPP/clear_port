/**
 * ISO 6346 container number: 3-letter owner code + category (U, J or Z) + 6-digit serial + check digit.
 * Example: CSQU3054383.
 */
const LETTER_VALUES: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  let value = 10;
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (value % 11 === 0) value++; // multiples of 11 are skipped
    map[ch] = value++;
  }
  return map;
})();

export const normaliseContainerNo = (raw: string): string => raw.replace(/[\s-]/g, '').toUpperCase();

export function containerCheckDigit(first10: string): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = first10[i]!;
    const v = /[0-9]/.test(ch) ? Number(ch) : LETTER_VALUES[ch];
    if (v === undefined) return -1;
    sum += v * 2 ** i;
  }
  return (sum % 11) % 10;
}

export type ContainerNoError = 'FORMAT' | 'CHECK_DIGIT';

export function validateContainerNo(raw: string): { valid: true; value: string } | { valid: false; value: string; error: ContainerNoError } {
  const value = normaliseContainerNo(raw);
  if (!/^[A-Z]{3}[UJZ][0-9]{7}$/.test(value)) return { valid: false, value, error: 'FORMAT' };
  if (containerCheckDigit(value.slice(0, 10)) !== Number(value[10])) return { valid: false, value, error: 'CHECK_DIGIT' };
  return { valid: true, value };
}

/**
 * Prototype check: 11 letters/digits after tidying (no check-digit maths).
 * Switch callers back to validateContainerNo for the full ISO 6346 check.
 */
export function checkContainerLength(raw: string): { valid: true; value: string } | { valid: false; value: string; error: 'LENGTH' } {
  const value = normaliseContainerNo(raw);
  return /^[A-Z0-9]{11}$/.test(value) ? { valid: true, value } : { valid: false, value, error: 'LENGTH' };
}

/** Parse a pasted list (newline, comma, tab or space separated) into unique normalised container numbers. */
export function parseContainerList(text: string): string[] {
  const seen = new Set<string>();
  for (const token of text.split(/[\s,;]+/)) {
    const v = normaliseContainerNo(token);
    if (v) seen.add(v);
  }
  return [...seen];
}
