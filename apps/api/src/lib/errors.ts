import type { ZodError } from 'zod';

/** RFC 9457 Problem Details. Thrown by services; rendered by the error handler in http.ts. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly detail?: string,
    public readonly errors?: { path?: string; code?: string; message: string }[],
  ) {
    super(detail ?? title);
  }
}

export const badRequest = (detail: string, errors?: ApiError['errors']) => new ApiError(400, 'Bad request', detail, errors);
export const notFound = (what = 'Resource') => new ApiError(404, 'Not found', `${what} not found`);
export const conflict = (detail: string, errors?: ApiError['errors']) => new ApiError(409, 'Conflict', detail, errors);
export const unprocessable = (detail: string, errors?: ApiError['errors']) => new ApiError(422, 'Unprocessable', detail, errors);

/** People-facing names for request fields, so errors say which field is wrong. Anything else is turned from camelCase into words. */
const FIELD_LABELS: Record<string, string> = {
  blNo: 'B/L number', eta: 'ETA', ata: 'ATA', commodity: 'Commodity', hsCodes: 'HS codes', vessel: 'Vessel', voyage: 'Voyage',
  shippingLineCode: 'Shipping line', portOfLoading: 'Port of loading', portOfDischarge: 'Port of discharge', terminal: 'Terminal',
  priority: 'Priority', coordinatorId: 'Coordinator', customerId: 'Customer', newCustomer: 'New customer', containers: 'Containers',
  containerNo: 'Container number', sizeType: 'Size / type', freeTimeExpiresAt: 'Free time end date', sealNo: 'Seal number',
  name: 'Name', contactName: 'Contact person', phone: 'Mobile', email: 'Email', customsCode: 'Customs code', tradeLicenceNo: 'Trade licence no.',
  creditLimit: 'Credit limit', creditDays: 'Credit days', tariff: 'Tariff', perBl: 'Fee per B/L', perContainer: 'Fee per container', vatPct: 'VAT %',
  markupPct: 'Markup %', referenceNo: 'Reference number', validUntil: 'Valid until', receiverName: 'Received by', podSignature: 'Signature',
  amount: 'Amount', feeType: 'Fee type', paymentMethod: 'Payment method', paidOn: 'Paid on', currency: 'Currency', reason: 'Reason',
  cargoLines: 'Goods lines', description: 'Description', hsCode: 'HS code', packages: 'Packages', packageKind: 'Package kind',
  netWeightKg: 'Net weight (kg)', grossWeightKg: 'Gross weight (kg)', volumeCbm: 'Volume (CBM)', originCountry: 'Origin', countryOfOrigin: 'Country of origin',
  reeferTempC: 'Reefer temperature (°C)', ventilation: 'Ventilation', bookingNo: 'Booking no.', serviceContract: 'Service contract', shipper: 'Shipper',
  notifyParty: 'Notify party', placeOfReceipt: 'Place of receipt', placeOfDelivery: 'Place of delivery', placeOfIssue: 'Place of issue',
  blIssueDate: 'B/L issue date', shippedOnBoardDate: 'Shipped on board', originalsCount: 'Original B/Ls', freightTerms: 'Freight', serviceType: 'Service',
  freeTimeDays: 'Free days', freeTimeBasis: 'Free time basis', invoiceNo: 'Invoice no.', invoiceDate: 'Invoice date', invoiceValue: 'Invoice value',
  invoiceCurrency: 'Invoice currency', incoterm: 'Incoterm', covers: 'Also contains', issueDate: 'Issue date',
  deliveryAddress: 'Delivery address', driverId: 'Driver', vehicleId: 'Vehicle', plateNo: 'Plate number', role: 'Role', disbursements: 'Payments',
};
/** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
const ordinal = (n: number) => {
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
};
const words = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());

/** "hsCodes.0" → "HS codes (1st)", "newCustomer.email" → "New customer · Email", "containers.2.containerNo" → "Containers (3rd) · Container number". */
export function fieldLabel(path: PropertyKey[]): string {
  const parts: string[] = [];
  for (const seg of path) {
    if (typeof seg === 'number') {
      if (parts.length) parts[parts.length - 1] += ` (${ordinal(seg + 1)})`;
    } else if (String(seg) !== 'fields') {
      parts.push(FIELD_LABELS[String(seg)] ?? words(String(seg)));
    }
  }
  return parts.join(' · ');
}

/** Zod's built-in wording ("Invalid input: expected string, received undefined") in plain words; our own schema messages pass through. */
function plainMessage(i: ZodError['issues'][number]): string {
  const raw = i.message;
  if (!/^(Invalid|Too (small|big)|Expected|Required)/.test(raw)) return raw;
  const d = i as unknown as { code: string; minimum?: number; maximum?: number; origin?: string; input?: unknown; values?: unknown[] };
  if (d.code === 'invalid_type') return d.input === undefined ? 'is required' : 'has the wrong type';
  if (d.code === 'too_small') return d.origin === 'array' ? `needs at least ${d.minimum}` : d.origin === 'string' ? (d.minimum === 1 ? 'is required' : `must be at least ${d.minimum} characters`) : `must be at least ${d.minimum}`;
  if (d.code === 'too_big') return d.origin === 'array' ? `allows at most ${d.maximum}` : d.origin === 'string' ? `must be at most ${d.maximum} characters` : `must be at most ${d.maximum}`;
  if (d.code === 'invalid_value' && d.values?.length) return `must be one of: ${d.values.join(', ')}`;
  if (d.code === 'invalid_format') return 'is not in the right format';
  return 'is not valid';
}

/** Validation failure: one line per problem, naming the field, e.g. "HS codes (1st): each HS code must be 4–12 digits, e.g. 8418". */
export const fromZod = (e: ZodError) =>
  badRequest('Please check these fields', e.issues.map((i) => {
    const label = fieldLabel(i.path);
    const msg = plainMessage(i);
    return { path: i.path.join('.'), code: i.code, message: label ? `${label}: ${msg}` : msg.replace(/^\w/, (c) => c.toUpperCase()) };
  }));

/** Postgres constraint violations → friendly 409/422. */
export function fromPg(e: unknown): ApiError | undefined {
  const pgErr = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = pgErr.code ?? pgErr.cause?.code;
  const constraint = pgErr.constraint ?? pgErr.cause?.constraint ?? '';
  if (code === '23505') {
    const messages: Record<string, string> = {
      job_bl_no_key: 'A job with this BL number already exists',
      container_open_uq: 'One of these containers is already on another open job',
      customer_code_uq: 'A customer with this customs code already exists',
      vehicle_plate_no_key: 'A vehicle with this plate number already exists',
      master_item_kind_code_key: 'This code already exists',
    };
    return conflict(messages[constraint] ?? 'This record already exists');
  }
  if (code === '23503') return unprocessable('A referenced record does not exist');
  return undefined;
}
