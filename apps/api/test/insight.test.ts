import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { FUNCTIONS } from '../src/functions';
import { pool } from '../src/lib/db';

/** Milestone 6: board, container tracker, dashboard and reports, cross-checked against the other functions. */
const app = new Hono();
for (const [name, fn] of Object.entries(FUNCTIONS)) app.route(`/api/${name}`, fn);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const get = async (path: string): Promise<Json> => (await app.request(`/api${path}`)).json();
const m = (v: string | number) => Math.round(Number(v) * 1000);

afterAll(() => pool.end());

describe('board and containers', () => {
  it('shows every open job once, overdue first, in the same phase as the jobs list', async () => {
    const board = (await get('/insight/board')).items as Json[];
    const open = (await get('/jobs?status=OPEN')).items as Json[];
    expect(board.map((j) => j.jobId).sort()).toEqual(open.map((j) => j.jobId).sort());
    expect(board.every((j) => j.phase !== 'CLOSED')).toBe(true);
    const firstOnTime = board.findIndex((j) => !j.overdue);
    expect(board.slice(firstOnTime).every((j) => !j.overdue)).toBe(true);
    for (const j of board) expect(j.phase).toBe(open.find((o) => o.jobId === j.jobId)!.phase);
  });

  it('filters the board by coordinator and priority', async () => {
    const sara = ((await get('/settings/staff?role=COORDINATOR')).items as Json[]).find((s) => s.name === 'Sara Khan')!;
    const mine = (await get(`/insight/board?coordinatorId=${sara.id}`)).items as Json[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((j) => j.coordinatorName === 'Sara Khan')).toBe(true);
    expect(((await get('/insight/board?priority=HIGH')).items as Json[]).every((j) => j.priority === 'HIGH')).toBe(true);
  });

  it('tracks each active container’s current stage, earliest free time first', async () => {
    const rows = (await get('/insight/containers')).items as Json[];
    const dates = rows.map((r) => r.free_time_expires_at).filter(Boolean);
    expect(dates).toEqual([...dates].sort());
    const held = rows.find((r) => r.stages?.PHYSICAL_INSPECTION === 'HELD')!;
    expect(held.current_stage).toBe('PHYSICAL_INSPECTION');
    expect(rows.some((r) => r.current_stage === 'AWAITING_CCRO')).toBe(true);
  });
});

describe('dashboard and reports', () => {
  it('dashboard counts agree with the other functions', async () => {
    const { kpis, phases } = await get('/insight/dashboard');
    const open = (await get('/jobs?status=OPEN')).items as Json[];
    expect(kpis.open_jobs).toBe(open.length);
    expect(kpis.overdue_jobs).toBe(open.filter((j) => j.overdue).length);
    expect(Object.values(phases as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(open.length);
    const recorded = (await get('/finance/disbursements?status=RECORDED')).items as Json[];
    expect(kpis.unreconciled_payments).toBe(recorded.length);
    const owed = (await get('/finance/receivables')).items as Json[];
    expect(m(kpis.receivables)).toBe(owed.reduce((s, r) => s + m(r.total), 0));
  });

  it('profitability: service fees + markup − absorbed costs − trucking', async () => {
    const rows = (await get('/insight/reports/profitability')).items as Json[];
    for (const r of rows) expect(m(r.margin)).toBe(m(r.service_revenue) + m(r.markup_revenue) - m(r.absorbed_costs) - m(r.trucking_cost));
    const closed = rows.find((r) => r.bl_no === 'COSU6120001')!; // invoiced, paid and closed in the seed
    expect(m(closed.service_revenue)).toBeGreaterThan(0);
    expect(m(closed.trucking_cost)).toBe(m(65)); // OMR 65 per trip in the seed
  });

  it('cycle time, disbursements and team reports return sensible rows', async () => {
    const cycle = (await get('/insight/reports/cycle-time?days=90')).items as Json[];
    expect(cycle[0]!.stage_key).toBe('DOCUMENTS');
    expect(cycle.every((c) => c.completed > 0 && Number(c.p90_hours) >= 0)).toBe(true);

    const disb = (await get('/insight/reports/disbursements')).items as Json[];
    for (const d of disb) expect(m(d.collected)).toBeLessThanOrEqual(m(d.invoiced));

    const team = (await get('/insight/reports/team')).items as Json[];
    const yusuf = team.find((t) => t.name === 'Yusuf Ali')!;
    expect(yusuf.completed_30d).toBeGreaterThan(0);
    expect(yusuf.on_time_30d).toBeLessThanOrEqual(yusuf.completed_30d);
    // Completed stages keep their due time, so on-time work is measurable (it used to read 0% for everyone).
    expect(team.reduce((n, t) => n + t.on_time_30d, 0)).toBeGreaterThan(0);
    expect((await get('/insight/reports/cycle-time')).items.some((c: Json) => c.late < c.completed)).toBe(true);

    const free = (await get('/insight/reports/free-time')).items as Json[];
    expect(free.every((f) => f.days_left <= 7)).toBe(true);
  });
});
