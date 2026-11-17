import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { AlertTriangle, Clock } from 'lucide-react';
import { daysUntil, fmtDate } from '../lib/format';
import { phaseTone, PriorityBadge } from './StatusBadge';
import { Badge } from './ui';
import type { JobSummary } from './types';

const TRACK = ['DOCUMENTS', 'BAYAN', 'CUSTOMER_COMM', 'INSPECTION', 'DO', 'CCRO'];
const DONE = new Set(['VERIFIED', 'DUTIES_PAID', 'CONFIRMED', 'CLEARED', 'COMPLETED', 'DO_RECEIVED', 'ISSUED']);
const STARTED = (s?: string) => !!s && !['NOT_STARTED', 'PENDING', 'AWAITING', 'DRAFT'].includes(s);

/** Six-segment bar for the job-level stages: done (filled), in progress (tonal), not started. */
export function JobProgress({ stages }: { stages: Record<string, string> }) {
  return (
    <div className="flex gap-1" aria-hidden>
      {TRACK.map((k) => (
        <span key={k} className={clsx('h-1.5 flex-1 rounded-full', DONE.has(stages[k] ?? '') ? 'bg-primary' : STARTED(stages[k]) ? 'bg-primary/40' : 'bg-surface-container-highest')} />
      ))}
    </div>
  );
}

/** One job in a list: B/L, customer, phase, progress, and warnings that need action. */
export function JobListItem({ j }: { j: JobSummary }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const free = daysUntil(j.freeTimeNext);
  return (
    <button onClick={() => void navigate({ to: '/jobs/$jobId', params: { jobId: j.jobId } })} className="block w-full px-4 py-3 text-start transition hover:bg-on-surface/4 active:bg-on-surface/8">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-[15px] font-semibold text-on-surface">{j.blNo}</p>
          <p className="truncate text-sm text-on-surface-variant">{j.customerName}</p>
        </div>
        <Badge tone={phaseTone(j.phase)}>{t(`phase.${j.phase}`)}</Badge>
      </div>
      <div className="mt-2.5"><JobProgress stages={j.stages} /></div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-on-surface-variant">
        <span>{j.jobNo}</span>
        <span aria-hidden>·</span>
        <span>{j.containersDelivered}/{j.containersTotal} delivered</span>
        <span aria-hidden>·</span>
        <span>ETA {fmtDate(j.eta)}</span>
        <PriorityBadge p={j.priority} />
        {j.overdue && <Badge tone="bad"><Clock className="size-3" /> Overdue</Badge>}
        {free !== null && free <= 3 && j.phase !== 'READY_TO_CLOSE' && j.phase !== 'CLOSED' && <Badge tone={free <= 1 ? 'bad' : 'warn'}><AlertTriangle className="size-3" /> Free time {free <= 0 ? 'ends today' : `${free}d`}</Badge>}
      </div>
    </button>
  );
}

