import { err, ok, type Result } from '@clearport/kernel';
import { stageDef } from './catalog';
import { evaluateGuard } from './guards';
import type { GuardContext, StageAction, StageDef, TransitionDef, WorkflowDefinition } from './types';

export type TransitionError =
  | { code: 'UNKNOWN_STAGE'; stageKey: string }
  | { code: 'INVALID_TRANSITION'; from: string; to: string; allowed: string[] }
  | { code: 'GATE_NOT_MET'; unmet: { code: string; message: string }[] }
  | { code: 'MISSING_FIELDS'; fields: string[] }
  | { code: 'MISSING_DOCUMENT'; documentType: string };

export interface TransitionPlan {
  stage: StageDef;
  transition: TransitionDef;
  from: string;
  to: string;
  done: boolean;
  /** Merged stage data after applying the request's fields. */
  data: Record<string, unknown>;
  actions: StageAction[];
}

export interface TransitionRequest {
  stageKey: string;
  currentStatus: string;
  to: string;
  fields: Record<string, unknown>;
  storedData: Record<string, unknown>;
  documentTypesOnJob: string[];
  ctx: GuardContext;
}

const present = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

/** Pure decision function: validates a requested status change against the catalogue. No I/O. */
export function planTransition(wf: WorkflowDefinition, req: TransitionRequest): Result<TransitionPlan, TransitionError> {
  const stage = stageDef(wf, req.stageKey);
  if (!stage) return err({ code: 'UNKNOWN_STAGE', stageKey: req.stageKey });

  const transition = stage.transitions.find((t) => t.to === req.to && t.from.includes(req.currentStatus));
  if (!transition) {
    return err({ code: 'INVALID_TRANSITION', from: req.currentStatus, to: req.to, allowed: availableTransitions(stage, req.currentStatus).map((t) => t.to) });
  }

  const gate = evaluateGuard(transition.guard, req.ctx, wf);
  if (!gate.ok) return err({ code: 'GATE_NOT_MET', unmet: gate.unmet });

  const data = { ...req.storedData, ...Object.fromEntries(Object.entries(req.fields).filter(([, v]) => v !== undefined)) };
  const missing = (transition.requiredFields ?? []).filter((f) => !present(data[f]));
  if (missing.length) return err({ code: 'MISSING_FIELDS', fields: missing });

  if (transition.requiresDocument && !req.documentTypesOnJob.includes(transition.requiresDocument)) {
    return err({ code: 'MISSING_DOCUMENT', documentType: transition.requiresDocument });
  }

  const done = !!stage.statuses.find((s) => s.key === transition.to)?.done;
  return ok({ stage, transition, from: req.currentStatus, to: transition.to, done, data, actions: stage.onEnter?.[transition.to] ?? [] });
}

export const availableTransitions = (stage: StageDef, status: string): TransitionDef[] =>
  stage.transitions.filter((t) => t.from.includes(status));

/** For the UI: each next step and whether its gate is open, with reasons. */
export function describeNextSteps(wf: WorkflowDefinition, stageKey: string, status: string, ctx: GuardContext) {
  const stage = stageDef(wf, stageKey);
  if (!stage) return [];
  return availableTransitions(stage, status).map((t) => {
    const gate = evaluateGuard(t.guard, ctx, wf);
    return { to: t.to, label: t.label, primary: !!t.primary, requiredFields: t.requiredFields ?? [], requiresDocument: t.requiresDocument ?? null, gateOpen: gate.ok, waitingFor: gate.unmet.map((u) => u.message) };
  });
}

/** Initial status for a container stage when spawned after CCRO (physical inspection only if selected). */
export function initialContainerStatus(stage: StageDef, containerId: string, selectedForInspection: string[]): string {
  if (stage.key === 'PHYSICAL_INSPECTION' && !selectedForInspection.includes(containerId)) return 'NOT_REQUIRED';
  return stage.initial;
}

export type JobPhase = 'DOCUMENTS' | 'CLEARANCE' | 'CCRO' | 'DELIVERY' | 'READY_TO_CLOSE' | 'CLOSED';

/** Board column for a job, derived from its stage states. */
export function deriveJobPhase(input: {
  closed: boolean;
  jobStages: Record<string, string>;
  containerDelivery: string[]; // DELIVERY status per container (empty before CCRO)
}): JobPhase {
  if (input.closed) return 'CLOSED';
  const s = input.jobStages;
  if (s.DOCUMENTS !== 'VERIFIED') return 'DOCUMENTS';
  if (s.CCRO === 'ISSUED') {
    const allDelivered = input.containerDelivery.length > 0 && input.containerDelivery.every((d) => d === 'DELIVERED' || d === 'EMPTY_RETURNED');
    return allDelivered ? 'READY_TO_CLOSE' : 'DELIVERY';
  }
  const doDone = s.DO === 'DO_RECEIVED';
  const customsDone = s.INSPECTION === 'CLEARED' || s.INSPECTION === 'COMPLETED';
  return doDone && customsDone ? 'CCRO' : 'CLEARANCE';
}
