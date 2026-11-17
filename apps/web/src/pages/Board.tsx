import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { AlertTriangle, Clock, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useStaff } from '../lib/hooks';
import { daysUntil, fmtDate, fmtMoneyWhole, relative } from '../lib/format';
import { PriorityBadge } from '../components/StatusBadge';
import { Badge, Button, PageHeader, Select, Spinner, Stat } from '../components/ui';

export type BoardItem = {
  jobId: string; jobNo: string; blNo: string; customerId: string; customerName: string; phase: string; eta: string | null; priority: string;
  coordinatorId: string | null; coordinatorName: string | null; containersTotal: number; containersDelivered: number; stages: Record<string, string>;
  nextSlaDueAt: string | null; overdue: boolean; freeTimeNext: string | null; updatedAt: string;
};
const COLUMNS = ['DOCUMENTS', 'CLEARANCE', 'CCRO', 'DELIVERY', 'READY_TO_CLOSE'] as const;
const TRACK = ['DOCUMENTS', 'BAYAN', 'CUSTOMER_COMM', 'INSPECTION', 'DO', 'CCRO'];
const DONE = new Set(['VERIFIED', 'DUTIES_PAID', 'CONFIRMED', 'CLEARED', 'COMPLETED', 'DO_RECEIVED', 'ISSUED']);
const SHORT: Record<string, string> = { DOCUMENTS: 'Docs', BAYAN: 'Bayan', CUSTOMER_COMM: 'Cust', INSPECTION: 'Insp', DO: 'DO', CCRO: 'CCRO' };

export function JobCard({ j }: { j: BoardItem }) {
  const free = daysUntil(j.freeTimeNext);
  return (
    <Link to="/jobs/$jobId" params={{ jobId: j.jobId }} className={clsx('block rounded-xl border bg-white p-3 shadow-[0_1px_2px_rgba(15,27,42,0.04)] transition hover:border-brand hover:shadow-md', j.overdue ? 'border-bad/40' : 'border-line')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-semibold">{j.blNo}</p>
          <p className="truncate text-xs text-muted">{j.customerName}</p>
        </div>
        <PriorityBadge p={j.priority} />
      </div>
      <div className="mt-2 flex gap-1" aria-label="BL stages">
        {TRACK.map((k) => (
          <span key={k} title={`${k}: ${j.stages[k] ?? '—'}`} className={clsx('h-1.5 flex-1 rounded-full', DONE.has(j.stages[k] ?? '') ? 'bg-ok' : j.stages[k] && !['NOT_STARTED', 'PENDING', 'AWAITING', 'DRAFT'].includes(j.stages[k]!) ? 'bg-info' : 'bg-line')} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">{TRACK.map((k) => <span key={k}>{SHORT[k]}</span>)}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <Badge>{j.containersDelivered}/{j.containersTotal} delivered</Badge>
        {j.overdue && <Badge tone="bad"><Clock className="size-3" /> overdue</Badge>}
        {free !== null && free <= 3 && j.phase !== 'READY_TO_CLOSE' && <Badge tone={free <= 1 ? 'bad' : 'warn'}><AlertTriangle className="size-3" /> free time {free <= 0 ? 'ends today' : `${free}d`}</Badge>}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted">
        <span>{j.jobNo}</span>
        <span>{j.nextSlaDueAt && !j.overdue ? `next due ${relative(j.nextSlaDueAt)}` : `ETA ${fmtDate(j.eta)}`}</span>
      </div>
    </Link>
  );
}

export function BoardPage() {
  const { t } = useTranslation();
  const coordinators = useStaff('COORDINATOR');
  const [coordinatorId, setCoordinatorId] = useState('');
  const [priority, setPriority] = useState('');
  const board = useQuery({ queryKey: ['board'], queryFn: () => api.get<{ items: BoardItem[] }>('/insight/board').then((r) => r.items), refetchInterval: 20_000 });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<{ kpis: Record<string, string | number> }>('/insight/dashboard'), refetchInterval: 60_000 });
  const items = useMemo(() => (board.data ?? []).filter((j) => (!coordinatorId || j.coordinatorId === coordinatorId) && (!priority || j.priority === priority)), [board.data, coordinatorId, priority]);
  const k = dash.data?.kpis;

  return (
    <>
      <PageHeader
        title={t('board.title')}
        subtitle={t('board.subtitle')}
        actions={
          <>
            <Select value={coordinatorId} onChange={(e) => setCoordinatorId(e.target.value)} className="w-44" aria-label="Coordinator">
              <option value="">All coordinators</option>{(coordinators.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-36" aria-label="Priority">
              <option value="">All priorities</option><option value="URGENT">Urgent</option><option value="HIGH">High</option><option value="NORMAL">Normal</option>
            </Select>
            <Link to="/jobs/new"><Button variant="primary"><Plus className="size-4" /> {t('board.newJob')}</Button></Link>
          </>
        }
      />
      {k && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Open jobs" value={k.open_jobs} />
          <Stat label="Overdue" value={k.overdue_jobs} tone={Number(k.overdue_jobs) ? 'bad' : undefined} />
          <Stat label="Containers active" value={k.active_containers} />
          <Stat label="Free time ≤ 3 days" value={k.free_time_risk} tone={Number(k.free_time_risk) ? 'warn' : undefined} hint="Demurrage risk" />
          <Stat label="Unbilled payments" value={fmtMoneyWhole(String(k.unbilled_amount ?? 0))} />
          <Stat label="Avg. days to delivery" value={k.avg_days_to_delivery ?? '—'} hint="Last 90 days" />
        </div>
      )}
      {board.isLoading ? <Spinner /> : (
        <div className="grid grid-cols-1 gap-4 overflow-x-auto pb-2 md:grid-cols-[repeat(5,minmax(210px,1fr))]">
          {COLUMNS.map((col) => {
            const list = items.filter((j) => j.phase === col);
            return (
              <div key={col} className="flex min-w-[210px] flex-col rounded-xl bg-[#eef1f5] p-2">
                <div className="flex items-center justify-between px-1.5 py-1.5">
                  <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{t(`phase.${col}`)}</h2>
                  <span className="rounded-full bg-white px-2 text-xs font-medium text-muted">{list.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {list.map((j) => <JobCard key={j.jobId} j={j} />)}
                  {!list.length && <p className="px-2 py-6 text-center text-xs text-muted">No jobs</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
