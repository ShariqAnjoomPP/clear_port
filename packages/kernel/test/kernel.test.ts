import { describe, expect, it } from 'vitest';
import { addAmounts, can, containerCheckDigit, parseContainerList, percentOf, uuidv7, validateContainerNo } from '../src';

describe('ISO 6346 container numbers', () => {
  it('accepts valid numbers', () => {
    expect(validateContainerNo('CSQU3054383')).toEqual({ valid: true, value: 'CSQU3054383' });
    expect(validateContainerNo('msku 907032-3').valid).toBe(true);
  });
  it('rejects wrong check digits and formats', () => {
    expect(validateContainerNo('CSQU3054384')).toMatchObject({ valid: false, error: 'CHECK_DIGIT' });
    expect(validateContainerNo('CSQ3054383')).toMatchObject({ valid: false, error: 'FORMAT' });
  });
  it('computes check digit', () => expect(containerCheckDigit('CSQU305438')).toBe(3));
  it('parses pasted lists and removes duplicates', () => {
    expect(parseContainerList('CSQU3054383, MSKU9070323\nCSQU3054383')).toEqual(['CSQU3054383', 'MSKU9070323']);
  });
});

describe('money', () => {
  it('adds without floating point errors', () => expect(addAmounts('0.1', '0.2')).toBe('0.300'));
  it('handles 3-decimal currencies', () => expect(addAmounts('1.005', '2.010')).toBe('3.015'));
  it('rounds percentages half-up', () => expect(percentOf('100.010', 5)).toBe('5.001'));
});

describe('uuidv7', () => {
  it('is time ordered and version 7', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a < b).toBe(true);
    expect(a[14]).toBe('7');
  });
});

describe('permissions', () => {
  it('lets a PRO update Bayan but not close a job', () => {
    expect(can(['PRO'], 'stage.BAYAN.update')).toBe(true);
    expect(can(['PRO'], 'job.close')).toBe(false);
  });
  it('gives owner everything and customers only the portal', () => {
    expect(can(['OWNER'], 'admin.config')).toBe(true);
    expect(can(['CUSTOMER'], 'job.read')).toBe(false);
    expect(can(['CUSTOMER'], 'portal.access')).toBe(true);
  });
  it('supports stage wildcards for coordinators', () => expect(can(['COORDINATOR'], 'stage.CCRO.update')).toBe(true));
});
