import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ArrowLeft, Eye, EyeOff, FileText, Lock, MessageSquare, Plus, Receipt, Ship, Truck, Upload } from 'lucide-react';
import { DOCUMENT_TYPES } from '@clearport/contracts';
import { api, openDocument, uploadDocument } from '../lib/api';
import { daysUntil, fmtDate, fmtDateTime, fmtMoney, humanize } from '../lib/format';
import { L } from '../lib/i18n';
import { useMaster } from '../lib/hooks';
import { AssignTripModal } from '../components/AssignTrip';
import { StageCard } from '../components/StageCard';
import { PriorityBadge, StageStatus } from '../components/StatusBadge';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, ProblemAlert, Select, Spinner, Table, Tabs, Textarea } from '../components/ui';
import type { JobDetail, StageView } from '../components/types';

type Tab = 'workflow' | 'containers' | 'documents' | 'payments' | 'trips' | 'timeline';

export function JobDetailPage() {
  const { jobId } = useParams({ strict: false }) as { jobId: string };
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('workflow');
  const job = useQuery({ queryKey: ['job', jobId], queryFn: () => api.get<JobDetail>(`/v1/clearance/jobs/${jobId}`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['job', jobId] });
    void qc.invalidateQueries({ queryKey: ['timeline', jobId] });
    void qc.invalidateQueries({ queryKey: ['board'] });
  };
  const close = useMutation({ mutationFn: () => api.post(`/v1/clearance/jobs/${jobId}/close`), onSuccess: refresh });
  const [reopen, setReopen] = useState(false);

  if (job.isLoading) return <Spinner />;
  if (job.error || !job.data) return <ProblemAlert error={job.error} />;
  const j = job.data;
  const conts = j.containers.map((c) => ({ id: c.id, containerNo: c.containerNo }));
  const stage = (key: string) => j.stages.jobStages.find((s) => s.key === key);
  const card = (s: StageView | undefined) => s && <StageCard key={s.id} jobId={j.id} stage={s} canAssign={j.permissions.assign && j.status === 'OPEN'} containers={conts} onChanged={refresh} />;
  const ccro = stage('CCRO');
  const delivered = j.containers.filter((c) => j.stages.containerStages[c.id]?.find((s) => s.key === 'DELIVERY')?.done).length;

  return (
    <>
      <Link to="/board" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" /> {t('nav.board')}</Link>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{j.blNo}</span><Badge tone={j.status === 'OPEN' ? 'info' : 'neutral'}>{j.status === 'OPEN' ? 'Open' : 'Closed'}</Badge><PriorityBadge p={j.priority} /></span>}
        subtitle={<>{j.jobNo} · {j.customer?.name} · {j.commodity} · {delivered}/{j.containers.length} delivered</>}
        actions={
          <>
            {j.status === 'OPEN' && j.permissions.close && <Button onClick={() => close.mutate()} loading={close.isPending}><Lock className="size-4" /> {t('job.closeJob')}</Button>}
            {j.status === 'CLOSED' && j.permissions.reopen && <Button onClick={() => setReopen(true)}>{t('job.reopen')}</Button>}
          </>
        }
      />
      {close.error && <div className="mb-4"><ProblemAlert error={close.error} /></div>}

      <div className="mb-5 grid grid-cols-2 gap-3 rounded-xl border border-line bg-white p-4 text-sm sm:grid-cols-4 lg:grid-cols-7">
        <Info label="Vessel / voyage" value={[j.vessel, j.voyage].filter(Boolean).join(' / ') || '—'} icon={<Ship className="size-3.5" />} />
        <Info label="Line" value={j.shippingLineCode ?? '—'} />
        <Info label="Route" value={`${j.portOfLoading ?? '—'} → ${j.portOfDischarge ?? '—'}`} />
        <Info label="Terminal" value={j.terminal ?? '—'} />
        <Info label="ETA" value={fmtDate(j.eta)} />
        <Info label="Coordinator" value={j.coordinator?.name ?? '—'} />
        <Info label="HS codes" value={j.hsCodes.join(', ') || '—'} />
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'workflow', label: t('job.overview') },
          { value: 'containers', label: t('job.containers'), count: j.containers.length },
          { value: 'documents', label: t('job.documents'), count: j.documents.length },
          { value: 'payments', label: t('job.payments'), count: j.finance.payments.length },
          { value: 'trips', label: t('job.trips'), count: j.trips.length },
          { value: 'timeline', label: t('job.timeline') },
        ]}
      />
      <div className="mt-5">
        {tab === 'workflow' && (
          <div className="space-y-4">
            {card(stage('DOCUMENTS'))}
            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
              <TrackBox title={t('job.customsTrack')}>
                <div className="grid gap-3 md:grid-cols-3">{['BAYAN', 'CUSTOMER_COMM', 'INSPECTION'].map((k) => card(stage(k)))}</div>
              </TrackBox>
              <TrackBox title={t('job.doTrack')}>{card(stage('DO'))}</TrackBox>
            </div>
            <TrackBox title={t('job.gate')} accent>
              {card(ccro)}
            </TrackBox>
            <TrackBox title={t('job.perContainer')}>
              {ccro?.status !== 'ISSUED' ? <p className="text-sm text-muted">Container stages start when the CCRO is issued.</p> : <ContainerMatrix j={j} />}
            </TrackBox>
          </div>
        )}
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

function Info({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-xs text-muted">{icon}{label}</p>
      <p className="truncate font-medium">{value}</p>
    </div>
  );
}

function TrackBox({ title, children, accent }: { title: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div className={clsx('rounded-2xl border p-3', accent ? 'border-brand/30 bg-brand-soft/40' : 'border-dashed border-line')}>
      <p className="mb-2 px-1 text-xs font-semibold tracking-wide text-muted uppercase">{title}</p>
      {children}
    </div>
  );
}

function ContainerMatrix({ j }: { j: JobDetail }) {
  const keys = ['TRUCK', 'PHYSICAL_INSPECTION', 'RELEASE', 'DELIVERY'];
  const first = Object.values(j.stages.containerStages)[0] ?? [];
  return (
    <Table>
      <thead><tr><th>Container</th>{keys.map((k) => <th key={k}>{L(first.find((s) => s.key === k)?.label) || humanize(k)}</th>)}</tr></thead>
      <tbody>
        {j.containers.map((c) => {
          const st = j.stages.containerStages[c.id] ?? [];
          return (
            <tr key={c.id}>
              <td className="font-mono">{c.containerNo}</td>
              {keys.map((k) => {
                const s = st.find((x) => x.key === k);
                return <td key={k}>{s ? <StageStatus s={s} /> : '—'}</td>;
              })}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function ContainersTab({ j, onChanged }: { j: JobDetail; onChanged: () => void }) {
  const conts = j.containers.map((c) => ({ id: c.id, containerNo: c.containerNo }));
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <ProblemAlert error={error} />
      {j.permissions.update && j.status === 'OPEN' && <div className="flex justify-end"><Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add containers</Button></div>}
      {j.containers.map((c) => {
        const free = daysUntil(c.freeTimeExpiresAt);
        const stages = j.stages.containerStages[c.id] ?? [];
        return (
          <Card
            key={c.id}
            title={<span className="flex items-center gap-2"><span className="font-mono">{c.containerNo}</span><Badge>{c.sizeType}</Badge>{c.sealNo && <span className="text-xs font-normal text-muted">seal {c.sealNo}</span>}</span>}
            actions={
              <label className="flex items-center gap-2 text-xs text-muted">
                Free time ends
                <Input
                  type="date"
                  className={clsx('h-8 w-40 text-xs', free !== null && free <= 1 && 'border-bad text-bad')}
                  defaultValue={c.freeTimeExpiresAt ?? ''}
                  disabled={!j.permissions.update || j.status !== 'OPEN'}
                  onBlur={async (e) => {
                    if (e.target.value === (c.freeTimeExpiresAt ?? '')) return;
                    try {
                      await api.patch(`/v1/clearance/jobs/${j.id}/containers/${c.id}`, { freeTimeExpiresAt: e.target.value || null });
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
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {stages.map((s) => <StageCard key={s.id} jobId={j.id} stage={s} canAssign={false} containers={conts} onChanged={onChanged} />)}
              </div>
            ) : <p className="text-sm text-muted">Waiting for CCRO. {c.grossWeightKg && `Gross weight ${c.grossWeightKg} kg.`} {c.packages && `${c.packages} packages.`}</p>}
          </Card>
        );
      })}
      {adding && <AddContainersModal jobId={j.id} onClose={() => { setAdding(false); onChanged(); }} />}
    </div>
  );
}

function AddContainersModal({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const save = useMutation({ mutationFn: () => api.post(`/v1/clearance/jobs/${jobId}/containers`, { containers: text.split(/[\s,;]+/).filter(Boolean).map((containerNo) => ({ containerNo })) }), onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Add containers" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Add</Button></>}>
      <Field label="Container numbers" hint="Validated against ISO 6346 by the server."><Textarea className="font-mono" rows={5} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="mt-3"><ProblemAlert error={save.error} /></div>
    </Modal>
  );
}

function DocumentsTab({ j, onChanged }: { j: JobDetail; onChanged: () => void }) {
  const [docType, setDocType] = useState<string>('BILL_OF_LADING');
  const [containerId, setContainerId] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      {j.permissions.upload && (
        <Card title="Upload">
          <div className="space-y-3">
            <Field label="Document type"><Select value={docType} onChange={(e) => setDocType(e.target.value)}>{DOCUMENT_TYPES.map((d) => <option key={d} value={d}>{humanize(d)}</option>)}</Select></Field>
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
                    await uploadDocument(j.id, file, docType, { containerId: containerId || undefined, customerVisible: visible });
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
                <td><Badge>{humanize(d.docType)}</Badge></td>
                <td><button className="inline-flex items-center gap-1.5 text-brand-2 hover:underline" onClick={() => void openDocument(d.id)}><FileText className="size-4" />{d.fileName}</button>{d.containerId && <span className="ms-2 font-mono text-xs text-muted">{j.containers.find((c) => c.id === d.containerId)?.containerNo}</span>}</td>
                <td className="text-muted">{fmtDateTime(d.createdAt)} · {d.uploadedByName}</td>
                <td>
                  <button
                    disabled={!j.permissions.upload}
                    title="Toggle customer visibility"
                    className="rounded p-1 text-muted hover:text-ink"
                    onClick={async () => {
                      await api.patch(`/v1/clearance/documents/${d.id}`, { customerVisible: !d.customerVisible });
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
  const reconcile = useMutation({ mutationFn: (id: string) => api.post(`/v1/finance/disbursements/${id}/reconcile`), onSuccess: onChanged });
  const invoice = useMutation({ mutationFn: () => api.post<{ id: string }>('/v1/finance/invoices', { jobId: j.id }), onSuccess: () => { onChanged(); void qc.invalidateQueries({ queryKey: ['invoices'] }); } });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {j.finance.totals.map((t) => (
          <div key={t.currency} className="rounded-xl border border-line bg-white p-4">
            <p className="text-xs text-muted uppercase">Paid on behalf of customer</p>
            <p className="mt-1 text-2xl font-semibold tabular">{fmtMoney(t.paid, t.currency)}</p>
            <p className="text-xs text-muted">{fmtMoney(t.billable, t.currency)} billable · {t.unreconciled} unreconciled · {t.uninvoiced} not invoiced</p>
          </div>
        ))}
        <div className="flex flex-col justify-center gap-2 rounded-xl border border-line bg-white p-4">
          {j.permissions.pay && j.status === 'OPEN' && <Button onClick={() => setAdding(true)}><Plus className="size-4" /> Record payment</Button>}
          {j.permissions.invoice && <Button variant="primary" onClick={() => invoice.mutate()} loading={invoice.isPending}><Receipt className="size-4" /> Generate invoice</Button>}
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
        <Table>
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
                <td>{j.permissions.reconcile && p.status === 'RECORDED' && <Button size="sm" onClick={() => reconcile.mutate(p.id)}>Reconcile</Button>}</td>
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
  const [f, setF] = useState({ feeType: 'OTHER', amount: '', paymentMethod: 'CASH_FLOAT', description: '', billable: true });
  const [receipt, setReceipt] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const receiptDocumentId = receipt ? (await uploadDocument(jobId, receipt, 'RECEIPT')).id : undefined;
      return api.post('/v1/finance/disbursements', { jobId, ...f, currency: 'AED', paidOn: new Date().toISOString().slice(0, 10), receiptDocumentId, markupPct: 0 });
    },
    onSuccess: onClose,
  });
  return (
    <Modal open onClose={onClose} title="Record payment" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.amount} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Fee type"><Select value={f.feeType} onChange={(e) => setF({ ...f, feeType: e.target.value })}>{(fees.data ?? []).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</Select></Field>
        <Field label="Amount (AED)" required><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Method"><Select value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })}><option value="CASH_FLOAT">PRO float (cash)</option><option value="COMPANY_CARD">Company card</option><option value="BANK_TRANSFER">Bank transfer</option><option value="ONLINE">Online</option></Select></Field>
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
      {j.permissions.trips && j.status === 'OPEN' && (
        <div className="flex items-center justify-between rounded-xl border border-line bg-white p-4">
          <p className="text-sm text-muted">{ready.length ? `${ready.length} container(s) ready for a truck.` : 'No containers waiting for a truck.'}</p>
          <Button variant="primary" disabled={!ready.length} onClick={() => setAssign(true)}><Truck className="size-4" /> Assign truck</Button>
        </div>
      )}
      <Card padded={false} title="Trips">
        <Table>
          <thead><tr><th>Trip</th><th>Driver</th><th>Vehicle</th><th>Containers</th><th>Deliver to</th><th>Status</th></tr></thead>
          <tbody>
            {j.trips.map((t) => (
              <tr key={t.id}>
                <td className="font-medium">{t.tripNo}</td>
                <td>{t.driverName}<p className="text-xs text-muted">{t.driverPhone}</p></td>
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
  const items = useQuery({ queryKey: ['timeline', jobId], queryFn: () => api.get<{ items: TimelineItem[] }>(`/v1/clearance/jobs/${jobId}/timeline`).then((r) => r.items) });
  const add = useMutation({
    mutationFn: () => api.post(`/v1/clearance/jobs/${jobId}/comments`, { body, customerVisible: visible }),
    onSuccess: () => {
      setBody('');
      void qc.invalidateQueries({ queryKey: ['timeline', jobId] });
    },
  });
  const dot: Record<string, string> = { stage: 'bg-info', comment: 'bg-brand', document: 'bg-muted', payment: 'bg-warn', created: 'bg-ok' };
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
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
    </div>
  );
}

function ReopenModal({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const save = useMutation({ mutationFn: () => api.post(`/v1/clearance/jobs/${jobId}/reopen`, { reason }), onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Reopen job" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={reason.trim().length < 5} loading={save.isPending} onClick={() => save.mutate()}>Reopen</Button></>}>
      <Field label="Reason" hint="Recorded in the audit trail."><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="mt-3"><ProblemAlert error={save.error} /></div>
    </Modal>
  );
}
