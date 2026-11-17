import i18n from './i18n';

const locale = () => (i18n.language === 'ar' ? 'ar-OM' : 'en-GB');

/** The agency's currency (Company settings), set once the session loads. Amounts default to it. */
let baseCurrency = 'OMR';
export const setBaseCurrency = (c: string) => { baseCurrency = c; };
export const currencyCode = () => baseCurrency;

export function fmtDate(v: string | Date | null | undefined) {
  if (!v) return '—';
  const d = typeof v === 'string' && v.length === 10 ? new Date(`${v}T00:00:00`) : new Date(v);
  return new Intl.DateTimeFormat(locale(), { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}
export function fmtDateTime(v: string | Date | null | undefined) {
  if (!v) return '—';
  return new Intl.DateTimeFormat(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(v));
}
export function fmtMoney(amount: string | number | null | undefined, currency = baseCurrency) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const digits = ['KWD', 'BHD', 'OMR'].includes(currency) ? 3 : 2;
  return new Intl.NumberFormat(locale(), { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(amount));
}
/** Money without decimals, for headline tiles where space is tight. */
export function fmtMoneyWhole(amount: string | number | null | undefined, currency = baseCurrency) {
  if (amount === null || amount === undefined || amount === '') return '—';
  return new Intl.NumberFormat(locale(), { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount));
}
export function relative(v: string | Date | null | undefined) {
  if (!v) return '';
  const diff = new Date(v).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86400_000) return rtf.format(Math.round(diff / 3600_000), 'hour');
  return rtf.format(Math.round(diff / 86400_000), 'day');
}
export const daysUntil = (date: string | null | undefined) => (date ? Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86400_000) : null);
export const humanize = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
