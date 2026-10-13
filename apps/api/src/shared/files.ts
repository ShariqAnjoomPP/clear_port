import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';
import { signFileToken, verifyFileToken } from './auth';

export interface UploadTarget {
  method: 'POST' | 'PUT';
  url: string;
  fields?: Record<string, string>;
  headers?: Record<string, string>;
  key: string;
  expiresIn: number;
}

/** Port: object storage. Files never pass through the API in production (presigned URLs straight to S3). */
export interface FileStore {
  presignUpload(input: { key: string; contentType: string; maxBytes: number }): Promise<UploadTarget>;
  presignDownload(key: string, fileName: string): Promise<string>;
  size(key: string): Promise<number | null>;
}

const EXPIRES = 300; // 5 minutes

class S3FileStore implements FileStore {
  private s3 = new S3Client({ region: config.AWS_REGION });
  async presignUpload({ key, contentType, maxBytes }: { key: string; contentType: string; maxBytes: number }): Promise<UploadTarget> {
    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: config.S3_BUCKET!,
      Key: key,
      Conditions: [['content-length-range', 1, maxBytes], ['eq', '$Content-Type', contentType]],
      Fields: { 'Content-Type': contentType },
      Expires: EXPIRES,
    });
    return { method: 'POST', url, fields, key, expiresIn: EXPIRES };
  }
  async presignDownload(key: string, fileName: string) {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: config.S3_BUCKET!, Key: key, ResponseContentDisposition: `inline; filename="${encodeURIComponent(fileName)}"` }), { expiresIn: EXPIRES });
  }
  async size(key: string) {
    try {
      const h = await this.s3.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET!, Key: key }));
      return h.ContentLength ?? null;
    } catch {
      return null;
    }
  }
}

/** Local stand-in with the same contract: signed, expiring URLs served by /files routes. */
export class LocalFileStore implements FileStore {
  readonly root = resolve(process.cwd(), config.LOCAL_FILE_DIR);
  async presignUpload({ key, contentType, maxBytes }: { key: string; contentType: string; maxBytes: number }): Promise<UploadTarget> {
    const token = await signFileToken({ op: 'put', key, contentType, maxBytes }, EXPIRES);
    return { method: 'PUT', url: `/api/files/upload?token=${token}`, headers: { 'content-type': contentType }, key, expiresIn: EXPIRES };
  }
  async presignDownload(key: string, fileName: string) {
    const token = await signFileToken({ op: 'get', key, fileName }, EXPIRES);
    return `/api/files/download?token=${token}`;
  }
  async size(key: string) {
    try {
      return (await stat(this.path(key))).size;
    } catch {
      return null;
    }
  }
  path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root)) throw new Error('invalid key');
    return p;
  }
  async put(token: string, contentType: string | undefined, body: ArrayBuffer) {
    const claims = await verifyFileToken(token);
    if (claims.op !== 'put') throw new Error('wrong op');
    if (contentType?.split(';')[0] !== claims.contentType) throw new Error('content type mismatch');
    if (body.byteLength === 0 || body.byteLength > Number(claims.maxBytes)) throw new Error('size out of range');
    const p = this.path(String(claims.key));
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, Buffer.from(body));
  }
  async get(token: string) {
    const claims = await verifyFileToken(token);
    if (claims.op !== 'get') throw new Error('wrong op');
    return { body: await readFile(this.path(String(claims.key))), fileName: String(claims.fileName) };
  }
}

export const fileStore: FileStore = config.FILE_STORE === 's3' ? new S3FileStore() : new LocalFileStore();

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
