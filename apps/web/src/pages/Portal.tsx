import { Suspense, useState } from 'react';
import { Link, Navigate, Outlet, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ArrowLeft, Check, CheckCircle2, Circle, FileText, LogOut, Ship } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { daysUntil, fmtDate, fmtDateTime, fmtMoney, humanize } from '../lib/format';
import i18n, { setLanguage } from '../lib/i18n';
import { Brand } from '../layouts/AppShell';
import { Badge, Button, Card, Empty, Field, Modal, ProblemAlert, Spinner, Textarea } from '../components/ui';

type PortalJob = { jobId: string; jobNo: string; blNo: string; eta: string | null; phase: string; phaseLabel: string; containersTotal: number; containersDelivered: number; updatedAt: string };
type ApprovalSummary = { blNo: string; jobNo: string; lines: { feeType: string; stageKey: string | null; amount: string; currency: string; description: string | null }[]; totals: { currency: string; amount: string }[] };
type PortalJobDetail = {
  jobId: string; jobNo: string; blNo: string; vessel: string | null; eta: string; commodity: string; phase: string; phaseLabel: string;
  milestones: { key: string; status?: string; done: boolean; completedAt: string | null }[];
  containers: { id: string; containerNo: string; sizeType: string; freeTimeExpiresAt: string | null; status: string; deliveredAt: string | null; receiverName: string | null }[];
  documents: { id: string; docType: string; fileName: string; createdAt: string; url: string }[];
  invoices: { id: string; invoiceNo: string; total: string; currency: string; status: string; dueDate: string }[];
  pendingApprovals: { id: string; summary: ApprovalSummary; expiresAt: string }[];
};
const MILESTONE: Record<string, string> = { DOCUMENTS: 'Documents', BAYAN: 'Customs declaration', CUSTOMER_COMM: 'Your approval', INSPECTION: 'Customs inspection', DO: 'Delivery order', CCRO: 'Release (CCRO)' };

/** Customer portal shell (CXP-001). */
export function PortalShell() {
  const { t } = useTranslation();
  const { user, ready, logout } = useAuth();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to="/login" />;
  return (
    <div className="min-h-full">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/portal"><Brand /></Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-white/70 sm:inline">{user.name}</span>
            <button onClick={() => setLanguage(i18n.language === 'ar' ? 'en' : 'ar')} className="rounded px-2 py-1 hover:bg-white/10">{t('common.language')}</button>
            <button onClick={() => void logout()} className="rounded p-1.5 hover:bg-white/10" aria-label={t('common.signOut')}><LogOut className="size-4" /></button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4 sm:p-6"><Suspense fallback={<Spinner />}><Outlet /></Suspense></main>
    </div>
  );
}

export function PortalHome() {
  const { t } = useTranslation();
  const jobs = useQuery({ queryKey: ['portal-jobs'], queryFn: () => api.get<{ items: PortalJob[] }>('/v1/portal/jobs').then((r) => r.items) });
  const approvals = useQuery({ queryKey: ['portal-approvals'], queryFn: () => api.get<{ items: { id: string; jobId: string; summary: ApprovalSummary }[] }>('/v1/portal/approvals').then((r) => r.items) });
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">{t('portal.title')}</h1>
      {!!approvals.data?.length && (
        <div className="mb-4 rounded-xl border border-warn/30 bg-warn-soft p-4">
          <p className="font-medium text-warn">{t('portal.approvals')}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {approvals.data.map((a) => (
              <li key={a.id}><Link to="/portal/jobs/$jobId" params={{ jobId: a.jobId }} className="font-mono text-brand-2 hover:underline">{a.summary.blNo}</Link> — {a.summary.totals.map((x) => fmtMoney(x.amount, x.currency)).join(' + ')}</li>
            ))}
          </ul>
        </div>
      )}
      {jobs.isLoading ? <Spinner /> : !jobs.data?.length ? <Card><Empty icon={<Ship className="size-8" />} title="No shipments yet" /></Card> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {jobs.data.map((j) => (
            <Link key={j.jobId} to="/portal/jobs/$jobId" params={{ jobId: j.jobId }} className="rounded-xl border border-line bg-white p-4 hover:border-brand hover:shadow-sm">
              <div className="flex items-center justify-between"><p className="font-mono font-semibold">{j.blNo}</p><Badge tone={j.phase === 'CLOSED' || j.phase === 'READY_TO_CLOSE' ? 'ok' : 'info'}>{j.phaseLabel}</Badge></div>
              <p className="mt-1 text-sm text-muted">ETA {fmtDate(j.eta)} · {j.containersDelivered}/{j.containersTotal} containers delivered</p>
              <div className="mt-3 h-1.5 rounded-full bg-canvas"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${progress(j.phase, j.containersDelivered, j.containersTotal)}%` }} /></div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
const progress = (phase: string, d: number, t: number) => ({ DOCUMENTS: 10, CLEARANCE: 35, CCRO: 60, DELIVERY: 65 + (t ? (d / t) * 30 : 0), READY_TO_CLOSE: 100, CLOSED: 100 })[phase] ?? 0;

export function PortalJobPage() {
  const { jobId } = useParams({ strict: false }) as { jobId: string };
  const job = useQuery({ queryKey: ['portal-job', jobId], queryFn: () => api.get<PortalJobDetail>(`/v1/portal/jobs/${jobId}`) });
  const [deciding, setDeciding] = useState<{ id: string; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  if (job.isLoading) return <Spinner />;
  if (!job.data) return <ProblemAlert error={job.error} />;
  const j = job.data;
  return (
    <>
      <Link to="/portal" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" /> All shipments</Link>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="font-mono text-xl font-semibold">{j.blNo}</h1><p className="text-sm text-muted">{j.commodity} · {j.vessel ?? '—'} · ETA {fmtDate(j.eta)}</p></div>
        <Badge tone="info">{j.phaseLabel}</Badge>
      </div>
      {j.pendingApprovals.map((a) => (
        <Card key={a.id} title="Please approve these charges" className="mb-4 border-warn/40">
          <ChargesTable s={a.summary} />
          <div className="mt-3 flex gap-2">
            <Button variant="primary" onClick={() => setDeciding({ id: a.id, decision: 'APPROVED' })}><Check className="size-4" /> Approve</Button>
            <Button onClick={() => setDeciding({ id: a.id, decision: 'REJECTED' })}>Dispute</Button>
          </div>
        </Card>
      ))}
      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <Card title="Clearance progress">
          <ol className="space-y-3">
            {j.milestones.map((m) => (
              <li key={m.key} className="flex items-start gap-2">
                {m.done ? <CheckCircle2 className="mt-0.5 size-4 text-ok" /> : <Circle className="mt-0.5 size-4 text-line" />}
                <div><p className={clsx('text-sm', m.done ? 'font-medium' : 'text-muted')}>{MILESTONE[m.key] ?? m.key}</p>{m.completedAt && <p className="text-xs text-muted">{fmtDateTime(m.completedAt)}</p>}</div>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Containers" padded={false}>
          <ul>
            {j.containers.map((c) => {
              const free = daysUntil(c.freeTimeExpiresAt);
              return (
                <li key={c.id} className="flex items-center justify-between border-b border-line px-4 py-3 last:border-0">
                  <div><p className="font-mono text-sm font-medium">{c.containerNo}</p><p className="text-xs text-muted">{c.sizeType}{c.deliveredAt && ` · delivered ${fmtDateTime(c.deliveredAt)}${c.receiverName ? ` to ${c.receiverName}` : ''}`}</p></div>
                  <div className="text-end">
                    <Badge tone={c.status === 'DELIVERED' || c.status === 'EMPTY_RETURNED' ? 'ok' : 'info'}>{humanize(c.status)}</Badge>
                    {free !== null && free <= 3 && !c.deliveredAt && <p className="mt-1 text-xs text-warn">Free time ends {fmtDate(c.freeTimeExpiresAt)}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Documents" padded={false}>
          {!j.documents.length ? <p className="p-4 text-sm text-muted">No shared documents yet.</p> : <ul>{j.documents.map((d) => <li key={d.id} className="border-b border-line px-4 py-2.5 last:border-0"><a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-brand-2 hover:underline"><FileText className="size-4" />{humanize(d.docType)} — {d.fileName}</a></li>)}</ul>}
        </Card>
        <Card title="Invoices" padded={false}>
          {!j.invoices.length ? <p className="p-4 text-sm text-muted">No invoices yet.</p> : <ul>{j.invoices.map((i) => <li key={i.id} className="flex justify-between border-b border-line px-4 py-2.5 text-sm last:border-0"><span className="font-mono">{i.invoiceNo}</span><span>{fmtMoney(i.total, i.currency)} <Badge tone={i.status === 'PAID' ? 'ok' : 'warn'}>{i.status === 'PAID' ? 'paid' : `due ${fmtDate(i.dueDate)}`}</Badge></span></li>)}</ul>}
        </Card>
      </div>
      {deciding && <DecisionModal approvalId={deciding.id} decision={deciding.decision} onClose={() => setDeciding(null)} />}
    </>
  );
}

export function ChargesTable({ s }: { s: ApprovalSummary }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {s.lines.map((l, i) => <tr key={i} className="border-b border-line/70"><td className="py-1.5">{humanize(l.feeType)}{l.description && <span className="text-muted"> — {l.description}</span>}</td><td className="text-end tabular">{fmtMoney(l.amount, l.currency)}</td></tr>)}
        {s.totals.map((tt) => <tr key={tt.currency} className="font-semibold"><td className="py-1.5">Total</td><td className="text-end tabular">{fmtMoney(tt.amount, tt.currency)}</td></tr>)}
      </tbody>
    </table>
  );
}

function DecisionModal({ approvalId, decision, onClose }: { approvalId: string; decision: 'APPROVED' | 'REJECTED'; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const save = useMutation({ mutationFn: () => api.post(`/v1/portal/approvals/${approvalId}/decision`, { decision, note: note || undefined }), onSuccess: () => { void qc.invalidateQueries(); onClose(); } });
  return (
    <Modal open onClose={onClose} title={decision === 'APPROVED' ? 'Approve charges' : 'Dispute charges'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{decision === 'APPROVED' ? 'Approve' : 'Send dispute'}</Button></>}>
      <Field label={decision === 'APPROVED' ? 'Note (optional)' : 'What is wrong?'}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="mt-3"><ProblemAlert error={save.error} /></div>
    </Modal>
  );
}
