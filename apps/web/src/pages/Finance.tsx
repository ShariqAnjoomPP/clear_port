import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ArrowLeft, Printer, Receipt } from 'lucide-react';
import { api, openDocument } from '../lib/api';
import { useStaff } from '../lib/hooks';
import { currencyCode, fmtDate, fmtMoney, humanize } from '../lib/format';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, ProblemAlert, Select, Spinner, Table, Tabs, type Tone } from '../components/ui';
import type { Disbursement } from '../components/types';

type Invoice = { id: string; invoiceNo: string; status: string; issueDate: string; dueDate: string; total: string; currency: string; customerName: string; jobNo: string; blNo: string; jobId: string };
type Float = { staffId: string; name: string; currency: string; issued: string; spent: string; balance: string };
type Ageing = { customer_id: string; customer_name: string; currency: string; current: string; d30: string; d60: string; d90: string; total: string };

export function FinancePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'ledger' | 'floats' | 'invoices' | 'receivables'>('ledger');
  return (
    <>
      <PageHeader title={t('nav.finance')} subtitle="Every amount paid on a customer's behalf, reconciled and billed back." />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'ledger', label: 'Payments ledger' }, { value: 'floats', label: 'PRO floats' }, { value: 'invoices', label: 'Invoices' }, { value: 'receivables', label: 'Receivables' }]} />
      <div className="mt-4">
        {tab === 'ledger' && <Ledger />}
        {tab === 'floats' && <Floats />}
        {tab === 'invoices' && <Invoices />}
        {tab === 'receivables' && <Receivables />}
      </div>
    </>
  );
}

function Ledger() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('RECORDED');
  const [reversing, setReversing] = useState<Disbursement | null>(null);
  const rows = useQuery({ queryKey: ['ledger', status], queryFn: () => api.get<{ items: Disbursement[] }>(`/finance/disbursements?status=${status}`).then((r) => r.items) });
  const reconcile = useMutation({ mutationFn: (id: string) => api.post(`/finance/disbursements/${id}/reconcile`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['ledger'] }) });
  return (
    <Card padded={false} title={<span className="flex items-center gap-2">Status <Select className="h-8 w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="RECORDED">To reconcile</option><option value="RECONCILED">Reconciled</option><option value="REVERSED">Reversed</option><option value="">All</option></Select></span>}>
      <ProblemAlert error={reconcile.error} />
      {rows.isLoading ? <Spinner /> : (
        <>
        {/* Phone: one row per payment */}
        <div className="divide-y divide-outline-variant/50 sm:hidden">
          {(rows.data ?? []).map((d) => (
            <div key={d.id} className={clsx('px-4 py-3', d.status === 'REVERSED' && 'opacity-60')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{humanize(d.feeType)}{d.stageKey && <span className="text-on-surface-variant"> · {humanize(d.stageKey)}</span>}</p>
                  <Link to="/jobs/$jobId" params={{ jobId: d.jobId }} className="block truncate font-mono text-xs text-primary">{d.blNo}</Link>
                  <p className="truncate text-xs text-on-surface-variant">{d.customerName} · {fmtDate(d.paidOn)} · {d.paidByName}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular">{fmtMoney(d.amount, d.currency)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {d.receiptDocumentId ? <button onClick={() => void openDocument(d.receiptDocumentId!)} className="inline-flex items-center gap-1 text-xs font-medium text-primary"><Receipt className="size-3.5" /> Receipt</button> : <Badge tone="warn">no receipt</Badge>}
                <span className="ms-auto flex gap-2">
                  {d.status === 'RECORDED' && <Button size="sm" variant="tonal" onClick={() => reconcile.mutate(d.id)}>Reconcile</Button>}
                  {d.status !== 'REVERSED' && !d.invoiceId && <Button size="sm" variant="ghost" onClick={() => setReversing(d)}>Reverse</Button>}
                </span>
              </div>
            </div>
          ))}
          {!rows.data?.length && <p className="px-4 py-8 text-center text-sm text-on-surface-variant">Nothing here.</p>}
        </div>
        <Table className="hidden sm:block">
          <thead><tr><th>Paid on</th><th>BL</th><th>Fee</th><th>Paid by</th><th>Method</th><th>Receipt</th><th className="text-end">Amount</th><th /></tr></thead>
          <tbody>
            {(rows.data ?? []).map((d) => (
              <tr key={d.id} className={clsx(d.status === 'REVERSED' && 'text-muted')}>
                <td>{fmtDate(d.paidOn)}</td>
                <td><Link to="/jobs/$jobId" params={{ jobId: d.jobId }} className="font-mono text-brand-2 hover:underline">{d.blNo}</Link><p className="text-xs text-muted">{d.customerName}</p></td>
                <td>{humanize(d.feeType)}{d.stageKey && <span className="text-xs text-muted"> · {humanize(d.stageKey)}</span>}{d.description && <p className="text-xs text-muted">{d.description}</p>}</td>
                <td>{d.paidByName}</td>
                <td className="text-muted">{humanize(d.paymentMethod)}</td>
                <td>{d.receiptDocumentId ? <button onClick={() => void openDocument(d.receiptDocumentId!)} className="text-brand-2"><Receipt className="size-4" /></button> : <Badge tone="warn">missing</Badge>}</td>
                <td className="text-end tabular">{fmtMoney(d.amount, d.currency)}</td>
                <td className="space-x-1 whitespace-nowrap text-end">
                  {d.status === 'RECORDED' && <Button size="sm" onClick={() => reconcile.mutate(d.id)}>Reconcile</Button>}
                  {d.status !== 'REVERSED' && !d.invoiceId && <Button size="sm" variant="ghost" onClick={() => setReversing(d)}>Reverse</Button>}
                </td>
              </tr>
            ))}
            {!rows.data?.length && <tr><td colSpan={8} className="py-8 text-center text-muted">Nothing here.</td></tr>}
          </tbody>
        </Table>
        </>
      )}
      {reversing && <ReverseModal d={reversing} onClose={() => { setReversing(null); void qc.invalidateQueries({ queryKey: ['ledger'] }); }} />}
    </Card>
  );
}

function ReverseModal({ d, onClose }: { d: Disbursement; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const save = useMutation({ mutationFn: () => api.post(`/finance/disbursements/${d.id}/reverse`, { reason }), onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={`Reverse ${fmtMoney(d.amount, d.currency)}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={reason.length < 3} loading={save.isPending} onClick={() => save.mutate()}>Reverse</Button></>}>
      <p className="mb-3 text-sm text-muted">Payments are never edited. A reversal entry is added and both stay in the ledger.</p>
      <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="mt-3"><ProblemAlert error={save.error} /></div>
    </Modal>
  );
}

function Floats() {
  const qc = useQueryClient();
  const pros = useStaff('PRO');
  const rows = useQuery({ queryKey: ['floats'], queryFn: () => api.get<{ items: Float[] }>('/finance/floats').then((r) => r.items) });
  const [f, setF] = useState({ staffId: '', amount: '' });
  const issue = useMutation({ mutationFn: () => api.post('/finance/floats', { ...f, currency: currencyCode(), issuedOn: new Date().toISOString().slice(0, 10) }), onSuccess: () => { setF({ staffId: '', amount: '' }); void qc.invalidateQueries({ queryKey: ['floats'] }); } });
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
      <Card padded={false} title="Cash floats held by PROs">
        <Table>
          <thead><tr><th>PRO</th><th className="text-end">Issued</th><th className="text-end">Spent (receipts)</th><th className="text-end">Balance to settle</th></tr></thead>
          <tbody>{(rows.data ?? []).map((r) => <tr key={r.staffId + r.currency}><td className="font-medium">{r.name}</td><td className="text-end tabular">{fmtMoney(r.issued, r.currency)}</td><td className="text-end tabular">{fmtMoney(r.spent, r.currency)}</td><td className={clsx('text-end font-medium tabular', Number(r.balance) < 0 && 'text-bad')}>{fmtMoney(r.balance, r.currency)}</td></tr>)}</tbody>
        </Table>
      </Card>
      {(
        <Card title="Issue float">
          <div className="space-y-3">
            <Field label="PRO"><Select value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}><option value="">Select…</option>{(pros.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label={`Amount (${currencyCode()})`}><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Button variant="primary" className="w-full" disabled={!f.staffId || !f.amount} loading={issue.isPending} onClick={() => issue.mutate()}>Issue</Button>
            <ProblemAlert error={issue.error} />
          </div>
        </Card>
      )}
    </div>
  );
}

const invoiceTone = (s: string): Tone => (s === 'PAID' ? 'ok' : s === 'ISSUED' ? 'info' : s === 'VOID' ? 'neutral' : 'warn');
function Invoices() {
  const rows = useQuery({ queryKey: ['invoices'], queryFn: () => api.get<{ items: Invoice[] }>('/finance/invoices').then((r) => r.items) });
  return (
    <Card padded={false}>
      {rows.isLoading ? <Spinner /> : (
        <>
        <div className="divide-y divide-outline-variant/50 sm:hidden">
          {(rows.data ?? []).map((i) => (
            <Link key={i.id} to="/invoices/$invoiceId" params={{ invoiceId: i.id }} className="flex items-start justify-between gap-3 px-4 py-3 active:bg-on-surface/8">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{i.invoiceNo}</p>
                <p className="truncate text-xs text-on-surface-variant">{i.customerName} · <span className="font-mono">{i.blNo}</span></p>
                <p className="text-xs text-on-surface-variant">Due {fmtDate(i.dueDate)}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm font-semibold tabular">{fmtMoney(i.total, i.currency)}</span>
                <Badge tone={invoiceTone(i.status)}>{i.status.toLowerCase()}</Badge>
              </div>
            </Link>
          ))}
          {!rows.data?.length && <p className="px-4 py-8 text-center text-sm text-on-surface-variant">No invoices yet. Generate one from a job's Payments tab.</p>}
        </div>
        <Table className="hidden sm:block">
          <thead><tr><th>Invoice</th><th>Customer</th><th>BL</th><th>Issued</th><th>Due</th><th>Status</th><th className="text-end">Total</th></tr></thead>
          <tbody>
            {(rows.data ?? []).map((i) => (
              <tr key={i.id}>
                <td><Link to="/invoices/$invoiceId" params={{ invoiceId: i.id }} className="font-medium text-brand-2 hover:underline">{i.invoiceNo}</Link></td>
                <td>{i.customerName}</td><td className="font-mono">{i.blNo}</td><td>{fmtDate(i.issueDate)}</td><td>{fmtDate(i.dueDate)}</td>
                <td><Badge tone={invoiceTone(i.status)}>{i.status.toLowerCase()}</Badge></td>
                <td className="text-end tabular">{fmtMoney(i.total, i.currency)}</td>
              </tr>
            ))}
            {!rows.data?.length && <tr><td colSpan={7} className="py-8 text-center text-muted">No invoices yet. Generate one from a job's Payments tab.</td></tr>}
          </tbody>
        </Table>
        </>
      )}
    </Card>
  );
}

function Receivables() {
  const rows = useQuery({ queryKey: ['receivables'], queryFn: () => api.get<{ items: Ageing[] }>('/finance/receivables').then((r) => r.items) });
  return (
    <Card padded={false}>
      <Table>
        <thead><tr><th>Customer</th><th className="text-end">Not due</th><th className="text-end">1–30 days</th><th className="text-end">31–60</th><th className="text-end">60+</th><th className="text-end">Total</th></tr></thead>
        <tbody>
          {(rows.data ?? []).map((r) => (
            <tr key={r.customer_id + r.currency}>
              <td className="font-medium">{r.customer_name}</td>
              <td className="text-end tabular">{fmtMoney(r.current, r.currency)}</td>
              <td className="text-end tabular">{fmtMoney(r.d30, r.currency)}</td>
              <td className="text-end tabular text-warn">{fmtMoney(r.d60, r.currency)}</td>
              <td className="text-end tabular text-bad">{fmtMoney(r.d90, r.currency)}</td>
              <td className="text-end font-semibold tabular">{fmtMoney(r.total, r.currency)}</td>
            </tr>
          ))}
          {!rows.data?.length && <tr><td colSpan={6} className="py-8 text-center text-muted">No issued, unpaid invoices.</td></tr>}
        </tbody>
      </Table>
    </Card>
  );
}

type InvoiceDetail = Invoice & { subtotal: string; vatAmount: string; lines: { id: string; kind: string; description: string; quantity: number; unitPrice: string; amount: string; vatRate: string }[]; job: { jobNo: string; blNo: string; vessel: string | null }; customer: { name: string; address: string | null; tradeLicenceNo: string | null } | null; issuer: { name: string; address: string | null; trn: string | null } };

/** Printable invoice with status actions. */
export function InvoicePage() {
  const { invoiceId } = useParams({ strict: false }) as { invoiceId: string };
  const qc = useQueryClient();
  const inv = useQuery({ queryKey: ['invoice', invoiceId], queryFn: () => api.get<InvoiceDetail>(`/finance/invoices/${invoiceId}`) });
  const act = useMutation({ mutationFn: (a: 'issue' | 'mark-paid' | 'void') => api.post(`/finance/invoices/${invoiceId}/${a}`), onSuccess: () => void qc.invalidateQueries() });
  if (inv.isLoading) return <Spinner />;
  if (!inv.data) return <ProblemAlert error={inv.error} />;
  const i = inv.data;
  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/finance" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" /> Finance</Link>
        <div className="flex gap-2">
          {i.status === 'DRAFT' && <Button variant="primary" loading={act.isPending} onClick={() => act.mutate('issue')}>Issue to customer</Button>}
          {i.status === 'ISSUED' && <Button variant="primary" loading={act.isPending} onClick={() => act.mutate('mark-paid')}>Mark paid</Button>}
          {['DRAFT', 'ISSUED'].includes(i.status) && <Button variant="ghost" onClick={() => act.mutate('void')}>Void</Button>}
          <Button onClick={() => window.print()}><Printer className="size-4" /> Print / PDF</Button>
        </div>
      </div>
      <ProblemAlert error={act.error} />
      <div className="print-sheet mx-auto max-w-3xl rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between print:flex-row print:justify-between">
          <div>
            <p className="text-lg font-semibold">{i.issuer.name}</p>
            <p className="text-sm text-muted">Customs clearance services</p>
            {i.issuer.address && <p className="text-sm text-muted">{i.issuer.address}</p>}
            {i.issuer.trn && <p className="text-sm text-muted">TRN {i.issuer.trn}</p>}
          </div>
          <div className="sm:text-end print:text-end">
            <p className="text-2xl font-semibold tracking-tight">Tax invoice</p>
            <p className="font-mono text-sm">{i.invoiceNo}</p>
            <Badge tone={invoiceTone(i.status)} className="mt-1">{i.status.toLowerCase()}</Badge>
          </div>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-6 text-sm sm:grid-cols-2 print:grid-cols-2">
          <div><p className="text-xs text-muted uppercase">Bill to</p><p className="font-medium">{i.customer?.name}</p><p className="text-muted">{i.customer?.address}</p>{i.customer?.tradeLicenceNo && <p className="text-muted">TL {i.customer.tradeLicenceNo}</p>}</div>
          <div className="sm:text-end print:text-end"><p><span className="text-muted">Issued</span> {fmtDate(i.issueDate)}</p><p><span className="text-muted">Due</span> {fmtDate(i.dueDate)}</p><p><span className="text-muted">BL</span> <span className="font-mono">{i.job.blNo}</span></p><p><span className="text-muted">Job</span> {i.job.jobNo}{i.job.vessel && ` · ${i.job.vessel}`}</p></div>
        </div>
        <ul className="mt-6 divide-y divide-outline-variant/60 border-y border-outline-variant/60 sm:hidden print:hidden">
          {i.lines.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p>{l.description}</p>
                <p className="text-xs text-on-surface-variant">{l.quantity} × {fmtMoney(l.unitPrice, i.currency)} · VAT {Number(l.vatRate)}%{l.kind === 'DISBURSEMENT' && ' · paid on your behalf'}</p>
              </div>
              <span className="shrink-0 font-medium tabular">{fmtMoney(l.amount, i.currency)}</span>
            </li>
          ))}
        </ul>
        <table className="mt-8 hidden w-full text-sm sm:table print:table">
          <thead><tr className="border-b border-line text-xs text-muted uppercase"><th className="py-2 text-start">Description</th><th className="text-end">Qty</th><th className="text-end">Unit</th><th className="text-end">VAT</th><th className="text-end">Amount</th></tr></thead>
          <tbody>
            {i.lines.map((l) => (
              <tr key={l.id} className="border-b border-line/70">
                <td className="py-2">{l.description}{l.kind === 'DISBURSEMENT' && <span className="ms-1 text-xs text-muted">(paid on your behalf)</span>}</td>
                <td className="text-end tabular">{l.quantity}</td><td className="text-end tabular">{fmtMoney(l.unitPrice, i.currency)}</td><td className="text-end tabular">{Number(l.vatRate)}%</td><td className="text-end tabular">{fmtMoney(l.amount, i.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 ms-auto w-64 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted">Subtotal</span><span className="tabular">{fmtMoney(i.subtotal, i.currency)}</span></div>
          <div className="flex justify-between"><span className="text-muted">VAT</span><span className="tabular">{fmtMoney(i.vatAmount, i.currency)}</span></div>
          <div className="flex justify-between border-t border-line pt-1 text-base font-semibold"><span>Total</span><span className="tabular">{fmtMoney(i.total, i.currency)}</span></div>
        </div>
      </div>
    </>
  );
}
