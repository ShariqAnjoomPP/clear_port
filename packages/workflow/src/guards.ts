import type { Guard, GuardContext, WorkflowDefinition } from './types';
import { stageDef } from './catalog';

export interface GuardResult {
  ok: boolean;
  /** Human-readable, machine-stable reasons, e.g. "DO must be: DO received". */
  unmet: { code: string; message: string }[];
}

/** Evaluates a composed specification and explains every unmet condition (shown as "Waiting for: …"). */
export function evaluateGuard(guard: Guard | undefined, ctx: GuardContext, wf: WorkflowDefinition): GuardResult {
  if (!guard) return { ok: true, unmet: [] };

  const statusLabels = (stageKey: string, statuses: string[]) => {
    const def = stageDef(wf, stageKey);
    return statuses.map((s) => def?.statuses.find((x) => x.key === s)?.label.en ?? s).join(' or ');
  };

  if ('all' in guard) {
    const parts = guard.all.map((g) => evaluateGuard(g, ctx, wf));
    return { ok: parts.every((p) => p.ok), unmet: parts.flatMap((p) => p.unmet) };
  }
  if ('any' in guard) {
    const parts = guard.any.map((g) => evaluateGuard(g, ctx, wf));
    return parts.some((p) => p.ok) ? { ok: true, unmet: [] } : { ok: false, unmet: parts.flatMap((p) => p.unmet) };
  }
  if ('assigned' in guard) {
    return ctx.self.assigneeId
      ? { ok: true, unmet: [] }
      : { ok: false, unmet: [{ code: 'ASSIGNEE_REQUIRED', message: 'An assignee is required' }] };
  }
  if ('stage' in guard) {
    const s = ctx.jobStages[guard.stage];
    const ok = !!s && guard.statusIn.includes(s.status);
    const name = stageDef(wf, guard.stage)?.label.en ?? guard.stage;
    return ok ? { ok, unmet: [] } : { ok, unmet: [{ code: `STAGE:${guard.stage}`, message: `${name} must be: ${statusLabels(guard.stage, guard.statusIn)}` }] };
  }
  const s = ctx.containerStages?.[guard.containerStage];
  const ok = !!s && guard.statusIn.includes(s.status);
  const name = stageDef(wf, guard.containerStage)?.label.en ?? guard.containerStage;
  return ok
    ? { ok, unmet: [] }
    : { ok, unmet: [{ code: `CONTAINER_STAGE:${guard.containerStage}`, message: `${name} must be: ${statusLabels(guard.containerStage, guard.statusIn)}` }] };
}
