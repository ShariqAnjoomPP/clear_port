import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { AlertTriangle, ChevronRight, Clock, Lock, LogOut, Package, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOutbox } from '../lib/hooks';
import { relative } from '../lib/format';
import i18n, { L, setLanguage } from '../lib/i18n';
import { discardQueued } from '../lib/offline';
import { Brand, SyncPill } from '../layouts/AppShell';
import { StageStatus, PriorityBadge } from '../components/StatusBadge';
import { TransitionDialog } from '../components/TransitionDialog';
import { Badge, Button, Card, Empty, PageHeader, Spinner } from '../components/ui';
import type { I18n, NextStep, StageField } from '../components/types';

export type Task = {
  stageInstanceId: string; jobId: string; jobNo: string; blNo: string; customerName: string; priority: string; containerId: string | null; containerNo: string | null;
  stageKey: string; stageLabel: I18n; ownerRole: string; status: string; statusLabel?: I18n; fields: StageField[]; data: Record<string, unknown>; version: number;
  slaDueAt: string | null; overdue: boolean; nextSteps: NextStep[];
};

const useTasks = () => useQuery({ queryKey: ['tasks'], queryFn: () => api.get<{ items: Task[] }>('/v1/workflow/tasks').then((r) => r.items), refetchInterval: 30_000 });

function TaskCard({ task, offline, onAction }: { task: Task; offline?: boolean; onAction: (t: Task, s: NextStep) => void }) {
  const waiting = [...new Set(task.nextSteps.filter((s) => !s.gateOpen).flatMap((s) => s.waitingFor))];
  return (
    <div className={clsx('rounded-2xl border bg-white p-4', task.overdue ? 'border-bad/40' : 'border-line')}>
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
        {task.slaDueAt && <span className={clsx('inline-flex items-center gap-1', task.overdue && 'font-medium text-bad')}><Clock className="size-3.5" />{task.overdue ? 'Overdue' : 'Due'} {relative(task.slaDueAt)}</span>}
        {!offline && <Link to="/jobs/$jobId" params={{ jobId: task.jobId }} className="ms-auto inline-flex items-center text-brand-2">{task.jobNo} <ChevronRight className="size-3.5 rtl:rotate-180" /></Link>}
      </div>
      {task.nextSteps.length > 0 && (
        <div className="mt-3 grid gap-2">
          {task.nextSteps.map((s) => (
            <Button key={s.to} size="lg" variant={s.primary && s.gateOpen ? 'primary' : 'secondary'} disabled={!s.gateOpen} onClick={() => onAction(task, s)} className="w-full">
              {!s.gateOpen && <Lock className="size-4" />} {L(s.label)}
            </Button>
          ))}
        </div>
      )}
      {waiting.length > 0 && <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Waiting for: {waiting.join(' · ')}</p>}
    </div>
  );
}

function useTaskDialog(offline: boolean) {
  const qc = useQueryClient();
  const [active, setActive] = useState<{ task: Task; step: NextStep } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dialog = active && (
    <TransitionDialog
      jobId={active.task.jobId}
      stage={{ id: active.task.stageInstanceId, key: active.task.stageKey, label: active.task.stageLabel, fields: active.task.fields, data: active.task.data, version: active.task.version }}
      step={active.step}
      offline={offline}
      onClose={() => setActive(null)}
      onDone={(queued) => {
        setActive(null);
        setToast(queued ? i18n.t('field.queued') : 'Saved');
        setTimeout(() => setToast(null), 3000);
        void qc.invalidateQueries({ queryKey: ['tasks'] });
      }}
    />
  );
  return { open: (task: Task, step: NextStep) => setActive({ task, step }), dialog, toast };
}

/** Back-office "My tasks" (OPS-005). */
export function TasksPage() {
  const { t } = useTranslation();
  const tasks = useTasks();
  const { open, dialog, toast } = useTaskDialog(false);
  return (
    <>
      <PageHeader title={t('nav.tasks')} subtitle="Stages assigned to you, overdue first." />
      {toast && <div className="mb-3 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{toast}</div>}
      {tasks.isLoading ? <Spinner /> : !tasks.data?.length ? <Card><Empty icon={<Package className="size-8" />} title="No open tasks">{t('field.empty')}</Empty></Card> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{tasks.data.map((x) => <TaskCard key={x.stageInstanceId} task={x} onAction={open} />)}</div>
      )}
      {dialog}
    </>
  );
}

/** Field app (PRO, inspector, driver): one-thumb, offline-first task list (NFR-007, NFR-009). */
export function FieldPage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const tasks = useTasks();
  const queued = useOutbox();
  const { open, dialog, toast } = useTaskDialog(true);
  return (
    <div className="min-h-full bg-canvas pb-10">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-navy px-4 py-3 text-white">
        <Brand />
        <div className="flex items-center gap-2">
          <button onClick={() => setLanguage(i18n.language === 'ar' ? 'en' : 'ar')} className="rounded-lg px-2 py-1 text-sm text-white/80 hover:bg-white/10">{t('common.language')}</button>
          <button onClick={() => void logout()} className="rounded-lg p-2 text-white/80 hover:bg-white/10" aria-label={t('common.signOut')}><LogOut className="size-4" /></button>
        </div>
      </header>
      <div className="mx-auto max-w-xl space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{t('field.title')}</h1>
            <p className="text-xs text-muted">{user?.name} · {user?.roles.join(', ').toLowerCase()}</p>
          </div>
          <SyncPill />
        </div>
        {toast && <div className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{toast}</div>}
        {queued.length > 0 && (
          <Card title="Saved on this device">
            <ul className="space-y-2 text-sm">
              {queued.map((q) => (
                <li key={q.id} className="flex items-start justify-between gap-2">
                  <div>
                    <p>{q.label}</p>
                    {q.status === 'failed' ? <p className="flex items-center gap-1 text-xs text-bad"><AlertTriangle className="size-3.5" /> {q.error}</p> : <p className="text-xs text-muted">Waiting for connection</p>}
                  </div>
                  {q.status === 'failed' && <button className="text-muted hover:text-bad" onClick={() => void discardQueued(q.id)} aria-label="Discard"><Trash2 className="size-4" /></button>}
                </li>
              ))}
            </ul>
          </Card>
        )}
        {tasks.isLoading ? <Spinner /> : !tasks.data?.length ? <Card><Empty icon={<Package className="size-8" />} title={t('field.empty')} /></Card> : tasks.data.map((x) => <TaskCard key={x.stageInstanceId} task={x} offline onAction={open} />)}
        {tasks.error && <Badge tone="warn">Showing saved tasks — no connection</Badge>}
      </div>
      {dialog}
    </div>
  );
}
