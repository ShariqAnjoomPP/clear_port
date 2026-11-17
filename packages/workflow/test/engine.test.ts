import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKFLOW as wf, deriveJobPhase, describeNextSteps, initialContainerStatus, planTransition, stageDef, type GuardContext } from '../src';

const ctx = (jobStages: Record<string, string>, assignee: string | null = 'u1', containerStages?: Record<string, string>): GuardContext => ({
  jobStages: Object.fromEntries(Object.entries(jobStages).map(([k, v]) => [k, { status: v, assigneeId: null }])),
  containerStages: containerStages && Object.fromEntries(Object.entries(containerStages).map(([k, v]) => [k, { status: v, assigneeId: null }])),
  self: { status: '', assigneeId: assignee },
});

const base = { fields: {}, storedData: {}, documentTypesOnJob: [] as string[] };

describe('CCRO gate (BRD CCR-001)', () => {
  it('blocks CCRO and lists every unmet condition', () => {
    const r = planTransition(wf, { ...base, stageKey: 'CCRO', currentStatus: 'NOT_STARTED', to: 'APPLIED', ctx: ctx({ DO: 'APPLIED', INSPECTION: 'AWAITING' }, null) });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.code === 'GATE_NOT_MET') {
      expect(r.error.unmet.map((u) => u.code)).toEqual(['STAGE:DO', 'STAGE:INSPECTION', 'ASSIGNEE_REQUIRED']);
      expect(r.error.unmet[0]!.message).toBe('Delivery order (DO) must be: DO received');
    } else throw new Error('expected GATE_NOT_MET');
  });

  it('opens when DO received, inspection done and a PRO is assigned', () => {
    const r = planTransition(wf, { ...base, stageKey: 'CCRO', currentStatus: 'NOT_STARTED', to: 'APPLIED', ctx: ctx({ DO: 'DO_RECEIVED', INSPECTION: 'CLEARED' }) });
    expect(r.ok).toBe(true);
  });

  it('spawns container stages when issued', () => {
    const r = planTransition(wf, { ...base, fields: { referenceNo: 'CC-1' }, stageKey: 'CCRO', currentStatus: 'APPLIED', to: 'ISSUED', ctx: ctx({}) });
    expect(r.ok && r.value.actions).toContain('SPAWN_CONTAINER_STAGES');
    expect(r.ok && r.value.done).toBe(true);
  });
});

describe('transition validation', () => {
  it('rejects transitions not in the catalogue', () => {
    const r = planTransition(wf, { ...base, stageKey: 'BAYAN', currentStatus: 'NOT_STARTED', to: 'DUTIES_PAID', ctx: ctx({ DOCUMENTS: 'VERIFIED' }) });
    expect(!r.ok && r.error.code).toBe('INVALID_TRANSITION');
  });
  it('requires fields such as the Bayan number', () => {
    const r = planTransition(wf, { ...base, stageKey: 'BAYAN', currentStatus: 'NOT_STARTED', to: 'FILED', ctx: ctx({ DOCUMENTS: 'VERIFIED' }) });
    expect(!r.ok && r.error).toEqual({ code: 'MISSING_FIELDS', fields: ['referenceNo'] });
  });
  it('uses stored data to satisfy required fields', () => {
    const r = planTransition(wf, { ...base, storedData: { referenceNo: 'B-77' }, stageKey: 'BAYAN', currentStatus: 'NOT_STARTED', to: 'FILED', ctx: ctx({ DOCUMENTS: 'VERIFIED' }) });
    expect(r.ok).toBe(true);
  });
  it('requires the BL document before verification', () => {
    const r = planTransition(wf, { ...base, stageKey: 'DOCUMENTS', currentStatus: 'RECEIVED', to: 'VERIFIED', ctx: ctx({}) });
    expect(!r.ok && r.error).toEqual({ code: 'MISSING_DOCUMENT', documentType: 'BILL_OF_LADING' });
  });
  it('requires the receiver name on delivery (no signature)', () => {
    const missing = planTransition(wf, { ...base, stageKey: 'DELIVERY', currentStatus: 'IN_TRANSIT', to: 'DELIVERED', ctx: ctx({}) });
    expect(!missing.ok && missing.error).toEqual({ code: 'MISSING_FIELDS', fields: ['receiverName'] });
    const r = planTransition(wf, { ...base, fields: { receiverName: 'Ali' }, stageKey: 'DELIVERY', currentStatus: 'IN_TRANSIT', to: 'DELIVERED', ctx: ctx({}) });
    expect(r.ok).toBe(true);
  });
});

describe('container stages', () => {
  it('skips physical inspection for containers not selected', () => {
    const def = stageDef(wf, 'PHYSICAL_INSPECTION')!;
    expect(initialContainerStatus(def, 'c1', ['c2'])).toBe('NOT_REQUIRED');
    expect(initialContainerStatus(def, 'c2', ['c2'])).toBe('PENDING');
  });
  it('blocks release until truck at port and inspection passed', () => {
    const steps = describeNextSteps(wf, 'RELEASE', 'PENDING', ctx({}, 'u1', { TRUCK: 'ASSIGNED', PHYSICAL_INSPECTION: 'HELD' }));
    expect(steps[0]!.gateOpen).toBe(false);
    expect(steps[0]!.waitingFor).toHaveLength(2);
  });
});

describe('job phase', () => {
  it('derives board columns', () => {
    expect(deriveJobPhase({ closed: false, jobStages: { DOCUMENTS: 'RECEIVED' }, containerDelivery: [] })).toBe('DOCUMENTS');
    expect(deriveJobPhase({ closed: false, jobStages: { DOCUMENTS: 'VERIFIED', DO: 'DO_RECEIVED', INSPECTION: 'CLEARED', CCRO: 'NOT_STARTED' }, containerDelivery: [] })).toBe('CCRO');
    expect(deriveJobPhase({ closed: false, jobStages: { DOCUMENTS: 'VERIFIED', CCRO: 'ISSUED' }, containerDelivery: ['DELIVERED', 'IN_TRANSIT'] })).toBe('DELIVERY');
    expect(deriveJobPhase({ closed: false, jobStages: { DOCUMENTS: 'VERIFIED', CCRO: 'ISSUED' }, containerDelivery: ['DELIVERED'] })).toBe('READY_TO_CLOSE');
  });
});
