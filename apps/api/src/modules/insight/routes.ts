import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { withTenant } from '../../shared/db';
import { protectedRouter } from '../../shared/http';
import { requirePermission } from '../../shared/policy';
import { jobBoard } from '../../shared/schema';

export function insightRoutes() {
  const r = protectedRouter();

  /** Kanban (OPS-001): one indexed query on the projection. */
  r.get('/board', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'job.read');
    const { customerId, coordinatorId, priority } = c.req.query();
    const items = await withTenant(actor, (tx) =>
      tx.select().from(jobBoard)
        .where(and(sql`${jobBoard.phase} <> 'CLOSED'`, customerId ? eq(jobBoard.customerId, customerId) : undefined, coordinatorId ? eq(jobBoard.coordinatorId, coordinatorId) : undefined, priority ? eq(jobBoard.priority, priority) : undefined))
        .orderBy(desc(jobBoard.overdue), asc(jobBoard.nextSlaDueAt)).limit(2000),
    );
    return c.json({ items });
  });

  /** Container board (OPS-002): every active container's current stage. */
  r.get('/containers', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'job.read');
    const rows = await withTenant(actor, (tx) =>
      tx.execute(sql`
        select ct.id, ct.container_no, ct.size_type, ct.free_time_expires_at, j.id job_id, j.job_no, j.bl_no, cu.name customer_name,
          coalesce((select si.stage_key from workflow.stage_instance si where si.container_id = ct.id and si.completed_at is null
                    order by array_position(array['TRUCK','PHYSICAL_INSPECTION','RELEASE','DELIVERY'], si.stage_key) limit 1),
                   case when exists (select 1 from workflow.stage_instance si where si.container_id = ct.id) then 'DONE' else 'AWAITING_CCRO' end) current_stage,
          (select jsonb_object_agg(si.stage_key, si.status) from workflow.stage_instance si where si.container_id = ct.id) stages,
          (select t.trip_no from fieldops.trip_container tc join fieldops.trip t on t.id = tc.trip_id where tc.container_id = ct.id and t.status <> 'CANCELLED' order by t.created_at desc limit 1) trip_no
        from clearance.container ct join clearance.job j on j.id = ct.job_id join customer.customer cu on cu.id = j.customer_id
        where ct.active order by ct.free_time_expires_at nulls last, ct.container_no limit 2000`),
    );
    return c.json({ items: rows.rows });
  });

  /** Dashboard KPIs for the manager. */
  r.get('/dashboard', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'report.read');
    const res = await withTenant(actor, async (tx) => {
      const [k] = (await tx.execute<Record<string, string | number>>(sql`
        select
          (select count(*) from insight.job_board where phase <> 'CLOSED')::int open_jobs,
          (select count(*) from insight.job_board where overdue)::int overdue_jobs,
          (select count(*) from clearance.container where active)::int active_containers,
          (select count(*) from clearance.container ct where ct.active and ct.free_time_expires_at <= current_date + 3
             and not exists (select 1 from workflow.stage_instance si where si.container_id = ct.id and si.stage_key = 'DELIVERY' and si.completed_at is not null))::int free_time_risk,
          (select count(*) from workflow.stage_instance where stage_key = 'DELIVERY' and completed_at >= current_date)::int delivered_today,
          (select count(*) from finance.disbursement where status = 'RECORDED')::int unreconciled_payments,
          (select coalesce(sum(amount), 0) from finance.disbursement where billable and invoice_id is null and status <> 'REVERSED')::text unbilled_amount,
          (select coalesce(sum(total), 0) from finance.invoice where status = 'ISSUED')::text receivables,
          (select round(avg(extract(epoch from (si.completed_at - j.created_at)) / 86400)::numeric, 1) from workflow.stage_instance si join clearance.job j on j.id = si.job_id
             where si.stage_key = 'DELIVERY' and si.completed_at > now() - interval '90 days')::text avg_days_to_delivery`)).rows;
      const phases = await tx.select({ phase: jobBoard.phase, n: sql<number>`count(*)::int` }).from(jobBoard).groupBy(jobBoard.phase);
      return { kpis: k, phases };
    });
    return c.json(res);
  });

  // ── Reports (BRD section 12) ──
  r.get('/reports/cycle-time', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'report.read');
    const days = Math.min(Number(c.req.query('days') ?? 90), 365);
    const rows = await withTenant(actor, (tx) =>
      tx.execute(sql`
        select si.stage_key, count(*)::int completed,
          round(avg(extract(epoch from (si.completed_at - si.started_at)) / 3600)::numeric, 1)::text avg_hours,
          round((percentile_cont(0.9) within group (order by extract(epoch from (si.completed_at - si.started_at)) / 3600))::numeric, 1)::text p90_hours,
          count(*) filter (where si.sla_due_at is not null and si.completed_at > si.sla_due_at)::int late
        from workflow.stage_instance si
        where si.completed_at is not null and si.started_at is not null and si.completed_at > now() - make_interval(days => ${days})
          and si.status not in ('NOT_REQUIRED')
        group by si.stage_key
        order by array_position(array['DOCUMENTS','BAYAN','CUSTOMER_COMM','INSPECTION','DO','CCRO','TRUCK','PHYSICAL_INSPECTION','RELEASE','DELIVERY'], si.stage_key)`),
    );
    return c.json({ items: rows.rows, days });
  });

  r.get('/reports/free-time', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'report.read');
    const rows = await withTenant(actor, (tx) =>
      tx.execute(sql`
        select ct.id, ct.container_no, ct.free_time_expires_at, (ct.free_time_expires_at - current_date) days_left, j.id job_id, j.job_no, j.bl_no, cu.name customer_name,
          coalesce((select si.stage_key from workflow.stage_instance si where si.container_id = ct.id and si.completed_at is null
             order by array_position(array['TRUCK','PHYSICAL_INSPECTION','RELEASE','DELIVERY'], si.stage_key) limit 1), 'AWAITING_CCRO') current_stage
        from clearance.container ct join clearance.job j on j.id = ct.job_id join customer.customer cu on cu.id = j.customer_id
        where ct.active and ct.free_time_expires_at is not null and ct.free_time_expires_at <= current_date + 7
          and not exists (select 1 from workflow.stage_instance si where si.container_id = ct.id and si.stage_key = 'RELEASE' and si.status = 'GATED_OUT')
        order by ct.free_time_expires_at`),
    );
    return c.json({ items: rows.rows });
  });

  r.get('/reports/disbursements', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'report.read');
    const rows = await withTenant(actor, (tx) =>
      tx.execute(sql`
        select cu.id customer_id, cu.name customer_name, d.currency,
          sum(d.amount)::text paid,
          sum(case when d.billable then d.amount else 0 end)::text billable,
          sum(case when d.invoice_id is not null then d.amount else 0 end)::text invoiced,
          sum(case when d.invoice_id is not null and i.status = 'PAID' then d.amount else 0 end)::text collected,
          count(*) filter (where d.status = 'RECORDED')::int unreconciled
        from finance.disbursement d join clearance.job j on j.id = d.job_id join customer.customer cu on cu.id = j.customer_id
        left join finance.invoice i on i.id = d.invoice_id
        where d.status <> 'REVERSED'
        group by 1, 2, 3 order by sum(d.amount) desc`),
    );
    return c.json({ items: rows.rows });
  });

  r.get('/reports/profitability', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'report.read');
    const rows = await withTenant(actor, (tx) =>
      tx.execute(sql`
        select j.id job_id, j.job_no, j.bl_no, cu.name customer_name,
          coalesce((select sum(il.amount) from finance.invoice_line il join finance.invoice i on i.id = il.invoice_id where i.job_id = j.id and i.status <> 'VOID' and il.kind = 'SERVICE'), 0)::text service_revenue,
          coalesce((select sum(il.amount) from finance.invoice_line il join finance.invoice i on i.id = il.invoice_id where i.job_id = j.id and i.status <> 'VOID' and il.kind = 'DISBURSEMENT'), 0)
            - coalesce((select sum(d.amount) from finance.disbursement d where d.job_id = j.id and d.invoice_id is not null and d.status <> 'REVERSED'), 0) markup_revenue,
          coalesce((select sum(d.amount) from finance.disbursement d where d.job_id = j.id and not d.billable and d.status <> 'REVERSED'), 0)::text absorbed_costs,
          coalesce((select sum(t.cost) from fieldops.trip t where t.job_id = j.id and t.status <> 'CANCELLED'), 0)::text trucking_cost
        from clearance.job j join customer.customer cu on cu.id = j.customer_id
        order by j.created_at desc limit 200`),
    );
    const items = rows.rows.map((r: any) => ({ ...r, margin: (Number(r.service_revenue) + Number(r.markup_revenue) - Number(r.absorbed_costs) - Number(r.trucking_cost)).toFixed(3), markup_revenue: Number(r.markup_revenue).toFixed(3) }));
    return c.json({ items });
  });

  r.get('/reports/team', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'report.read');
    const rows = await withTenant(actor, (tx) =>
      tx.execute(sql`
        select u.id, u.name, u.roles,
          count(si.*) filter (where si.completed_at > now() - interval '30 days')::int completed_30d,
          count(si.*) filter (where si.completed_at > now() - interval '30 days' and si.sla_due_at is not null and si.completed_at <= si.sla_due_at)::int on_time_30d,
          count(si.*) filter (where si.completed_at is null)::int open_now,
          count(si.*) filter (where si.completed_at is null and si.sla_due_at < now())::int overdue_now
        from platform.app_user u left join workflow.stage_instance si on si.assignee_id = u.id
        where u.active and not ('CUSTOMER' = any(u.roles))
        group by u.id order by completed_30d desc`),
    );
    return c.json({ items: rows.rows });
  });

  return r;
}
