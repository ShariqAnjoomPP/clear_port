import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Plus, XCircle } from 'lucide-react';
import { CONTAINER_TYPES } from '@clearport/contracts';
import { parseContainerList, validateContainerNo } from '@clearport/kernel';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCustomers, useMaster, useUsers } from '../lib/hooks';
import { fmtDate, fmtMoney } from '../lib/format';
import { phaseTone, PriorityBadge } from '../components/StatusBadge';
import { Badge, Button, Card, Field, Input, PageHeader, ProblemAlert, Select, Spinner, Table, Textarea } from '../components/ui';
import type { BoardItem } from './Board';

export function JobsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const search = useSearch({ strict: false }) as { q?: string };
  const navigate = useNavigate();
  const [q, setQ] = useState(search.q ?? '');
  const [status, setStatus] = useState('OPEN');
  useEffect(() => setQ(search.q ?? ''), [search.q]);
  const jobs = useQuery({
    queryKey: ['jobs', search.q ?? '', status],
    queryFn: () => api.get<{ items: BoardItem[] }>(`/v1/clearance/jobs?status=${status}&q=${encodeURIComponent(search.q ?? '')}`).then((r) => r.items),
  });
  return (
    <>
      <PageHeader title={t('nav.jobs')} subtitle="Search by BL, job, customer, container, Bayan, DO or CCRO number" actions={can('job.create') && <Link to="/jobs/new"><Button variant="primary"><Plus className="size-4" /> {t('board.newJob')}</Button></Link>} />
      <Card padded={false}>
        <form className="flex flex-wrap gap-2 border-b border-line p-3" onSubmit={(e) => { e.preventDefault(); void navigate({ to: '/jobs', search: { q } }); }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} className="max-w-md" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="OPEN">Open</option><option value="CLOSED">Closed</option><option value="">All</option></Select>
          <Button type="submit">Search</Button>
        </form>
        {jobs.isLoading ? <Spinner /> : (
          <Table>
            <thead><tr><th>Job</th><th>BL</th><th>{t('common.customer')}</th><th>Stage</th><th>{t('common.containers')}</th><th>{t('common.eta')}</th><th>Coordinator</th></tr></thead>
            <tbody>
              {(jobs.data ?? []).map((j) => (
                <tr key={j.jobId} className="cursor-pointer" onClick={() => void navigate({ to: '/jobs/$jobId', params: { jobId: j.jobId } })}>
                  <td className="font-medium">{j.jobNo}</td>
                  <td className="font-mono">{j.blNo} <PriorityBadge p={j.priority} /></td>
                  <td>{j.customerName}</td>
                  <td><Badge tone={phaseTone(j.phase)}>{t(`phase.${j.phase}`)}</Badge> {j.overdue && <Badge tone="bad">overdue</Badge>}</td>
                  <td className="tabular">{j.containersDelivered}/{j.containersTotal}</td>
                  <td>{fmtDate(j.eta)}</td>
                  <td className="text-muted">{j.coordinatorName ?? '—'}</td>
                </tr>
              ))}
              {!jobs.data?.length && <tr><td colSpan={7} className="py-10 text-center text-muted">No jobs match.</td></tr>}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

/** BL intake (JOB-001…005): header fields + bulk container paste with live ISO 6346 validation. */
export function NewJobPage() {
  const navigate = useNavigate();
  const customers = useCustomers();
  const lines = useMaster('SHIPPING_LINE');
  const ports = useMaster('PORT');
  const terminals = useMaster('TERMINAL');
  const users = useUsers();
  const [f, setF] = useState({ customerId: '', blNo: '', vessel: '', voyage: '', shippingLineCode: '', portOfLoading: '', portOfDischarge: 'AEJEA', terminal: '', eta: '', commodity: '', hsCodes: '', shippingDetails: '', priority: 'NORMAL', coordinatorId: '' });
  const [paste, setPaste] = useState('');
  const [sizeType, setSizeType] = useState<string>('40HC');
  const [freeTime, setFreeTime] = useState('');
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const parsed = useMemo(() => parseContainerList(paste).map((c) => ({ raw: c, ...validateContainerNo(c) })), [paste]);
  const valid = parsed.filter((p) => p.valid);
  const credit = useQuery({
    queryKey: ['credit', f.customerId],
    queryFn: () => api.get<{ exposure: string; creditLimit: string | null; overLimit: boolean }>(`/v1/customers/${f.customerId}/credit-check`),
    enabled: !!f.customerId,
  });
  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/v1/clearance/jobs', {
        ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')),
        hsCodes: f.hsCodes.split(/[\s,]+/).filter(Boolean),
        containers: valid.map((p) => ({ containerNo: p.value, sizeType, freeTimeExpiresAt: freeTime || undefined })),
      }),
    onSuccess: (j) => void navigate({ to: '/jobs/$jobId', params: { jobId: j.id } }),
  });

  return (
    <>
      <PageHeader title="New clearance job" subtitle="Capture the BL once. Stages are created automatically from the workflow." />
      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <Card title="Bill of lading">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer" required className="sm:col-span-2">
              <Select value={f.customerId} onChange={(e) => set('customerId', e.target.value)}>
                <option value="">Select customer…</option>
                {(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.customsCode ? ` · ${c.customsCode}` : ''}</option>)}
              </Select>
            </Field>
            {credit.data?.overLimit && (
              <div className="flex items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn sm:col-span-2">
                <AlertTriangle className="size-4" /> Over credit limit: exposure {fmtMoney(credit.data.exposure)} vs limit {fmtMoney(credit.data.creditLimit)}. You can still create the job.
              </div>
            )}
            <Field label="BL number" required><Input value={f.blNo} onChange={(e) => set('blNo', e.target.value.toUpperCase())} className="font-mono" /></Field>
            <Field label="ETA" required><Input type="date" value={f.eta} onChange={(e) => set('eta', e.target.value)} /></Field>
            <Field label="Vessel"><Input value={f.vessel} onChange={(e) => set('vessel', e.target.value)} /></Field>
            <Field label="Voyage"><Input value={f.voyage} onChange={(e) => set('voyage', e.target.value)} /></Field>
            <Field label="Shipping line">
              <Select value={f.shippingLineCode} onChange={(e) => set('shippingLineCode', e.target.value)}>
                <option value="">—</option>{(lines.data ?? []).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={f.priority} onChange={(e) => set('priority', e.target.value)}><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></Select>
            </Field>
            <Field label="Port of loading">
              <Select value={f.portOfLoading} onChange={(e) => set('portOfLoading', e.target.value)}><option value="">—</option>{(ports.data ?? []).map((m) => <option key={m.code} value={m.code}>{m.name} ({m.code})</option>)}</Select>
            </Field>
            <Field label="Port of discharge">
              <Select value={f.portOfDischarge} onChange={(e) => set('portOfDischarge', e.target.value)}>{(ports.data ?? []).map((m) => <option key={m.code} value={m.code}>{m.name} ({m.code})</option>)}</Select>
            </Field>
            <Field label="Terminal">
              <Select value={f.terminal} onChange={(e) => set('terminal', e.target.value)}><option value="">—</option>{(terminals.data ?? []).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</Select>
            </Field>
            <Field label="Coordinator">
              <Select value={f.coordinatorId} onChange={(e) => set('coordinatorId', e.target.value)}>
                <option value="">Me</option>{(users.data ?? []).filter((u) => u.roles.includes('COORDINATOR')).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <Field label="Commodity" required><Input value={f.commodity} onChange={(e) => set('commodity', e.target.value)} /></Field>
            <Field label="HS codes" hint="Comma separated, e.g. 8418, 8450"><Input value={f.hsCodes} onChange={(e) => set('hsCodes', e.target.value)} /></Field>
            <Field label="Shipping details (optional)" className="sm:col-span-2"><Textarea value={f.shippingDetails} onChange={(e) => set('shippingDetails', e.target.value)} /></Field>
          </div>
        </Card>
        <div className="space-y-5">
          <Card title={`Containers (${valid.length})`}>
            <Field label="Paste container numbers" hint="One per line, or separated by commas or spaces. Duplicates are removed.">
              <Textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} className="font-mono" placeholder={'MSCU3000016\nMSCU3000021'} />
            </Field>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Size / type"><Select value={sizeType} onChange={(e) => setSizeType(e.target.value)}>{CONTAINER_TYPES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="Port free time ends"><Input type="date" value={freeTime} onChange={(e) => setFreeTime(e.target.value)} /></Field>
            </div>
            {parsed.length > 0 && (
              <ul className="mt-3 grid grid-cols-2 gap-1.5">
                {parsed.map((p) => (
                  <li key={p.raw} className={`flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs ${p.valid ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>
                    {p.valid ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />} {p.value}
                    {!p.valid && <span className="font-sans">· {p.error === 'FORMAT' ? 'format' : 'check digit'}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <ProblemAlert error={create.error} />
          <div className="flex justify-end gap-2">
            <Link to="/board"><Button variant="ghost">Cancel</Button></Link>
            <Button variant="primary" size="lg" loading={create.isPending} disabled={!f.customerId || !f.blNo || !f.eta || !f.commodity || !valid.length || valid.length !== parsed.length} onClick={() => create.mutate()}>
              Create job with {valid.length} container{valid.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
