import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Pencil, Plus, Snowflake, Trash2 } from 'lucide-react';
import { FREE_TIME_BASES, INCOTERMS, PACKAGE_KINDS, REEFER_TYPES, SERVICE_TYPES } from '@clearport/contracts';
import { api } from '../lib/api';
import { fmtDate, fmtMoney, humanize } from '../lib/format';
import { useMaster } from '../lib/hooks';
import { Button, Card, Field, Input, Modal, ProblemAlert, Select, Textarea } from './ui';
import type { CargoLine, JobDetail } from './types';

const kg = (v: number | string | null) => (v === null || v === '' ? '—' : `${Number(v).toLocaleString('en', { maximumFractionDigits: 2 })} kg`);
const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

/** Free time as the B/L words it: "9 days combined (detention + demurrage)". */
export function freeTimeText(j: Pick<JobDetail, 'freeTimeDays' | 'freeTimeBasis'>) {
  if (j.freeTimeDays === null) return '';
  const basis = j.freeTimeBasis === 'COMBINED' ? 'combined' : humanize(j.freeTimeBasis).toLowerCase();
  return `${j.freeTimeDays} days ${basis}`;
}

/** The goods on the B/L (lines with HS codes, packages and weights), their totals, and every other B/L field. */
export function CargoTab({ j, onChanged }: { j: JobDetail; onChanged: () => void }) {
  const [editing, setEditing] = useState<CargoLine | 'new' | null>(null);
  const [editBl, setEditBl] = useState(false);
  const open = j.status === 'OPEN';
  const boxNo = (id: string | null) => (id ? j.containers.find((c) => c.id === id)?.containerNo : undefined);
  const t = j.cargoTotals;
  const reefers = j.containers.filter((c) => REEFER_TYPES.includes(c.sizeType));
  return (
    <div className="space-y-4">
      <Card title={`Goods · ${j.cargoLines.length} line${j.cargoLines.length === 1 ? '' : 's'}`} actions={open && <Button size="sm" variant="tonal" onClick={() => setEditing('new')}><Plus className="size-4" /> Add line</Button>}>
        {!j.cargoLines.length ? (
          <p className="text-sm text-on-surface-variant">No goods lines yet. The commodity on file is “{j.commodity}”. Add the lines from the B/L or packing list.</p>
        ) : (
          <ul className="divide-y divide-outline-variant/50">
            {j.cargoLines.map((l) => (
              <li key={l.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.description}</p>
                  <p className="text-sm text-on-surface-variant">
                    {[l.hsCode && `HS ${l.hsCode}`, l.packages && `${l.packages.toLocaleString('en')} ${humanize(l.packageKind ?? 'PIECE').toLowerCase()}s`, l.originCountry].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <p className="text-sm tabular-nums text-on-surface-variant">
                    {kg(l.netWeightKg)} net · {kg(l.grossWeightKg)} gross{boxNo(l.containerId) && <span className="ms-1 font-mono text-xs">· {boxNo(l.containerId)}</span>}
                  </p>
                </div>
                {open && <Button size="sm" variant="ghost" onClick={() => setEditing(l)} aria-label={`Edit ${l.description}`}><Pencil className="size-4" /></Button>}
              </li>
            ))}
          </ul>
        )}
        {j.cargoLines.length > 0 && (
          <div className="mt-3 rounded-xl bg-surface-container px-3 py-2 text-sm tabular-nums">
            Total: {t.packages.toLocaleString('en')} packages · {kg(t.netWeightKg)} net · {kg(t.grossWeightKg)} gross{t.volumeCbm ? ` · ${t.volumeCbm} CBM` : ''}
          </div>
        )}
        {t.warnings.map((w) => (
          <p key={w} className="mt-2 flex items-start gap-2 rounded-xl bg-warning-container px-3 py-2 text-sm text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w}. Check against the B/L.</p>
        ))}
      </Card>

      {reefers.length > 0 && (
        <Card title={<span className="flex items-center gap-2"><Snowflake className="size-4" /> Reefer settings</span>}>
          <ul className="space-y-1 text-sm">
            {reefers.map((c) => (
              <li key={c.id}><span className="font-mono font-medium">{c.containerNo}</span> <span className="text-on-surface-variant">· set {c.reeferTempC ?? '—'} °C{c.ventilation ? ` · vent ${c.ventilation}` : ''}</span></li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="B/L details" actions={open && <Button size="sm" variant="ghost" onClick={() => setEditBl(true)}><Pencil className="size-4" /> Edit</Button>}>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
          <Row label="Shipper" value={j.shipper} multiline />
          <Row label="Consignee" value={[j.customer?.name, j.customer?.address].filter(Boolean).join('\n')} multiline />
          <Row label="Notify party" value={j.notifyParty} multiline />
          <Row label="Booking no." value={j.bookingNo} mono />
          <Row label="Service contract" value={j.serviceContract} />
          <Row label="Freight" value={[j.freightTerms && humanize(j.freightTerms), j.serviceType].filter(Boolean).join(' · ')} />
          <Row label="Free time" value={freeTimeText(j)} />
          <Row label="Place of receipt" value={j.placeOfReceipt} />
          <Row label="Place of delivery" value={j.placeOfDelivery} />
          <Row label="Issued" value={[j.placeOfIssue, j.blIssueDate && fmtDate(j.blIssueDate)].filter(Boolean).join(', ')} />
          <Row label="Shipped on board" value={j.shippedOnBoardDate && fmtDate(j.shippedOnBoardDate)} />
          <Row label="Original B/Ls" value={j.originalsCount !== null ? String(j.originalsCount) : ''} />
          <Row label="ATA" value={j.ata && fmtDate(j.ata)} />
          <Row label="Commercial invoice" value={[j.invoiceNo, j.invoiceDate && fmtDate(j.invoiceDate)].filter(Boolean).join(' · ')} />
          <Row label="Invoice value" value={j.invoiceValue ? `${fmtMoney(j.invoiceValue, j.invoiceCurrency ?? 'USD')}${j.incoterm ? ` ${j.incoterm}` : ''}` : ''} />
          <Row label="Origin" value={j.countryOfOrigin} />
        </dl>
      </Card>

      {editing && <CargoLineModal j={j} line={editing === 'new' ? null : editing} onClose={() => { setEditing(null); onChanged(); }} />}
      {editBl && <BlDetailsModal j={j} onClose={() => { setEditBl(false); onChanged(); }} />}
    </div>
  );
}

function Row({ label, value, mono, multiline }: { label: string; value: string | null | undefined | false; mono?: boolean; multiline?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-on-surface-variant">{label}</dt>
      <dd className={`font-medium ${mono ? 'font-mono' : ''} ${multiline ? 'whitespace-pre-line break-words' : 'truncate'}`}>{value || '—'}</dd>
    </div>
  );
}

function CargoLineModal({ j, line, onClose }: { j: JobDetail; line: CargoLine | null; onClose: () => void }) {
  const [f, setF] = useState({
    description: line?.description ?? '', hsCode: line?.hsCode ?? '', packages: line?.packages?.toString() ?? '', packageKind: line?.packageKind ?? 'CARTON',
    netWeightKg: line?.netWeightKg ?? '', grossWeightKg: line?.grossWeightKg ?? '', containerNo: j.containers.find((c) => c.id === line?.containerId)?.containerNo ?? '',
    originCountry: line?.originCountry ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const body = () => ({
    description: f.description, hsCode: f.hsCode, packages: num(f.packages), packageKind: f.packages ? f.packageKind : undefined,
    netWeightKg: num(f.netWeightKg), grossWeightKg: num(f.grossWeightKg), containerNo: f.containerNo || undefined, originCountry: f.originCountry,
  });
  const save = useMutation({ mutationFn: () => (line ? api.patch(`/jobs/${j.id}/cargo-lines/${line.id}`, body()) : api.post(`/jobs/${j.id}/cargo-lines`, body())), onSuccess: onClose });
  const remove = useMutation({ mutationFn: () => api.del(`/jobs/${j.id}/cargo-lines/${line!.id}`), onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={line ? `Goods line ${line.lineNo}` : 'Add goods line'} footer={
      <>
        {line && <Button variant="ghost" className="me-auto text-error" loading={remove.isPending} onClick={() => remove.mutate()}><Trash2 className="size-4" /> Remove</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={f.description.trim().length < 2} onClick={() => save.mutate()}>Save</Button>
      </>
    }>
      <div className="space-y-3">
        <Field label="Description" required><Input value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="HS code"><Input inputMode="numeric" className="font-mono" value={f.hsCode} onChange={(e) => set('hsCode', e.target.value.replace(/[^\d]/g, ''))} /></Field>
          <Field label="Container"><Select value={f.containerNo} onChange={(e) => set('containerNo', e.target.value)}><option value="">—</option>{j.containers.map((c) => <option key={c.id}>{c.containerNo}</option>)}</Select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Packages"><Input inputMode="numeric" value={f.packages} onChange={(e) => set('packages', e.target.value)} /></Field>
          <Field label="Kind"><Select value={f.packageKind} onChange={(e) => set('packageKind', e.target.value)}>{PACKAGE_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</Select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Net weight (kg)"><Input inputMode="decimal" value={f.netWeightKg} onChange={(e) => set('netWeightKg', e.target.value)} /></Field>
          <Field label="Gross weight (kg)"><Input inputMode="decimal" value={f.grossWeightKg} onChange={(e) => set('grossWeightKg', e.target.value)} /></Field>
        </div>
        <Field label="Origin"><Input value={f.originCountry} onChange={(e) => set('originCountry', e.target.value)} /></Field>
        <ProblemAlert error={save.error ?? remove.error} />
      </div>
    </Modal>
  );
}

/** Edit the B/L fields after the job is open, including the actual arrival (ATA), which restarts the free-time count. */
function BlDetailsModal({ j, onClose }: { j: JobDetail; onClose: () => void }) {
  const lines = useMaster('SHIPPING_LINE');
  const s = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  const [f, setF] = useState({
    shipper: s(j.shipper), notifyParty: s(j.notifyParty), bookingNo: s(j.bookingNo), serviceContract: s(j.serviceContract), shippingLineCode: s(j.shippingLineCode),
    vessel: s(j.vessel), voyage: s(j.voyage), eta: j.eta, ata: s(j.ata), freightTerms: s(j.freightTerms), serviceType: s(j.serviceType),
    freeTimeDays: s(j.freeTimeDays), freeTimeBasis: j.freeTimeBasis, placeOfReceipt: s(j.placeOfReceipt), placeOfDelivery: s(j.placeOfDelivery), placeOfIssue: s(j.placeOfIssue),
    blIssueDate: s(j.blIssueDate), shippedOnBoardDate: s(j.shippedOnBoardDate), originalsCount: s(j.originalsCount),
    invoiceNo: s(j.invoiceNo), invoiceDate: s(j.invoiceDate), invoiceValue: s(j.invoiceValue), invoiceCurrency: s(j.invoiceCurrency) || 'USD', incoterm: s(j.incoterm), countryOfOrigin: s(j.countryOfOrigin),
  });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const save = useMutation({
    mutationFn: () => api.patch(`/jobs/${j.id}`, {
      ...Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== '' && !['ata', 'freeTimeDays', 'originalsCount', 'invoiceValue', 'invoiceCurrency'].includes(k))),
      ata: f.ata || null, freeTimeDays: num(f.freeTimeDays), originalsCount: num(f.originalsCount),
      invoiceValue: f.invoiceValue ? f.invoiceValue.replace(/,/g, '') : undefined, invoiceCurrency: f.invoiceValue ? f.invoiceCurrency : undefined,
    }),
    onSuccess: onClose,
  });
  return (
    <Modal open onClose={onClose} title="B/L details" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="ETA"><Input type="date" value={f.eta} onChange={(e) => set('eta', e.target.value)} /></Field>
          <Field label="ATA (arrived)" hint="Free time counts from here"><Input type="date" value={f.ata} onChange={(e) => set('ata', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Free days"><Input inputMode="numeric" value={f.freeTimeDays} onChange={(e) => set('freeTimeDays', e.target.value)} /></Field>
          <Field label="Free time covers"><Select value={f.freeTimeBasis} onChange={(e) => set('freeTimeBasis', e.target.value)}>{FREE_TIME_BASES.map((b) => <option key={b} value={b}>{b === 'COMBINED' ? 'Detention + demurrage' : humanize(b)}</option>)}</Select></Field>
        </div>
        <Field label="Shipper"><Textarea rows={3} value={f.shipper} onChange={(e) => set('shipper', e.target.value)} /></Field>
        <Field label="Notify party"><Textarea rows={2} value={f.notifyParty} onChange={(e) => set('notifyParty', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Shipping line"><Select value={f.shippingLineCode} onChange={(e) => set('shippingLineCode', e.target.value)}><option value="">—</option>{(lines.data ?? []).map((m) => <option key={m.code} value={m.code}>{m.name} ({m.code})</option>)}</Select></Field>
          <Field label="Booking no."><Input className="font-mono" value={f.bookingNo} onChange={(e) => set('bookingNo', e.target.value.toUpperCase())} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vessel"><Input value={f.vessel} onChange={(e) => set('vessel', e.target.value.toUpperCase())} /></Field>
          <Field label="Voyage"><Input value={f.voyage} onChange={(e) => set('voyage', e.target.value.toUpperCase())} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Freight"><Select value={f.freightTerms} onChange={(e) => set('freightTerms', e.target.value)}><option value="">—</option><option value="PREPAID">Prepaid</option><option value="COLLECT">Collect</option></Select></Field>
          <Field label="Service"><Select value={f.serviceType} onChange={(e) => set('serviceType', e.target.value)}><option value="">—</option>{SERVICE_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Service contract"><Input value={f.serviceContract} onChange={(e) => set('serviceContract', e.target.value)} /></Field>
          <Field label="Original B/Ls"><Input inputMode="numeric" value={f.originalsCount} onChange={(e) => set('originalsCount', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="B/L issue date"><Input type="date" value={f.blIssueDate} onChange={(e) => set('blIssueDate', e.target.value)} /></Field>
          <Field label="Shipped on board"><Input type="date" value={f.shippedOnBoardDate} onChange={(e) => set('shippedOnBoardDate', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Place of receipt"><Input value={f.placeOfReceipt} onChange={(e) => set('placeOfReceipt', e.target.value)} /></Field>
          <Field label="Place of delivery"><Input value={f.placeOfDelivery} onChange={(e) => set('placeOfDelivery', e.target.value)} /></Field>
        </div>
        <Field label="Place of issue"><Input value={f.placeOfIssue} onChange={(e) => set('placeOfIssue', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Invoice no."><Input className="font-mono" value={f.invoiceNo} onChange={(e) => set('invoiceNo', e.target.value.toUpperCase())} /></Field>
          <Field label="Invoice date"><Input type="date" value={f.invoiceDate} onChange={(e) => set('invoiceDate', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-[1fr_5.5rem] gap-3">
          <Field label="Invoice value"><Input inputMode="decimal" value={f.invoiceValue} onChange={(e) => set('invoiceValue', e.target.value)} /></Field>
          <Field label="Currency"><Input maxLength={3} value={f.invoiceCurrency} onChange={(e) => set('invoiceCurrency', e.target.value.toUpperCase())} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Incoterm"><Select value={f.incoterm} onChange={(e) => set('incoterm', e.target.value)}><option value="">—</option>{INCOTERMS.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Origin"><Input value={f.countryOfOrigin} onChange={(e) => set('countryOfOrigin', e.target.value)} /></Field>
        </div>
        <ProblemAlert error={save.error} />
      </div>
    </Modal>
  );
}

