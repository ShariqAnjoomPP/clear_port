import clsx from 'clsx';
import { Check } from 'lucide-react';

/** People-facing names for document types. */
export const DOC_LABELS: Record<string, string> = {
  BILL_OF_LADING: 'Bill of lading', COMMERCIAL_INVOICE: 'Commercial invoice', PACKING_LIST: 'Packing list', CERTIFICATE_OF_ORIGIN: 'Certificate of origin',
  PHYTOSANITARY_CERTIFICATE: 'Phytosanitary certificate', BAYAN_COPY: 'Bayan copy', DO_COPY: 'Delivery order', CCRO_COPY: 'Port release copy',
  RECEIPT: 'Receipt', INSPECTION_PHOTO: 'Inspection photo', POD: 'Proof of delivery', OTHER: 'Other',
};
export const docLabel = (t: string) => DOC_LABELS[t] ?? t.replace(/_/g, ' ').toLowerCase();

/** What a shipper's scanned pack usually holds besides the B/L (e.g. the Maersk/KDN pack: invoice, packing list, origin, phyto). */
export const PACK_TYPES = ['BILL_OF_LADING', 'COMMERCIAL_INVOICE', 'PACKING_LIST', 'CERTIFICATE_OF_ORIGIN', 'PHYTOSANITARY_CERTIFICATE'] as const;

/** "This file also contains": chips to tick the other documents inside one scanned PDF. */
export function PackPicker({ main, value, onChange }: { main: string; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-on-surface-variant">This file also contains</p>
      <div className="flex flex-wrap gap-2">
        {PACK_TYPES.filter((t) => t !== main).map((t) => {
          const on = value.includes(t);
          return (
            <button key={t} type="button" aria-pressed={on} onClick={() => toggle(t)}
              className={clsx('inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm', on ? 'border-transparent bg-secondary-container text-on-secondary-container' : 'border-outline text-on-surface-variant')}>
              {on && <Check className="size-4" />} {docLabel(t)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
