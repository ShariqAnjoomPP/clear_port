/**
 * The clearance workflow is configuration, not code (ADR-008). These types describe a versioned
 * stage catalogue stored per tenant as JSONB; the engine interprets it.
 */
export type Level = 'JOB' | 'CONTAINER';
export type I18nText = { en: string; ar: string };

export interface StatusDef {
  key: string;
  label: I18nText;
  /** A "done" status satisfies downstream gates and stops the SLA clock. */
  done?: boolean;
}

/** Composable gate rules (Specification pattern). */
export type Guard =
  | { all: Guard[] }
  | { any: Guard[] }
  | { stage: string; statusIn: string[] }
  | { containerStage: string; statusIn: string[] }
  | { assigned: true };

export type StageAction =
  | 'SPAWN_CONTAINER_STAGES'
  | 'REQUEST_CUSTOMER_APPROVAL'
  | 'CHECK_JOB_COMPLETE'
  | `NOTIFY_CUSTOMER:${string}`;

export interface TransitionDef {
  from: string[];
  to: string;
  label: I18nText;
  guard?: Guard;
  /** Fields that must be present in the request (or already stored on the stage). */
  requiredFields?: string[];
  /** A document type that must be attached to the job before this transition. */
  requiresDocument?: string;
  /** Visually emphasised in the UI (the "happy path" button). */
  primary?: boolean;
}

export interface StageDef {
  key: string;
  level: Level;
  order: number;
  phase: 'DOCUMENTS' | 'CUSTOMS' | 'DO' | 'CCRO' | 'DELIVERY';
  label: I18nText;
  /** Role expected to own the stage, used for assignment pickers and the field app. */
  ownerRole: 'COORDINATOR' | 'PRO' | 'INSPECTOR' | 'DRIVER';
  statuses: StatusDef[];
  initial: string;
  transitions: TransitionDef[];
  slaHours?: number;
  /** Fields captured on this stage, rendered by the generic stage form. */
  fields?: { key: string; label: I18nText; type: 'text' | 'date' | 'datetime' | 'textarea' | 'containers' | 'signature' }[];
  onEnter?: Partial<Record<string, StageAction[]>>;
}

export interface WorkflowDefinition {
  version: number;
  stages: StageDef[];
}

/** Current state used when evaluating guards. */
export interface StageState {
  status: string;
  assigneeId: string | null;
}

export interface GuardContext {
  jobStages: Record<string, StageState>;
  /** Stages of the same container, when evaluating a container-level transition. */
  containerStages?: Record<string, StageState>;
  self: StageState;
}
