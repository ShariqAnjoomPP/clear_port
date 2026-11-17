import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../src/lib/db';
import { DbFileStore } from '../src/lib/files';

/** FILE_STORE=db (hosted demo, no disk): files go into Postgres and come back byte for byte. */
afterAll(() => pool.end());

describe('files in the database', () => {
  it('stores and returns the same bytes, and replaces on a second put', async () => {
    const store = new DbFileStore();
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 255, 10]);
    await store.put('job/test/doc.pdf', pdf);
    expect(Array.from(await store.get('job/test/doc.pdf'))).toEqual(Array.from(pdf));
    await store.put('job/test/doc.pdf', new Uint8Array([1, 2, 3]));
    expect(Array.from(await store.get('job/test/doc.pdf'))).toEqual([1, 2, 3]);
    await expect(store.get('job/test/missing.pdf')).rejects.toThrow(/not found/);
  });
});
