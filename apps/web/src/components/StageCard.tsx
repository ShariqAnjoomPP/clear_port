import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { CheckCircle2, Clock, Lock } from 'lucide-react';
import { api } from '../lib/api';
import { useStaff } from '../lib/hooks';
import { useSession } from '../lib/session';
import { relative, fmtDateTime } from '../lib/format';
import { L } from '../lib/i18n';
import { StageStatus } from './StatusBadge';
import { TransitionDialog } from './TransitionDialog';
import { Button, ProblemAlert, Select } from './ui';
import type { NextStep, StageView } from './types';

/** One workflow stage: status, owner, SLA, reference, and the next steps — locked steps say exactly what they wait for. */
export function StageCard({
  jobId, stage, canAssign, containers, onChanged, compact,
}: { jobId: string; stage: StageView; canAssign: boolean; containers: { id: string; containerNo: string }[]; onChanged: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  const staff = useStaff();
  // Per-step assignment is a company setting: off for a one-person agency, on for teams.
  const assignSteps = useSession().data?.company.assignSteps ?? false;
  const [step, setStep] = useState<NextStep | null>(null);
  const [assignError, setAssignError] = useState<unknown>(null);
  // People who usually own this kind of stage, plus coordinators who can step in.
  const candidates = (staff.data ?? []).filter((p) => p.role === stage.ownerRole || p.role === 'COORDINATOR');
  const waiting = stage.nextSteps.filter((s) => !s.gateOpen).flatMap((s) => s.waitingFor);
  const uniqueWaiting = [...new Set(waiting)];

  return (
    <div className={clsx('rounded-xl border bg-white p-4', stage.done ? 'border-ok/30' : stage.overdue ? 'border-bad/40' : 'border-line')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            {stage.done && <CheckCircle2 className="size-4 text-ok" aria-hidden />}
            {L(stage.label)}
          </p>
          {stage.referenceNo && <p className="mt-0.5 font-mono text-xs text-muted">{stage.referenceNo}</p>}
        </div>
        <StageStatus s={stage} />
      </div>

      {!compact && (
        <div className="mt-3 space-y-1.5 text-xs text-muted">
          {!assignSteps ? (
            stage.assignee && <p>{t('common.assignee')}: <span className="text-ink">{stage.assignee.name}</span></p>
          ) : canAssign && !stage.done ? (
            <Select
              aria-label={t('common.assignee')}
              className="h-8 text-xs"
              value={stage.assignee?.id ?? ''}
              onChange={async (e) => {
                setAssignError(null);
                try {
                  await api.put(`/workflow/jobs/${jobId}/stages/${stage.id}/assignee`, { assigneeId: e.target.value || null });
                  onChanged();
                } catch (err) {
                  setAssignError(err);
                }
              }}
            >
              <option value="">{t('common.unassigned')}</option>
              {candidates.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role.toLowerCase()}</option>)}
            </Select>
          ) : (
            <p>{t('common.assignee')}: <span className="text-ink">{stage.assignee?.name ?? t('common.unassigned')}</span></p>
          )}
          {stage.completedAt ? (
            <p>Completed {fmtDateTime(stage.completedAt)}</p>
          ) : stage.slaDueAt ? (
            <p className={clsx('flex items-center gap-1', stage.overdue && 'font-medium text-bad')}>
              <Clock className="size-3.5" /> {stage.overdue ? t('common.overdue') : t('common.due')} {relative(stage.slaDueAt)}
            </p>
          ) : null}
        </div>
      )}
      <ProblemAlert error={assignError} />

      {stage.nextSteps.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {stage.nextSteps.map((s) => (
            <Button key={s.to} size="sm" variant={s.primary && s.gateOpen ? 'primary' : 'secondary'} disabled={!s.gateOpen} onClick={() => setStep(s)} title={s.waitingFor.join('\n')}>
              {!s.gateOpen && <Lock className="size-3.5" aria-hidden />}
              {L(s.label)}
            </Button>
          ))}
        </div>
      )}
      {uniqueWaiting.length > 0 && (
        <div className="mt-2 rounded-lg bg-warn-soft px-2.5 py-1.5 text-xs text-warn">
          <span className="font-medium">{t('common.waitingFor')}:</span> {uniqueWaiting.join(' · ')}
        </div>
      )}
      {step && (
        <TransitionDialog
          jobId={jobId}
          stage={stage}
          step={step}
          containers={containers}
          onClose={() => setStep(null)}
          onDone={() => {
            setStep(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
