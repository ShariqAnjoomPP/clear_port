/** RFC 9457 problem from the API, thrown by every call so screens can show the server's exact reasons. */
export class ApiProblem extends Error {
  status: number;
  title: string;
  detail?: string;
  errors: { path?: string; code?: string; message: string }[];
  requestId?: string;
  constructor(p: { status: number; title: string; detail?: string; errors?: ApiProblem['errors']; requestId?: string }) {
    super(p.detail ?? p.title);
    this.status = p.status;
    this.title = p.title;
    this.detail = p.detail;
    this.errors = p.errors ?? [];
    this.requestId = p.requestId;
  }
}

export const isNetworkError = (e: unknown) => e instanceof TypeError;

export interface RequestOptions {
  ifMatch?: number;
  /** Extra request headers (e.g. the tracking page's x-track-token). */
  headers?: Record<string, string>;
}

/** Calls a backend function: every path is /api/<function>/... (same path locally and behind API Gateway). */
export async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    let p: ConstructorParameters<typeof ApiProblem>[0];
    try {
      p = await res.json();
    } catch {
      p = { status: res.status, title: res.statusText };
    }
    // Signed out (or the session expired): staff calls go to the sign-in page, then come back here.
    if (res.status === 401 && !path.startsWith('/public/') && !path.startsWith('/session/login') && !window.location.pathname.startsWith('/login')) {
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
    throw new ApiProblem({ ...p, status: res.status });
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body ?? {}, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, body ?? {}, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body ?? {}, opts),
  del: <T>(path: string) => request<T>('DELETE', path, {}),
};

/** Down-scales large photos on the device before upload (field networks are slow). */
async function compressImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600_000) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.75));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file;
}

export type DocumentRow = { id: string; docType: string; fileName: string; contentType: string; sizeBytes: number; customerVisible: boolean; createdAt: string; uploadedByName: string | null; containerId: string | null };

/** Uploads a file for a job to the documents function (multipart). Large photos are shrunk on the device first. */
export async function uploadDocument(jobId: string, original: File, docType: string, extra: { containerId?: string; stageInstanceId?: string; customerVisible?: boolean; covers?: string[]; referenceNo?: string; issueDate?: string } = {}) {
  const file = await compressImage(original);
  const contentType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
  const form = new FormData();
  form.set('jobId', jobId);
  form.set('docType', docType);
  if (extra.containerId) form.set('containerId', extra.containerId);
  if (extra.stageInstanceId) form.set('stageInstanceId', extra.stageInstanceId);
  form.set('customerVisible', String(!!extra.customerVisible));
  // A scanned pack: the other documents inside the same file.
  if (extra.covers?.length) form.set('covers', extra.covers.join(','));
  if (extra.referenceNo) form.set('referenceNo', extra.referenceNo);
  if (extra.issueDate) form.set('issueDate', extra.issueDate);
  form.set('file', new File([file], file.name, { type: contentType }));
  const res = await fetch('/api/documents', { method: 'POST', body: form });
  if (!res.ok) {
    const p = await res.json().catch(() => ({ title: 'Upload failed', detail: 'The file could not be uploaded' }));
    throw new ApiProblem({ ...p, status: res.status });
  }
  return (await res.json()) as DocumentRow;
}

export function openDocument(id: string) {
  window.open(`/api/documents/${id}/file`, '_blank', 'noopener');
}
