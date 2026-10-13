import { uuidv7 } from '@clearport/kernel';

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

export type SessionUser = { id: string; name: string; email: string; roles: string[]; customerId: string | null; locale: string; tenantName?: string };

// Access token lives only in memory (never localStorage); the refresh token is an HttpOnly cookie.
let accessToken: string | null = null;
let refreshing: Promise<SessionUser | null> | null = null;
const listeners = new Set<(u: SessionUser | null) => void>();
export const onSessionChange = (fn: (u: SessionUser | null) => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export function setSession(token: string | null, user: SessionUser | null) {
  accessToken = token;
  listeners.forEach((l) => l(user));
}

export function refreshSession(): Promise<SessionUser | null> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) return null;
      const d = (await r.json()) as { accessToken: string; user: SessionUser };
      setSession(d.accessToken, d.user);
      return d.user;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export interface RequestOptions {
  idempotencyKey?: string;
  ifMatch?: number;
  retry?: boolean;
}

export async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (method !== 'GET') headers['idempotency-key'] = opts.idempotencyKey ?? uuidv7();
  if (opts.ifMatch !== undefined) headers['if-match'] = `"${opts.ifMatch}"`;
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'include' });
  if (res.status === 401 && path.startsWith('/v1') && opts.retry !== false) {
    if (await refreshSession()) return request<T>(method, path, body, { ...opts, retry: false });
    setSession(null, null);
  }
  if (!res.ok) {
    let p: ConstructorParameters<typeof ApiProblem>[0];
    try {
      p = await res.json();
    } catch {
      p = { status: res.status, title: res.statusText };
    }
    throw new ApiProblem({ ...p, status: res.status });
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
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

type UploadTarget = { method: 'POST' | 'PUT'; url: string; fields?: Record<string, string>; headers?: Record<string, string>; key: string };
export type DocumentRow = { id: string; docType: string; fileName: string; contentType: string; sizeBytes: number; customerVisible: boolean; createdAt: string; uploadedByName: string | null; containerId: string | null };

/** Presigned upload straight to storage, then register the document with the API. */
export async function uploadDocument(jobId: string, original: File, docType: string, extra: { containerId?: string; stageInstanceId?: string; customerVisible?: boolean } = {}) {
  const file = await compressImage(original);
  const contentType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
  const target = await api.post<UploadTarget>(`/v1/clearance/jobs/${jobId}/documents/presign`, { fileName: file.name, contentType, sizeBytes: file.size });
  if (target.method === 'PUT') {
    const r = await fetch(target.url, { method: 'PUT', headers: target.headers, body: file });
    if (!r.ok) throw new ApiProblem({ status: r.status, title: 'Upload failed', detail: 'The file could not be uploaded' });
  } else {
    const fd = new FormData();
    Object.entries(target.fields ?? {}).forEach(([k, v]) => fd.append(k, v));
    fd.append('file', file);
    const r = await fetch(target.url, { method: 'POST', body: fd });
    if (!r.ok) throw new ApiProblem({ status: r.status, title: 'Upload failed', detail: 'The file could not be uploaded' });
  }
  return api.post<DocumentRow>(`/v1/clearance/jobs/${jobId}/documents`, { uploadKey: target.key, fileName: file.name, contentType, sizeBytes: file.size, docType, ...extra });
}

export async function openDocument(id: string) {
  const { url } = await api.get<{ url: string }>(`/v1/clearance/documents/${id}/download`);
  window.open(url, '_blank', 'noopener');
}
