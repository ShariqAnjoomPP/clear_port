import type { ZodError } from 'zod';

/** RFC 9457 Problem Details. Thrown by handlers; rendered by the error middleware. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly detail?: string,
    public readonly errors?: { path?: string; code?: string; message: string }[],
    public readonly type: string = `https://clearport.app/problems/${title.toLowerCase().replace(/[^a-z]+/g, '-')}`,
  ) {
    super(detail ?? title);
  }
}

export const badRequest = (detail: string, errors?: ApiError['errors']) => new ApiError(400, 'Bad request', detail, errors);
export const unauthorized = (detail = 'Authentication required') => new ApiError(401, 'Unauthorized', detail);
export const forbidden = (detail = 'You do not have permission for this action') => new ApiError(403, 'Forbidden', detail);
/** Cross-tenant and out-of-scope access returns 404, never 403, so ids cannot be probed. */
export const notFound = (what = 'Resource') => new ApiError(404, 'Not found', `${what} not found`);
export const conflict = (detail: string, errors?: ApiError['errors']) => new ApiError(409, 'Conflict', detail, errors);
export const preconditionFailed = (detail = 'The record was changed by someone else. Reload and try again.') =>
  new ApiError(412, 'Precondition failed', detail);
export const unprocessable = (detail: string, errors?: ApiError['errors']) => new ApiError(422, 'Unprocessable', detail, errors);

export const fromZod = (e: ZodError) =>
  badRequest(
    'The request is invalid',
    e.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message })),
  );

/** Postgres unique violation → 409 with a friendly message. */
export function fromPg(e: unknown): ApiError | undefined {
  const pgErr = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = pgErr.code ?? pgErr.cause?.code;
  const constraint = pgErr.constraint ?? pgErr.cause?.constraint ?? '';
  if (code === '23505') {
    const messages: Record<string, string> = {
      job_tenant_id_bl_no_key: 'A job with this BL number already exists',
      container_open_uq: 'One of these containers is already on another open job',
      customer_code_uq: 'A customer with this customs code already exists',
      app_user_email_uq: 'A user with this email already exists',
      vehicle_tenant_id_plate_no_key: 'A vehicle with this plate number already exists',
      master_item_tenant_id_kind_code_key: 'This code already exists',
    };
    return conflict(messages[constraint] ?? 'This record already exists');
  }
  if (code === '23503') return unprocessable('A referenced record does not exist');
  return undefined;
}
