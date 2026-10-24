import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ChevronRight, Clock, Lock, Package, User } from 'lucide-react';
import { api } from '../lib/api';
import { useStaff } from '../lib/hooks';
import { useSession } from '../lib/session';
import { humanize, relative } from '../lib/format';
import { L } from '../lib/i18n';
import { StageStatus, PriorityBadge } from '../components/StatusBadge';
import { TransitionDialog } from '../components/TransitionDialog';
import { Card, Empty, PageHeader, Select, Spinner, Button } from '../components/ui';
import type { I18n, NextStep, StageField } from '../components/types';

export type Task = {
  stageInstanceId: string; jobId: string; jobNo: string; blNo: string; customerName: string; priority: string; containerId: string | null; containerNo: string | null;
  stageKey: string; stageLabel: I18n; ownerRole: string; status: string; statusLabel?: I18n; fields: StageField[]; data: Record<string, unknown>;
  assignee: { id: string; name: string; role: string } | null; slaDueAt: string | null; overdue: boolean; nextSteps: NextStep[];
};

function TaskCard({ task, onAction, assignSteps }: { task: Task; onAction: (t: Task, s: NextStep) => void; assignSteps: boolean }) {
  const waiting = [...new Set(task.nextSteps.filter((s) => !s.gateOpen).flatMap((s) => s.waitingFor))];
  return (
    <div className={clsx('min-w-0 rounded-2xl border bg-white p-4', task.overdue ? 'border-bad/40' : 'border-line')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-semibold">{L(task.stageLabel)}</p>
          <p className="truncate text-sm text-muted">
            <span className="font-mono">{task.containerNo ?? task.blNo}</span> · {task.customerName}
          </p>
        </div>
        <StageStatus s={{ status: task.status, statusLabel: task.statusLabel, overdue: task.overdue }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <PriorityBadge p={task.priority} />
        {(assignSteps || task.assignee) && <span className="inline-flex items-center gap-1"><User className="size-3.5" />{task.assignee?.name ?? `Unassigned · ${humanize(task.ownerRole)}`}</span>}
        {task.slaDueAt && <span className={clsx('inline-flex items-center gap-1', task.overdue && 'font-medium text-bad')}><Clock className="size-3.5" />{task.overdue ? 'Overdue' : 'Due'} {relative(task.slaDueAt)}</span>}
        <Link to="/jobs/$jobId" params={{ jobId: task.jobId }} className="ms-auto inline-flex items-center text-brand-2">{task.jobNo} <ChevronRight className="size-3.5 rtl:rotate-180" /></Link>
      </div>
      {task.nextSteps.length > 0 && (
        <div className="mt-3 grid gap-2">
          {task.nextSteps.map((s) => (
            <Button key={s.to} variant={s.primary && s.gateOpen ? 'primary' : 'secondary'} disabled={!s.gateOpen} onClick={() => onAction(task, s)} className="w-full">
              {!s.gateOpen && <Lock className="size-4" />} {L(s.label)}
            </Button>
          ))}
        </div>
      )}
      {waiting.length > 0 && <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Waiting for: {waiting.join(' · ')}</p>}
    </div>
  );
}

/** Open work across all jobs, overdue first. Filter by staff member to see one person's list. */
export function TasksPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const staff = useStaff();
  const assignSteps = useSession().data?.company.assignSteps ?? false;
  const [staffId, setStaffId] = useState('');
  const [active, setActive] = useState<{ task: Task; step: NextStep } | null>(null);
  const tasks = useQuery({
    queryKey: ['tasks', staffId],
    queryFn: () => api.get<{ items: Task[] }>(`/workflow/tasks${staffId ? `?staffId=${staffId}` : ''}`).then((r) => r.items),
    refetchInterval: 30_000,
  });
  return (
    <>
      <PageHeader
        title={t('nav.tasks')}
        subtitle="Open stages that can be worked on now, overdue first."
        actions={assignSteps && (
          <Select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="w-60" aria-label="Staff member">
            <option value="">Everyone</option>
            <option value="unassigned">Unassigned</option>
            {(staff.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} · {humanize(p.role)}</option>)}
          </Select>
        )}
      />
      {tasks.isLoading ? <Spinner /> : !tasks.data?.length ? <Card><Empty icon={<Package className="size-8" />} title="No open tasks">Nothing is waiting here right now.</Empty></Card> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{tasks.data.map((x) => <TaskCard key={x.stageInstanceId} task={x} assignSteps={assignSteps} onAction={(task, step) => setActive({ task, step })} />)}</div>
      )}
      {active && (
        <TransitionDialog
          jobId={active.task.jobId}
          stage={{ id: active.task.stageInstanceId, key: active.task.stageKey, label: active.task.stageLabel, fields: active.task.fields, data: active.task.data, assignee: active.task.assignee }}
          step={active.step}
          onClose={() => setActive(null)}
          onDone={() => {
            setActive(null);
            void qc.invalidateQueries({ queryKey: ['tasks'] });
          }}
        />
      )}
    </>
  );
}
