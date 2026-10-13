import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ArrowLeft, Printer, Receipt } from 'lucide-react';
import { api, openDocument } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUsers } from '../lib/hooks';
import { fmtDate, fmtMoney, humanize } from '../lib/format';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, ProblemAlert, Select, Spinner, Table, Tabs, type Tone } from '../components/ui';
import type { Disbursement } from '../components/types';

type Invoice = { id: string; invoiceNo: string; status: string; issueDate: string; dueDate: string; total: string; currency: string; customerName: string; jobNo: string; blNo: string; jobId: string };
type Float = { userId: string; name: string; currency: string; issued: string; spent: string; balance: string };
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
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('RECORDED');
  const [reversing, setReversing] = useState<Disbursement | null>(null);
  const rows = useQuery({ queryKey: ['ledger', status], queryFn: () => api.get<{ items: Disbursement[] }>(`/v1/finance/disbursements?status=${status}`).then((r) => r.items) });
  const reconcile = useMutation({ mutationFn: (id: string) => api.post(`/v1/finance/disbursements/${id}/reconcile`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['ledger'] }) });
  return (
    <Card padded={false} title={<span className="flex items-center gap-2">Status <Select className="h-8 w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="RECORDED">To reconcile</option><option value="RECONCILED">Reconciled</option><option value="REVERSED">Reversed</option><option value="">All</option></Select></span>}>
      <ProblemAlert error={reconcile.error} />
      {rows.isLoading ? <Spinner /> : (
        <Table>
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
                  {can('disbursement.reconcile') && d.status === 'RECORDED' && <Button size="sm" onClick={() => reconcile.mutate(d.id)}>Reconcile</Button>}
                  {can('disbursement.reconcile') && d.status !== 'REVERSED' && !d.invoiceId && <Button size="sm" variant="ghost" onClick={() => setReversing(d)}>Reverse</Button>}
                </td>
              </tr>
            ))}
            {!rows.data?.length && <tr><td colSpan={8} className="py-8 text-center text-muted">Nothing here.</td></tr>}
          </tbody>
        </Table>
      )}
      {reversing && <ReverseModal d={reversing} onClose={() => { setReversing(null); void qc.invalidateQueries({ queryKey: ['ledger'] }); }} />}
    </Card>
  );
}

function ReverseModal({ d, onClose }: { d: Disbursement; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const save = useMutation({ mutationFn: () => api.post(`/v1/finance/disbursements/${d.id}/reverse`, { reason }), onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={`Reverse ${fmtMoney(d.amount, d.currency)}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={reason.length < 3} loading={save.isPending} onClick={() => save.mutate()}>Reverse</Button></>}>
      <p className="mb-3 text-sm text-muted">Payments are never edited. A reversal entry is added and both stay in the audit trail.</p>
      <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="mt-3"><ProblemAlert error={save.error} /></div>
    </Modal>
  );
}

function Floats() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const users = useUsers();
  const rows = useQuery({ queryKey: ['floats'], queryFn: () => api.get<{ items: Float[] }>('/v1/finance/floats').then((r) => r.items) });
  const [f, setF] = useState({ userId: '', amount: '' });
  const issue = useMutation({ mutationFn: () => api.post('/v1/finance/floats', { ...f, currency: 'AED', issuedOn: new Date().toISOString().slice(0, 10) }), onSuccess: () => { setF({ userId: '', amount: '' }); void qc.invalidateQueries({ queryKey: ['floats'] }); } });
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card padded={false} title="Cash floats held by PROs">
        <Table>
          <thead><tr><th>PRO</th><th className="text-end">Issued</th><th className="text-end">Spent (receipts)</th><th className="text-end">Balance to settle</th></tr></thead>
          <tbody>{(rows.data ?? []).map((r) => <tr key={r.userId + r.currency}><td className="font-medium">{r.name}</td><td className="text-end tabular">{fmtMoney(r.issued, r.currency)}</td><td className="text-end tabular">{fmtMoney(r.spent, r.currency)}</td><td className={clsx('text-end font-medium tabular', Number(r.balance) < 0 && 'text-bad')}>{fmtMoney(r.balance, r.currency)}</td></tr>)}</tbody>
        </Table>
      </Card>
      {can('float.manage') && (
        <Card title="Issue float">
          <div className="space-y-3">
            <Field label="PRO"><Select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">Select…</option>{(users.data ?? []).filter((u) => u.roles.includes('PRO')).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
            <Field label="Amount (AED)"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Button variant="primary" className="w-full" disabled={!f.userId || !f.amount} loading={issue.isPending} onClick={() => issue.mutate()}>Issue</Button>
            <ProblemAlert error={issue.error} />
          </div>
        </Card>
      )}
    </div>
  );
}

const invoiceTone = (s: string): Tone => (s === 'PAID' ? 'ok' : s === 'ISSUED' ? 'info' : s === 'VOID' ? 'neutral' : 'warn');
function Invoices() {
  const rows = useQuery({ queryKey: ['invoices'], queryFn: () => api.get<{ items: Invoice[] }>('/v1/finance/invoices').then((r) => r.items) });
  return (
    <Card padded={false}>
      {rows.isLoading ? <Spinner /> : (
        <Table>
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
      )}
    </Card>
  );
}

function Receivables() {
  const rows = useQuery({ queryKey: ['receivables'], queryFn: () => api.get<{ items: Ageing[] }>('/v1/finance/receivables').then((r) => r.items) });
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

type InvoiceDetail = Invoice & { subtotal: string; vatAmount: string; lines: { id: string; kind: string; description: string; quantity: number; unitPrice: string; amount: string; vatRate: string }[]; job: { jobNo: string; blNo: string; vessel: string | null }; customer: { name: string; address: string | null; tradeLicenceNo: string | null } | null; issuer: { name: string } | null };

/** Printable invoice (FIN-003) with status actions. */
export function InvoicePage() {
  const { invoiceId } = useParams({ strict: false }) as { invoiceId: string };
  const { can } = useAuth();
  const qc = useQueryClient();
  const inv = useQuery({ queryKey: ['invoice', invoiceId], queryFn: () => api.get<InvoiceDetail>(`/v1/finance/invoices/${invoiceId}`) });
  const act = useMutation({ mutationFn: (a: 'issue' | 'mark-paid' | 'void') => api.post(`/v1/finance/invoices/${invoiceId}/${a}`), onSuccess: () => void qc.invalidateQueries() });
  if (inv.isLoading) return <Spinner />;
  if (!inv.data) return <ProblemAlert error={inv.error} />;
  const i = inv.data;
  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/finance" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" /> Finance</Link>
        <div className="flex gap-2">
          {can('invoice.manage') && i.status === 'DRAFT' && <Button variant="primary" loading={act.isPending} onClick={() => act.mutate('issue')}>Issue to customer</Button>}
          {can('invoice.manage') && i.status === 'ISSUED' && <Button variant="primary" loading={act.isPending} onClick={() => act.mutate('mark-paid')}>Mark paid</Button>}
          {can('invoice.manage') && ['DRAFT', 'ISSUED'].includes(i.status) && <Button variant="ghost" onClick={() => act.mutate('void')}>Void</Button>}
          <Button onClick={() => window.print()}><Printer className="size-4" /> Print / PDF</Button>
        </div>
      </div>
      <ProblemAlert error={act.error} />
      <div className="print-sheet mx-auto max-w-3xl rounded-xl border border-line bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-lg font-semibold">{i.issuer?.name}</p>
            <p className="text-sm text-muted">Customs clearance services</p>
          </div>
          <div className="text-end">
            <p className="text-2xl font-semibold tracking-tight">Tax invoice</p>
            <p className="font-mono text-sm">{i.invoiceNo}</p>
            <Badge tone={invoiceTone(i.status)} className="mt-1">{i.status.toLowerCase()}</Badge>
          </div>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-6 text-sm">
          <div><p className="text-xs text-muted uppercase">Bill to</p><p className="font-medium">{i.customer?.name}</p><p className="text-muted">{i.customer?.address}</p>{i.customer?.tradeLicenceNo && <p className="text-muted">TL {i.customer.tradeLicenceNo}</p>}</div>
          <div className="text-end"><p><span className="text-muted">Issued</span> {fmtDate(i.issueDate)}</p><p><span className="text-muted">Due</span> {fmtDate(i.dueDate)}</p><p><span className="text-muted">BL</span> <span className="font-mono">{i.job.blNo}</span></p><p><span className="text-muted">Job</span> {i.job.jobNo}{i.job.vessel && ` · ${i.job.vessel}`}</p></div>
        </div>
        <table className="mt-8 w-full text-sm">
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
