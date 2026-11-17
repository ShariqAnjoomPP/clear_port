import { and, eq } from 'drizzle-orm';
import type { DocumentMetaInput } from '@clearport/contracts';
import { uuidv7 } from '@clearport/kernel';
import type { Q } from '../../lib/db';
import { notFound, unprocessable } from '../../lib/errors';
import { ALLOWED_CONTENT_TYPES, fileStore, MAX_UPLOAD_BYTES, safeFileName, sniffContentType } from '../../lib/files';
import { container, document } from '../../lib/schema';
import { requireJob, touchJob } from '../jobs/queries';

export type UploadedFile = { name: string; type: string; bytes: Uint8Array };

/** Stores a file for a job after checking its size and that its real content matches the declared type. */
export async function uploadDocument(q: Q, meta: DocumentMetaInput, file: UploadedFile, uploadedByName: string) {
  const j = await requireJob(q, meta.jobId);
  if (!file.bytes.byteLength) throw unprocessable('The file is empty');
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) throw unprocessable(`Files are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  const contentType = file.type.split(';')[0] ?? '';
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType)) throw unprocessable('Upload a PDF or a photo (JPEG, PNG, WebP, HEIC)');
  const sniffed = sniffContentType(file.bytes);
  if (sniffed && sniffed !== contentType) throw unprocessable('File content does not match its type');
  if (meta.containerId) {
    const [ct] = await q.select({ id: container.id }).from(container).where(and(eq(container.id, meta.containerId), eq(container.jobId, j.id)));
    if (!ct) throw unprocessable('Container is not on this job');
  }

  const id = uuidv7();
  const storageKey = `job/${j.id}/${id}/${safeFileName(file.name)}`;
  await fileStore.put(storageKey, file.bytes);
  const [row] = await q.insert(document).values({
    id, jobId: j.id, containerId: meta.containerId ?? null, stageInstanceId: meta.stageInstanceId ?? null, docType: meta.docType,
    fileName: file.name, contentType, sizeBytes: file.bytes.byteLength, storageKey, customerVisible: meta.customerVisible, uploadedByName,
    covers: meta.covers.filter((t) => t !== meta.docType), referenceNo: meta.referenceNo ?? null, issueDate: meta.issueDate ?? null,
  }).returning();
  await touchJob(q, j.id);
  return row!;
}

export async function getDocument(q: Q, id: string) {
  const [row] = await q.select().from(document).where(eq(document.id, id));
  if (!row) throw notFound('Document');
  return row;
}

export async function readDocument(q: Q, id: string) {
  const doc = await getDocument(q, id);
  return { doc, bytes: await fileStore.get(doc.storageKey) };
}

export async function setCustomerVisible(q: Q, id: string, customerVisible: boolean) {
  const [row] = await q.update(document).set({ customerVisible }).where(eq(document.id, id)).returning();
  if (!row) throw notFound('Document');
  return row;
}
