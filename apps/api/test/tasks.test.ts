import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { FUNCTIONS } from '../src/functions';
import { pool } from '../src/lib/db';

/** The task list shows one task per open job: its current step, the next appearing only once that one is done. */
const app = new Hono();
for (const [name, fn] of Object.entries(FUNCTIONS)) app.route(`/api/${name}`, fn);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const get = async (path: string): Promise<Json> => (await app.request(`/api${path}`)).json();
const post = async (path: string, body: unknown) => app.request(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** The job page's rule: earliest unfinished step that can be worked on now (job steps, then containers), else earliest unfinished. */
function expectedCurrent(stages: Json, containers: Json[]): Json | undefined {
  const byNumber = [...containers].sort((a, b) => a.containerNo.localeCompare(b.containerNo));
  const ordered = [...(stages.jobStages as Json[]), ...byNumber.flatMap((c) => (stages.containerStages[c.id] ?? []) as Json[])].filter((s) => !s.done);
  return ordered.find((s) => s.nextSteps.some((n: Json) => n.gateOpen)) ?? ordered[0];
}
const unfinished = async (jobId: string) => {
  const s = await get(`/workflow/jobs/${jobId}/stages`);
  return [...(s.jobStages as Json[]), ...Object.values(s.containerStages as Record<string, Json[]>).flat()].some((x) => !x.done);
};

afterAll(() => pool.end());

describe('task list', () => {
  it('has exactly one task per open job that still has a step to do', async () => {
    const tasks = (await get('/workflow/tasks')).items as Json[];
    const open = (await get('/jobs?status=OPEN')).items as Json[];
    const jobIds = tasks.map((t) => t.jobId);
    expect(new Set(jobIds).size).toBe(jobIds.length); // no job twice
    const withWork = [];
    for (const j of open) if (await unfinished(j.jobId)) withWork.push(j.jobId);
    expect(jobIds.sort()).toEqual(withWork.sort()); // a job with every step done (ready to close) has no task
  });

  it('each task is the step the job page marks as current', async () => {
    for (const t of (await get('/workflow/tasks')).items as Json[]) {
      const current = expectedCurrent(await get(`/workflow/jobs/${t.jobId}/stages`), (await get(`/jobs/${t.jobId}`)).containers);
      expect(t.stageInstanceId, `${t.blNo}`).toBe(current?.id);
    }
  });

  it('moves to the next step only after the current one is done', async () => {
    const before = ((await get('/workflow/tasks')).items as Json[]).find((t) => t.blNo === 'MEDUJ4471023')!; // documents received
    expect(before.stageKey).toBe('DOCUMENTS');
    const form = new FormData(); // verifying documents needs the B/L on the job
    form.set('jobId', before.jobId); form.set('docType', 'BILL_OF_LADING'); form.set('file', new File(['%PDF-1.4\n'], 'bl.pdf', { type: 'application/pdf' }));
    await app.request('/api/documents', { method: 'POST', body: form });
    expect((await post(`/workflow/jobs/${before.jobId}/stages/${before.stageInstanceId}/transitions`, { to: 'VERIFIED' })).status).toBe(200);
    const after = ((await get('/workflow/tasks')).items as Json[]).filter((t) => t.jobId === before.jobId);
    expect(after).toHaveLength(1);
    expect(after[0]!.stageKey).not.toBe('DOCUMENTS');
  });
});
