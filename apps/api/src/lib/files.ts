import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { config } from './config';
import { db } from './db';
import { fileBlob } from './schema';

/** Uploads are capped below the 6 MB Lambda request limit once base64 overhead is counted. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;

/**
 * Port: file storage. The prototype keeps files on local disk; production swaps in an S3 implementation
 * (with presigned uploads, so large files skip the Lambda) without touching the documents function.
 */
export interface FileStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

class LocalFileStore implements FileStore {
  private readonly root = resolve(process.cwd(), config.FILE_DIR);

  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + '/')) throw new Error('Invalid storage key');
    return p;
  }

  async put(key: string, bytes: Uint8Array) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }

  async get(key: string) {
    return readFile(this.path(key));
  }
}

/** Files kept in Postgres (file_blob): for free hosting without a disk. Fine for a demo's small PDFs and photos. */
export class DbFileStore implements FileStore {
  async put(key: string, bytes: Uint8Array) {
    await db.insert(fileBlob).values({ storageKey: key, bytes: Buffer.from(bytes) })
      .onConflictDoUpdate({ target: fileBlob.storageKey, set: { bytes: Buffer.from(bytes) } });
  }

  async get(key: string) {
    const [row] = await db.select({ bytes: fileBlob.bytes }).from(fileBlob).where(eq(fileBlob.storageKey, key));
    if (!row) throw new Error(`File not found: ${key}`);
    return new Uint8Array(row.bytes);
  }
}

export const fileStore: FileStore = config.FILE_STORE === 'db' ? new DbFileStore() : new LocalFileStore();

/** Magic-byte check: the declared content type must match the file's real signature. */
export function sniffContentType(head: Uint8Array): string | null {
  const hex = Buffer.from(head.slice(0, 12)).toString('hex');
  if (hex.startsWith('25504446')) return 'application/pdf';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e47')) return 'image/png';
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') return 'image/webp';
  if (hex.slice(8, 16) === '66747970') return 'image/heic';
  return null;
}

export const safeFileName = (name: string) => name.replace(/[^\w.\-]+/g, '_').slice(-120) || 'file';
