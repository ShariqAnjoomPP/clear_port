import { sql } from 'drizzle-orm';
import type { Q } from '../../lib/db';
import { alerts, pendingApprovals } from '../engagement/service';
import { jobSummaries } from '../jobs/service';

/** Stage order for "current stage" and report rows. */
const CONTAINER_ORDER = sql`array['TRUCK','PHYSICAL_INSPECTION','RELEASE','DELIVERY']`;
const STAGE_ORDER = sql`array['DOCUMENTS','BAYAN','CUSTOMER_COMM','INSPECTION','DO','CCRO','TRUCK','PHYSICAL_INSPECTION','RELEASE','DELIVERY']`;

/** Kanban: every open job by phase, overdue first, then the next SLA due. */
export async function board(q: Q, filter: { coordinatorId?: string; priority?: string; customerId?: string } = {}) {
  const items = (await jobSummaries(q, { status: 'OPEN', customerId: filter.customerId, limit: 2000 }))
    .filter((j) => (!filter.coordinatorId || j.coordinatorId === filter.coordinatorId) && (!filter.priority || j.priority === filter.priority));
  return items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.nextSlaDueAt?.getTime() ?? Infinity) - (b.nextSlaDueAt?.getTime() ?? Infinity));
}

/** Every active container with its current stage, trip and free-time exposure, earliest expiry first. */
export async function containers(q: Q) {
  const r = await q.execute(sql`
    select ct.id, ct.container_no, ct.size_type, ct.free_time_expires_at, j.id job_id, j.job_no, j.bl_no, cu.name customer_name,
      coalesce((select si.stage_key from stage_instance si where si.container_id = ct.id and si.completed_at is null
                order by array_position(${CONTAINER_ORDER}, si.stage_key) limit 1),
               case when exists (select 1 from stage_instance si where si.container_id = ct.id) then 'DONE' else 'AWAITING_CCRO' end) current_stage,
      (select jsonb_object_agg(si.stage_key, si.status) from stage_instance si where si.container_id = ct.id) stages,
      (select t.trip_no from trip_container tc join trip t on t.id = tc.trip_id where tc.container_id = ct.id and t.status <> 'CANCELLED' order by t.created_at desc limit 1) trip_no
    from container ct join job j on j.id = ct.job_id join customer cu on cu.id = j.customer_id
    where ct.active order by ct.free_time_expires_at nulls last, ct.container_no limit 2000`);
  return r.rows;
}

/** Manager's headline numbers. */
export async function dashboard(q: Q) {
  const [kpis] = (await q.execute<Record<string, string | number | null>>(sql`
    select
      (select count(*) from job where status = 'OPEN')::int open_jobs,
      (select count(distinct si.job_id) from stage_instance si join job j on j.id = si.job_id
         where j.status = 'OPEN' and si.completed_at is null and si.sla_due_at < now())::int overdue_jobs,
      (select count(*) from container where active)::int active_containers,
      (select count(*) from container ct join job j on j.id = ct.job_id where j.status = 'OPEN' and ct.active and ct.free_time_expires_at <= current_date + 3
         and not exists (select 1 from stage_instance si where si.container_id = ct.id and si.stage_key = 'DELIVERY' and si.completed_at is not null))::int free_time_risk,
      (select count(*) from stage_instance where stage_key = 'DELIVERY' and completed_at >= current_date)::int delivered_today,
      (select count(*) from disbursement where status = 'RECORDED')::int unreconciled_payments,
      (select coalesce(sum(amount), 0) from disbursement where billable and invoice_id is null and status <> 'REVERSED')::text unbilled_amount,
      (select coalesce(sum(total), 0) from invoice where status = 'ISSUED')::text receivables,
      (select round(avg(extract(epoch from (si.completed_at - j.created_at)) / 86400)::numeric, 1) from stage_instance si join job j on j.id = si.job_id
         where si.stage_key = 'DELIVERY' and si.completed_at > now() - interval '90 days')::text avg_days_to_delivery`)).rows;
  const phases: Record<string, number> = {};
  for (const j of await jobSummaries(q, { status: 'OPEN', limit: 2000 })) phases[j.phase] = (phases[j.phase] ?? 0) + 1;
  return { kpis: kpis!, phases };
}

/** How long each stage takes once it can be worked on (average and 90th percentile), and how often it runs late. */
export async function cycleTime(q: Q, days: number) {
  const r = await q.execute(sql`
    select si.stage_key, count(*)::int completed,
      round(avg(extract(epoch from (si.completed_at - si.started_at)) / 3600)::numeric, 1)::text avg_hours,
      round((percentile_cont(0.9) within group (order by extract(epoch from (si.completed_at - si.started_at)) / 3600))::numeric, 1)::text p90_hours,
      count(*) filter (where si.sla_due_at is not null and si.completed_at > si.sla_due_at)::int late
    from stage_instance si
    where si.completed_at is not null and si.started_at is not null and si.completed_at > now() - make_interval(days => ${days})
      and si.status <> 'NOT_REQUIRED'
    group by si.stage_key
    order by array_position(${STAGE_ORDER}, si.stage_key)`);
  return r.rows;
}

/** Containers whose port free time ends within a week and that have not left the port yet. */
export async function freeTimeExposure(q: Q) {
  const r = await q.execute(sql`
    select ct.id, ct.container_no, ct.free_time_expires_at, (ct.free_time_expires_at - current_date) days_left, j.id job_id, j.job_no, j.bl_no, cu.name customer_name,
      coalesce((select si.stage_key from stage_instance si where si.container_id = ct.id and si.completed_at is null
         order by array_position(${CONTAINER_ORDER}, si.stage_key) limit 1), 'AWAITING_CCRO') current_stage
    from container ct join job j on j.id = ct.job_id join customer cu on cu.id = j.customer_id
    where ct.active and j.status = 'OPEN' and ct.free_time_expires_at is not null and ct.free_time_expires_at <= current_date + 7
      and not exists (select 1 from stage_instance si where si.container_id = ct.id and si.stage_key = 'RELEASE' and si.status = 'GATED_OUT')
    order by ct.free_time_expires_at`);
  return r.rows;
}

/** Money paid on customers' behalf: billed, invoiced and collected, per customer. */
export async function disbursementsByCustomer(q: Q) {
  const r = await q.execute(sql`
    select cu.id customer_id, cu.name customer_name, d.currency,
      sum(d.amount)::text paid,
      sum(case when d.billable then d.amount else 0 end)::text billable,
      sum(case when d.invoice_id is not null then d.amount else 0 end)::text invoiced,
      sum(case when d.invoice_id is not null and i.status = 'PAID' then d.amount else 0 end)::text collected,
      count(*) filter (where d.status = 'RECORDED')::int unreconciled
    from disbursement d join job j on j.id = d.job_id join customer cu on cu.id = j.customer_id
    left join invoice i on i.id = d.invoice_id
    where d.status <> 'REVERSED'
    group by 1, 2, 3 order by sum(d.amount) desc`);
  return r.rows;
}

/** Per job: service fees and markup earned, minus costs the agency absorbed and trucking. */
export async function profitability(q: Q) {
  const r = await q.execute<{ service_revenue: string; markup_revenue: string; absorbed_costs: string; trucking_cost: string }>(sql`
    select j.id job_id, j.job_no, j.bl_no, cu.name customer_name,
      coalesce((select sum(il.amount) from invoice_line il join invoice i on i.id = il.invoice_id where i.job_id = j.id and i.status <> 'VOID' and il.kind = 'SERVICE'), 0)::text service_revenue,
      (coalesce((select sum(il.amount) from invoice_line il join invoice i on i.id = il.invoice_id where i.job_id = j.id and i.status <> 'VOID' and il.kind = 'DISBURSEMENT'), 0)
        - coalesce((select sum(d.amount) from disbursement d join invoice i on i.id = d.invoice_id where d.job_id = j.id and i.status <> 'VOID' and d.status <> 'REVERSED'), 0))::text markup_revenue,
      coalesce((select sum(d.amount) from disbursement d where d.job_id = j.id and not d.billable and d.status <> 'REVERSED'), 0)::text absorbed_costs,
      coalesce((select sum(t.cost) from trip t where t.job_id = j.id and t.status <> 'CANCELLED'), 0)::text trucking_cost
    from job j join customer cu on cu.id = j.customer_id
    order by j.created_at desc limit 200`);
  return r.rows.map((x) => ({
    ...x,
    margin: ((Math.round(Number(x.service_revenue) * 1000) + Math.round(Number(x.markup_revenue) * 1000) - Math.round(Number(x.absorbed_costs) * 1000) - Math.round(Number(x.trucking_cost) * 1000)) / 1000).toFixed(3),
  }));
}

/** Workload and timeliness per staff member, from the stages assigned to them. */
export async function team(q: Q) {
  const r = await q.execute(sql`
    select s.id, s.name, s.role,
      count(si.*) filter (where si.completed_at > now() - interval '30 days')::int completed_30d,
      count(si.*) filter (where si.completed_at > now() - interval '30 days' and si.sla_due_at is not null and si.completed_at <= si.sla_due_at)::int on_time_30d,
      count(si.*) filter (where si.completed_at is null)::int open_now,
      count(si.*) filter (where si.completed_at is null and si.sla_due_at < now())::int overdue_now
    from staff s left join stage_instance si on si.assignee_staff_id = s.id
    where s.active
    group by s.id order by completed_30d desc, s.name`);
  return r.rows;
}

/** Everything the Home screen shows, in one call: widget counts, what needs attention, and recent jobs. */
export async function home(q: Q) {
  const [open, attention, approvals, [counts]] = await Promise.all([
    jobSummaries(q, { status: 'OPEN', limit: 2000 }),
    alerts(q),
    pendingApprovals(q),
    q.execute<{ customers: number; unread: number }>(sql`
      select (select count(*) from customer where archived_at is null)::int customers,
             (select count(*) from notification where channel = 'IN_APP' and status = 'UNREAD')::int unread`).then((r) => r.rows),
  ]);
  const recent = await jobSummaries(q, { limit: 5 });
  return {
    openJobs: open.length,
    overdueJobs: open.filter((j) => j.overdue).length,
    customers: counts?.customers ?? 0,
    overdueStages: attention.overdue.length,
    freeTimeRisk: attention.freeTime.length,
    pendingApprovals: approvals.length,
    unreadNotifications: counts?.unread ?? 0,
    recent,
  };
}
