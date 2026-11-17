import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Eye, EyeOff, FileText, Lock, MessageSquare, Plus, Receipt, Snowflake, Truck, Upload } from 'lucide-react';
import { DOCUMENT_TYPES, REEFER_TYPES } from '@clearport/contracts';
import { api, openDocument, uploadDocument } from '../lib/api';
import { currencyCode, daysUntil, fmtDate, fmtDateTime, fmtMoney, humanize } from '../lib/format';
import { useMaster, useStaff } from '../lib/hooks';
import { L } from '../lib/i18n';
import { AssignTripModal } from '../components/AssignTrip';
import { OutboundList } from './Notifications';
import { StageCard } from '../components/StageCard';
import { CargoTab, freeTimeText } from '../components/CargoTab';
import { ShareTracking } from '../components/ShareTracking';
import { docLabel, PackPicker } from '../components/DocPack';
import { JobRoadmap, RoadStepDetail, useRoadSelection } from '../components/JobRoadmap';
import { PriorityBadge, StageStatus } from '../components/StatusBadge';
import { Badge, Button, Card, Field, Input, Modal, ProblemAlert, Select, Spinner, Table, Tabs, Textarea } from '../components/ui';
import type { JobDetail, NextStep, StageView } from '../components/types';

type Tab = 'workflow' | 'cargo' | 'containers' | 'documents' | 'payments' | 'trips' | 'timeline';

export function JobDetailPage() {
  const { jobId } = useParams({ strict: false }) as { jobId: string };
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('workflow');
  const job = useQuery({ queryKey: ['job', jobId], queryFn: () => api.get<JobDetail>(`/jobs/${jobId}`) });
  const [step, setStep] = useRoadSelection(job.data);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['job', jobId] });
    void qc.invalidateQueries({ queryKey: ['timeline', jobId] });
    void qc.invalidateQueries({ queryKey: ['jobs'] });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
  };
  const close = useMutation({ mutationFn: () => api.post(`/jobs/${jobId}/close`), onSuccess: refresh });
  const [reopen, setReopen] = useState(false);

  if (job.isLoading) return <Spinner />;
  if (job.error || !job.data) return <ProblemAlert error={job.error} />;
  const j = job.data;
  const conts = j.containers.map((c) => ({ id: c.id, containerNo: c.containerNo }));
  const delivered = j.containers.filter((c) => j.stages.containerStages[c.id]?.find((s) => s.key === 'DELIVERY')?.done).length;
  const freeEnds = j.containers.map((c) => c.freeTimeExpiresAt).filter((d): d is string => !!d).sort()[0];

  return (
    <>
      {/* Header card: what this job is and where it stands */}
      <section className="mt-2 rounded-[var(--radius-card)] bg-secondary-container p-4 text-on-secondary-container">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium opacity-80">{j.jobNo}</p>
            <h1 className="truncate font-mono text-2xl font-semibold">{j.blNo}</h1>
            {j.customer && <Link to="/customers/$customerId" params={{ customerId: j.customer.id }} className="block truncate text-sm font-medium underline-offset-2 hover:underline">{j.customer.name}</Link>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge tone={j.status === 'OPEN' ? 'info' : 'neutral'}>{j.status === 'OPEN' ? 'Open' : 'Closed'}</Badge>
            <PriorityBadge p={j.priority} />
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          {/* Only the fields that have values: a new job shouldn't be a wall of dashes */}
          {([
            ['Shipper', j.shipper?.split('\n')[0] ?? ''],
            ['Commodity', j.commodity],
            [j.ata ? 'Arrived' : 'ETA', fmtDate(j.ata ?? j.eta)],
            ['Containers', `${delivered}/${j.containers.length} delivered`],
            ['Vessel / voyage', [j.vessel, j.voyage].filter(Boolean).join(' / ')],
            ['Route', j.portOfLoading || j.portOfDischarge ? `${j.portOfLoading ?? '—'} → ${j.portOfDischarge ?? '—'}` : ''],
            ['Line · terminal', [j.shippingLineCode, j.terminal].filter(Boolean).join(' · ')],
            ['Freight', [j.freightTerms && humanize(j.freightTerms), j.serviceType].filter(Boolean).join(' · ')],
            ['Free time', [j.freeTimeDays !== null && `${j.freeTimeDays} days`, freeEnds && `ends ${fmtDate(freeEnds).replace(/ \d{4}$/, '')}`].filter(Boolean).join(' · ')],
            ['Coordinator', j.coordinator?.name ?? ''],
            ['HS codes', j.hsCodes.join(', ')],
          ] as const).filter(([, v]) => v).map(([label, v]) => <Info key={label} label={label} value={v} />)}
        </dl>
      </section>

      <div className="mt-3 rounded-[var(--radius-card)] bg-surface-container-lowest px-4 ring-1 ring-outline-variant/60">
        <JobRoadmap j={j} selected={step} onSelect={(k) => { setStep(k); setTab('workflow'); }} />
      </div>

      {j.status === 'OPEN' && <div className="mt-3"><ShareTracking blNo={j.blNo} /></div>}

      <div className="mt-3 flex gap-2">
        {/* Closing only makes sense once every container is delivered (the server still lists any remaining blockers) */}
        {j.status === 'OPEN' && j.containers.length > 0 && delivered === j.containers.length && <Button variant="secondary" onClick={() => close.mutate()} loading={close.isPending}><Lock className="size-4" /> {t('job.closeJob')}</Button>}
        {j.status === 'CLOSED' && <Button variant="tonal" onClick={() => setReopen(true)}>{t('job.reopen')}</Button>}
      </div>
      {close.error && <div className="mt-3"><ProblemAlert error={close.error} /></div>}

      <div className="mt-4" />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'workflow', label: 'Step details' },
          { value: 'cargo', label: 'Cargo', count: j.cargoLines.length },
          { value: 'containers', label: t('job.containers'), count: j.containers.length },
          { value: 'documents', label: t('job.documents'), count: j.documents.length },
          { value: 'payments', label: t('job.payments'), count: j.finance.payments.length },
          { value: 'trips', label: t('job.trips'), count: j.trips.length },
          { value: 'timeline', label: t('job.timeline') },
        ]}
      />
      <div className="mt-5">
        {tab === 'workflow' && <RoadStepDetail j={j} selected={step} onChanged={refresh} />}
        {tab === 'cargo' && <CargoTab j={j} onChanged={refresh} />}
        {tab === 'containers' && <ContainersTab j={j} onChanged={refresh} />}
        {tab === 'documents' && <DocumentsTab j={j} onChanged={refresh} />}
        {tab === 'payments' && <PaymentsTab j={j} onChanged={refresh} />}
        {tab === 'trips' && <TripsTab j={j} />}
        {tab === 'timeline' && <TimelineTab jobId={j.id} />}
      </div>
      {reopen && <ReopenModal jobId={j.id} onClose={() => { setReopen(false); refresh(); }} />}
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs opacity-75">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

function ContainersTab({ j, onChanged }: { j: JobDetail; onChanged: () => void }) {
  const conts = j.containers.map((c) => ({ id: c.id, containerNo: c.containerNo }));
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <ProblemAlert error={error} />
      {j.status === 'OPEN' && <div className="flex justify-end"><Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add containers</Button></div>}
      {j.containers.map((c) => {
        const free = daysUntil(c.freeTimeExpiresAt);
        const stages = j.stages.containerStages[c.id] ?? [];
        return (
          <Card
            key={c.id}
            title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{c.containerNo}</span><Badge>{c.sizeType}</Badge>{REEFER_TYPES.includes(c.sizeType) && <Badge tone="info"><Snowflake className="size-3.5" /> {c.reeferTempC ?? '—'} °C{c.ventilation ? ` · ${c.ventilation}` : ''}</Badge>}{c.sealNo && <span className="text-xs font-normal text-muted">seal {c.sealNo}</span>}</span>}
            actions={
              <label className="flex items-center gap-2 text-xs text-muted" title={c.freeTimeManual ? 'Typed by hand. Clear it to use the B/L free days.' : j.freeTimeDays !== null ? `From the B/L: ${freeTimeText(j)} from ${j.ata ? 'arrival' : 'ETA'}` : undefined}>
                Free time ends{!c.freeTimeManual && j.freeTimeDays !== null && <span className="rounded bg-surface-container px-1">B/L</span>}
                <Input
                  type="date"
                  className={clsx('h-8 w-40 text-xs', free !== null && free <= 1 && 'border-bad text-bad')}
                  key={c.freeTimeExpiresAt ?? ''}
                  defaultValue={c.freeTimeExpiresAt ?? ''}
                  disabled={j.status !== 'OPEN'}
                  onBlur={async (e) => {
                    if (e.target.value === (c.freeTimeExpiresAt ?? '')) return;
                    try {
                      await api.patch(`/jobs/${j.id}/containers/${c.id}`, { freeTimeExpiresAt: e.target.value || null });
                      onChanged();
                    } catch (err) {
                      setError(err);
                    }
                  }}
                />
              </label>
            }
          >
            {stages.length ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {stages.map((s) => <StageCard key={s.id} jobId={j.id} stage={s} canAssign={false} containers={conts} onChanged={onChanged} />)}
              </div>
            ) : <p className="text-sm text-muted">Waiting for port release. {[c.packages && `${c.packages} ${humanize(c.packageKind ?? 'PIECE').toLowerCase()}s`, c.grossWeightKg && `${Number(c.grossWeightKg).toLocaleString('en')} kg gross`, c.volumeCbm && `${Number(c.volumeCbm)} CBM`].filter(Boolean).join(' · ')}</p>}
          </Card>
        );
      })}
      {adding && <AddContainersModal jobId={j.id} onClose={() => { setAdding(false); onChanged(); }} />}
    </div>
  );
}

function AddContainersModal({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const save = useMutation({ mutationFn: () => api.post(`/jobs/${jobId}/containers`, { containers: text.split(/[\s,;]+/).filter(Boolean).map((containerNo) => ({ containerNo })) }), onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Add containers" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Add</Button></>}>
      <Field label="Container numbers" hint="One per line. Each must be 11 letters/digits, e.g. MSKU9070323."><Textarea className="font-mono" rows={5} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="mt-3"><ProblemAlert error={save.error} /></div>
    </Modal>
  );
}

function DocumentsTab({ j, onChanged }: { j: JobDetail; onChanged: () => void }) {
  const [docType, setDocType] = useState<string>('BILL_OF_LADING');
  const [containerId, setContainerId] = useState('');
  const [visible, setVisible] = useState(false);
  const [covers, setCovers] = useState<string[]>([]);
  const [referenceNo, setReferenceNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
      {(
        <Card title="Upload">
          <div className="space-y-3">
            <Field label="Document type"><Select value={docType} onChange={(e) => { setDocType(e.target.value); setCovers([]); }}>{DOCUMENT_TYPES.map((d) => <option key={d} value={d}>{docLabel(d)}</option>)}</Select></Field>
            <Field label="Reference no. (optional)" hint="e.g. invoice KDN/202608, phyto 149562/26/0201"><Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} /></Field>
            {(['BILL_OF_LADING', 'COMMERCIAL_INVOICE', 'PACKING_LIST', 'CERTIFICATE_OF_ORIGIN', 'PHYTOSANITARY_CERTIFICATE'] as string[]).includes(docType) && <PackPicker main={docType} value={covers} onChange={setCovers} />}
            <Field label="Container (optional)"><Select value={containerId} onChange={(e) => setContainerId(e.target.value)}><option value="">Whole BL</option>{j.containers.map((c) => <option key={c.id} value={c.id}>{c.containerNo}</option>)}</Select></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Visible to customer</label>
            <label className={clsx('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line p-6 text-sm text-muted hover:border-brand', busy && 'opacity-60')}>
              <Upload className="size-6" />
              {busy ? 'Uploading…' : 'Choose a PDF or photo (max 20 MB)'}
              <input
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setBusy(true);
                  setError(null);
                  try {
                    await uploadDocument(j.id, file, docType, { containerId: containerId || undefined, customerVisible: visible, covers, referenceNo: referenceNo || undefined });
                    setCovers([]);
                    setReferenceNo('');
                    onChanged();
                  } catch (err) {
                    setError(err);
                  } finally {
                    setBusy(false);
                    e.target.value = '';
                  }
                }}
              />
            </label>
            <ProblemAlert error={error} />
          </div>
        </Card>
      )}
      <Card padded={false} title="Documents">
        <Table>
          <thead><tr><th>Type</th><th>File</th><th>Uploaded</th><th>Customer</th></tr></thead>
          <tbody>
            {j.documents.map((d) => (
              <tr key={d.id}>
                <td>
                  <Badge>{docLabel(d.docType)}</Badge>
                  {d.covers.length > 0 && <p className="mt-1 text-xs text-muted">+ {d.covers.map(docLabel).join(', ')}</p>}
                  {d.referenceNo && <p className="mt-0.5 font-mono text-xs text-muted">{d.referenceNo}</p>}
                </td>
                <td><button className="inline-flex items-center gap-1.5 text-brand-2 hover:underline" onClick={() => void openDocument(d.id)}><FileText className="size-4" />{d.fileName}</button>{d.containerId && <span className="ms-2 font-mono text-xs text-muted">{j.containers.find((c) => c.id === d.containerId)?.containerNo}</span>}</td>
                <td className="text-muted">{fmtDateTime(d.createdAt)} · {d.uploadedByName}</td>
                <td>
                  <button
                    title="Toggle customer visibility"
                    className="rounded p-1 text-muted hover:text-ink"
                    onClick={async () => {
                      await api.patch(`/documents/${d.id}`, { customerVisible: !d.customerVisible });
                      onChanged();
                    }}
                  >
                    {d.customerVisible ? <Eye className="size-4 text-brand-2" /> : <EyeOff className="size-4" />}
                  </button>
                </td>
              </tr>
            ))}
            {!j.documents.length && <tr><td colSpan={4} className="py-8 text-center text-muted">No documents yet.</td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function PaymentsTab({ j, onChanged }: { j: JobDetail; onChanged: () => void }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const reconcile = useMutation({ mutationFn: (id: string) => api.post(`/finance/disbursements/${id}/reconcile`), onSuccess: onChanged });
  const invoice = useMutation({ mutationFn: () => api.post<{ id: string }>('/finance/invoices', { jobId: j.id }), onSuccess: () => { onChanged(); void qc.invalidateQueries({ queryKey: ['invoices'] }); } });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {j.finance.totals.map((t) => (
          <div key={t.currency} className="rounded-xl border border-line bg-white p-4">
            <p className="text-xs text-muted uppercase">Paid on behalf of customer</p>
            <p className="mt-1 text-2xl font-semibold tabular">{fmtMoney(t.paid, t.currency)}</p>
            <p className="text-xs text-muted">{fmtMoney(t.billable, t.currency)} billable · {t.unreconciled} unreconciled · {t.uninvoiced} not invoiced</p>
          </div>
        ))}
        <div className="flex flex-col justify-center gap-2 rounded-xl border border-line bg-white p-4">
          {j.status === 'OPEN' && <Button onClick={() => setAdding(true)}><Plus className="size-4" /> Record payment</Button>}
          {<Button variant="primary" onClick={() => invoice.mutate()} loading={invoice.isPending}><Receipt className="size-4" /> Generate invoice</Button>}
        </div>
      </div>
      <ProblemAlert error={invoice.error ?? reconcile.error} />
      {j.invoices.length > 0 && (
        <Card title="Invoices" padded={false}>
          <Table>
            <thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th className="text-end">Total</th></tr></thead>
            <tbody>{j.invoices.map((i) => <tr key={i.id}><td><Link to="/invoices/$invoiceId" params={{ invoiceId: i.id }} className="text-brand-2 hover:underline">{i.invoiceNo}</Link></td><td>{fmtDate(i.issueDate)}</td><td><Badge tone={i.status === 'PAID' ? 'ok' : i.status === 'VOID' ? 'neutral' : 'info'}>{i.status.toLowerCase()}</Badge></td><td className="text-end tabular">{fmtMoney(i.total, i.currency)}</td></tr>)}</tbody>
          </Table>
        </Card>
      )}
      <Card title="Payments ledger" padded={false}>
        {/* Phone: one row per payment */}
        <div className="divide-y divide-outline-variant/50 sm:hidden">
          {j.finance.payments.map((p) => (
            <div key={p.id} className={clsx('flex items-start justify-between gap-3 px-4 py-3', p.status === 'REVERSED' && 'opacity-60')}>
              <div className="min-w-0">
                <p className={clsx('truncate text-sm font-medium', p.status === 'REVERSED' && 'line-through')}>{humanize(p.feeType)}</p>
                <p className="truncate text-xs text-on-surface-variant">{fmtDate(p.paidOn)} · {p.paidByName} · {humanize(p.paymentMethod)}{p.stageKey ? ` · ${humanize(p.stageKey)}` : ''}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone={p.status === 'RECONCILED' ? 'ok' : p.status === 'REVERSED' ? 'neutral' : 'warn'}>{p.status.toLowerCase()}</Badge>
                  {p.invoiceId && <Badge tone="info">invoiced</Badge>}
                  {!p.billable && <Badge>not billable</Badge>}
                  {p.receiptDocumentId && <button onClick={() => void openDocument(p.receiptDocumentId!)} className="inline-flex items-center gap-1 text-xs font-medium text-primary"><Receipt className="size-3.5" /> Receipt</button>}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm font-semibold tabular">{fmtMoney(p.amount, p.currency)}</span>
                {p.status === 'RECORDED' && <Button size="sm" variant="tonal" onClick={() => reconcile.mutate(p.id)}>Reconcile</Button>}
              </div>
            </div>
          ))}
          {!j.finance.payments.length && <p className="px-4 py-8 text-center text-sm text-on-surface-variant">No payments recorded.</p>}
        </div>
        <Table className="hidden sm:block">
          <thead><tr><th>Date</th><th>Fee</th><th>Stage</th><th>Paid by</th><th>Method</th><th>Status</th><th className="text-end">Amount</th><th /></tr></thead>
          <tbody>
            {j.finance.payments.map((p) => (
              <tr key={p.id} className={clsx(p.status === 'REVERSED' && 'text-muted line-through')}>
                <td>{fmtDate(p.paidOn)}</td>
                <td>{humanize(p.feeType)}{p.receiptDocumentId && <button onClick={() => void openDocument(p.receiptDocumentId!)} className="ms-1 text-brand-2" title="Receipt"><Receipt className="inline size-3.5" /></button>}{!p.billable && <Badge className="ms-1">not billable</Badge>}</td>
                <td className="text-muted">{p.stageKey ? humanize(p.stageKey) : '—'}</td>
                <td>{p.paidByName}</td>
                <td className="text-muted">{humanize(p.paymentMethod)}</td>
                <td><Badge tone={p.status === 'RECONCILED' ? 'ok' : p.status === 'REVERSED' ? 'neutral' : 'warn'}>{p.status.toLowerCase()}</Badge>{p.invoiceId && <Badge tone="info" className="ms-1">invoiced</Badge>}</td>
                <td className="text-end tabular">{fmtMoney(p.amount, p.currency)}</td>
                <td>{p.status === 'RECORDED' && <Button size="sm" onClick={() => reconcile.mutate(p.id)}>Reconcile</Button>}</td>
              </tr>
            ))}
            {!j.finance.payments.length && <tr><td colSpan={8} className="py-8 text-center text-muted">No payments recorded.</td></tr>}
          </tbody>
        </Table>
      </Card>
      {adding && <AddPaymentModal jobId={j.id} onClose={() => { setAdding(false); onChanged(); }} />}
    </div>
  );
}

function AddPaymentModal({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const fees = useMaster('FEE_TYPE');
  const staff = useStaff();
  const [f, setF] = useState({ feeType: 'OTHER', amount: '', paymentMethod: 'CASH_FLOAT', description: '', billable: true, paidById: '' });
  const [receipt, setReceipt] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const receiptDocumentId = receipt ? (await uploadDocument(jobId, receipt, 'RECEIPT')).id : undefined;
      return api.post('/finance/disbursements', { jobId, ...f, paidById: f.paidById || undefined, currency: currencyCode(), paidOn: new Date().toISOString().slice(0, 10), receiptDocumentId, markupPct: 0 });
    },
    onSuccess: onClose,
  });
  return (
    <Modal open onClose={onClose} title="Record payment" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.amount} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Fee type"><Select value={f.feeType} onChange={(e) => setF({ ...f, feeType: e.target.value })}>{(fees.data ?? []).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</Select></Field>
        <Field label={`Amount (${currencyCode()})`} required><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Method"><Select value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })}><option value="CASH_FLOAT">PRO float (cash)</option><option value="COMPANY_CARD">Company card</option><option value="BANK_TRANSFER">Bank transfer</option><option value="ONLINE">Online</option></Select></Field>
        <Field label="Paid by"><Select value={f.paidById} onChange={(e) => setF({ ...f, paidById: e.target.value })}><option value="">Me</option>{(staff.data ?? []).filter((x) => x.role === 'PRO' || x.role === 'COORDINATOR' || x.role === 'ACCOUNTS').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        <Field label="Receipt"><Input type="file" accept="image/*,application/pdf" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} /></Field>
        <Field label="Description" className="sm:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Bill to customer</label>
      </div>
      <div className="mt-3"><ProblemAlert error={save.error} /></div>
    </Modal>
  );
}

function TripsTab({ j }: { j: JobDetail }) {
  const [assign, setAssign] = useState(false);
  const ready = j.containers.filter((c) => j.stages.containerStages[c.id]?.find((s) => s.key === 'TRUCK')?.status === 'UNASSIGNED');
  return (
    <div className="space-y-4">
      {j.status === 'OPEN' && (
        <div className="flex items-center justify-between rounded-xl border border-line bg-white p-4">
          <p className="text-sm text-muted">{ready.length ? `${ready.length} container(s) ready for a truck.` : 'No containers waiting for a truck.'}</p>
          <Button variant="primary" disabled={!ready.length} onClick={() => setAssign(true)}><Truck className="size-4" /> Assign truck</Button>
        </div>
      )}
      <Card padded={false} title="Trips">
        <div className="divide-y divide-outline-variant/50 sm:hidden">
          {j.trips.map((t) => (
            <div key={t.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{t.tripNo}</p>
                <Badge tone={t.status === 'COMPLETED' ? 'ok' : t.status === 'CANCELLED' ? 'neutral' : 'info'}>{humanize(t.status)}</Badge>
              </div>
              <p className="text-sm">{t.driverName}{t.driverPhone && <a href={`tel:${t.driverPhone}`} className="ms-1 text-primary">{t.driverPhone}</a>} · {t.plateNo}</p>
              <p className="font-mono text-xs text-on-surface-variant">{(t.containerIds ?? []).map((id) => j.containers.find((c) => c.id === id)?.containerNo).join(', ')}</p>
              <p className="text-xs text-on-surface-variant">{t.deliveryAddress}{t.deliveryWindow && ` · ${t.deliveryWindow}`}</p>
            </div>
          ))}
          {!j.trips.length && <p className="px-4 py-8 text-center text-sm text-on-surface-variant">No trips yet.</p>}
        </div>
        <Table className="hidden sm:block">
          <thead><tr><th>Trip</th><th>Driver</th><th>Vehicle</th><th>Containers</th><th>Deliver to</th><th>Status</th></tr></thead>
          <tbody>
            {j.trips.map((t) => (
              <tr key={t.id}>
                <td className="font-medium">{t.tripNo}</td>
                <td>{t.driverName}<p className="text-xs text-muted">{t.driverPhone ?? ''}</p></td>
                <td>{t.plateNo}</td>
                <td className="font-mono text-xs">{(t.containerIds ?? []).map((id) => j.containers.find((c) => c.id === id)?.containerNo).join(', ')}</td>
                <td className="text-muted">{t.deliveryAddress}{t.deliveryWindow && ` · ${t.deliveryWindow}`}</td>
                <td><Badge tone={t.status === 'COMPLETED' ? 'ok' : t.status === 'CANCELLED' ? 'neutral' : 'info'}>{humanize(t.status)}</Badge></td>
              </tr>
            ))}
            {!j.trips.length && <tr><td colSpan={6} className="py-8 text-center text-muted">No trips yet.</td></tr>}
          </tbody>
        </Table>
      </Card>
      {assign && <AssignTripModal jobId={j.id} containers={ready.map((c) => ({ id: c.id, containerNo: c.containerNo }))} onClose={() => setAssign(false)} />}
    </div>
  );
}

type TimelineItem = { at: string; kind: string; title: string; actor: string | null; remarks?: string | null; container?: string | null };
function TimelineTab({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [visible, setVisible] = useState(false);
  const items = useQuery({ queryKey: ['timeline', jobId], queryFn: () => api.get<{ items: TimelineItem[] }>(`/jobs/${jobId}/timeline`).then((r) => r.items) });
  const add = useMutation({
    mutationFn: () => api.post(`/jobs/${jobId}/comments`, { body, customerVisible: visible }),
    onSuccess: () => {
      setBody('');
      void qc.invalidateQueries({ queryKey: ['timeline', jobId] });
    },
  });
  const dot: Record<string, string> = { stage: 'bg-info', comment: 'bg-brand', document: 'bg-muted', payment: 'bg-warn', created: 'bg-ok' };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
      <Card padded>
        {items.isLoading ? <Spinner /> : (
          <ol className="relative space-y-4 border-s border-line ps-5">
            {(items.data ?? []).map((i, idx) => (
              <li key={idx} className="relative">
                <span className={clsx('absolute -start-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-white', dot[i.kind] ?? 'bg-muted')} />
                <p className="text-sm">{i.title}{i.container && <span className="ms-1 font-mono text-xs text-muted">{i.container}</span>}</p>
                {i.remarks && <p className="text-sm text-muted italic">“{i.remarks}”</p>}
                <p className="text-xs text-muted">{fmtDateTime(i.at)}{i.actor && ` · ${i.actor}`}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card title={<span className="flex items-center gap-2"><MessageSquare className="size-4" /> Add note</span>}>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Called the line, DO ready tomorrow…" />
        <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Visible to customer</label>
        <Button className="mt-3 w-full" variant="primary" disabled={!body.trim()} loading={add.isPending} onClick={() => add.mutate()}>Post note</Button>
        <ProblemAlert error={add.error} />
      </Card>
      <Card title="Messages sent for this job" padded={false} className="lg:col-start-2">
        <OutboundList jobId={jobId} />
      </Card>
    </div>
  );
}

function ReopenModal({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const save = useMutation({ mutationFn: () => api.post(`/jobs/${jobId}/reopen`, { reason }), onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Reopen job" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={reason.trim().length < 5} loading={save.isPending} onClick={() => save.mutate()}>Reopen</Button></>}>
      <Field label="Reason" hint="Kept in the job timeline."><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="mt-3"><ProblemAlert error={save.error} /></div>
    </Modal>
  );
}
