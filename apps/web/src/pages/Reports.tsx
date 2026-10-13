import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { api } from '../lib/api';
import { fmtDate, fmtMoney, humanize } from '../lib/format';
import { Badge, Card, PageHeader, Spinner, Stat, Table } from '../components/ui';

type Cycle = { stage_key: string; completed: number; avg_hours: string | null; p90_hours: string | null; late: number };
type Free = { id: string; container_no: string; free_time_expires_at: string; days_left: number; job_id: string; job_no: string; bl_no: string; customer_name: string; current_stage: string };
type DisbRow = { customer_id: string; customer_name: string; currency: string; paid: string; billable: string; invoiced: string; collected: string; unreconciled: number };
type Profit = { job_id: string; job_no: string; bl_no: string; customer_name: string; service_revenue: string; markup_revenue: string; absorbed_costs: string; trucking_cost: string; margin: string };
type Team = { id: string; name: string; roles: string[]; completed_30d: number; on_time_30d: number; open_now: number; overdue_now: number };

/** Reports (BRD §12). Bars are plain CSS so the bundle stays small. */
export function ReportsPage() {
  const { t } = useTranslation();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<{ kpis: Record<string, string | number> }>('/v1/insight/dashboard') });
  const cycle = useQuery({ queryKey: ['r-cycle'], queryFn: () => api.get<{ items: Cycle[] }>('/v1/insight/reports/cycle-time').then((r) => r.items) });
  const free = useQuery({ queryKey: ['r-free'], queryFn: () => api.get<{ items: Free[] }>('/v1/insight/reports/free-time').then((r) => r.items) });
  const disb = useQuery({ queryKey: ['r-disb'], queryFn: () => api.get<{ items: DisbRow[] }>('/v1/insight/reports/disbursements').then((r) => r.items) });
  const profit = useQuery({ queryKey: ['r-profit'], queryFn: () => api.get<{ items: Profit[] }>('/v1/insight/reports/profitability').then((r) => r.items) });
  const team = useQuery({ queryKey: ['r-team'], queryFn: () => api.get<{ items: Team[] }>('/v1/insight/reports/team').then((r) => r.items) });
  const k = dash.data?.kpis;
  const maxAvg = Math.max(1, ...(cycle.data ?? []).map((c) => Number(c.p90_hours ?? c.avg_hours ?? 0)));

  return (
    <>
      <PageHeader title={t('nav.reports')} subtitle="Where time and money go, per stage, customer and person." />
      {k && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Avg. days document → delivery" value={k.avg_days_to_delivery ?? '—'} hint="North-star metric, last 90 days" />
          <Stat label="Containers at free-time risk" value={k.free_time_risk} tone={Number(k.free_time_risk) ? 'warn' : undefined} />
          <Stat label="Payments to reconcile" value={k.unreconciled_payments} />
          <Stat label="Receivables" value={fmtMoney(String(k.receivables ?? 0))} />
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Stage cycle time (last 90 days)">
          {cycle.isLoading ? <Spinner /> : (
            <div className="space-y-3">
              {(cycle.data ?? []).map((c) => (
                <div key={c.stage_key}>
                  <div className="flex justify-between text-sm"><span>{humanize(c.stage_key)}</span><span className="tabular text-muted">avg {c.avg_hours ?? '—'} h · p90 {c.p90_hours ?? '—'} h · {c.completed} done{c.late ? ` · ${c.late} late` : ''}</span></div>
                  <div className="relative mt-1 h-2 rounded-full bg-canvas">
                    <div className="absolute inset-y-0 start-0 rounded-full bg-brand/30" style={{ width: `${(Number(c.p90_hours ?? 0) / maxAvg) * 100}%` }} />
                    <div className="absolute inset-y-0 start-0 rounded-full bg-brand" style={{ width: `${(Number(c.avg_hours ?? 0) / maxAvg) * 100}%` }} />
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted">Dark bar = average, light bar = 90th percentile.</p>
            </div>
          )}
        </Card>
        <Card title="Free-time exposure (next 7 days)" padded={false}>
          <Table>
            <thead><tr><th>Container</th><th>BL</th><th>Stage</th><th>Ends</th></tr></thead>
            <tbody>
              {(free.data ?? []).map((f) => (
                <tr key={f.id}>
                  <td className="font-mono">{f.container_no}<p className="font-sans text-xs text-muted">{f.customer_name}</p></td>
                  <td><Link to="/jobs/$jobId" params={{ jobId: f.job_id }} className="font-mono text-brand-2 hover:underline">{f.bl_no}</Link></td>
                  <td>{humanize(f.current_stage)}</td>
                  <td><Badge tone={f.days_left <= 1 ? 'bad' : 'warn'}>{fmtDate(f.free_time_expires_at)} · {f.days_left <= 0 ? 'today' : `${f.days_left}d`}</Badge></td>
                </tr>
              ))}
              {!free.data?.length && <tr><td colSpan={4} className="py-6 text-center text-muted">No containers at risk.</td></tr>}
            </tbody>
          </Table>
        </Card>
        <Card title="Disbursements by customer" padded={false}>
          <Table>
            <thead><tr><th>Customer</th><th className="text-end">Paid</th><th className="text-end">Billable</th><th className="text-end">Invoiced</th><th className="text-end">Collected</th></tr></thead>
            <tbody>{(disb.data ?? []).map((d) => <tr key={d.customer_id + d.currency}><td className="font-medium">{d.customer_name}{d.unreconciled > 0 && <Badge tone="warn" className="ms-1">{d.unreconciled} to reconcile</Badge>}</td><td className="text-end tabular">{fmtMoney(d.paid, d.currency)}</td><td className="text-end tabular">{fmtMoney(d.billable, d.currency)}</td><td className="text-end tabular">{fmtMoney(d.invoiced, d.currency)}</td><td className="text-end tabular">{fmtMoney(d.collected, d.currency)}</td></tr>)}</tbody>
          </Table>
        </Card>
        <Card title="Team (last 30 days)" padded={false}>
          <Table>
            <thead><tr><th>Person</th><th className="text-end">Completed</th><th className="text-end">On time</th><th className="text-end">Open</th><th className="text-end">Overdue</th></tr></thead>
            <tbody>{(team.data ?? []).map((m) => <tr key={m.id}><td className="font-medium">{m.name}<p className="text-xs text-muted">{m.roles.join(', ').toLowerCase()}</p></td><td className="text-end tabular">{m.completed_30d}</td><td className="text-end tabular">{m.completed_30d ? `${Math.round((m.on_time_30d / m.completed_30d) * 100)}%` : '—'}</td><td className="text-end tabular">{m.open_now}</td><td className="text-end tabular text-bad">{m.overdue_now || ''}</td></tr>)}</tbody>
          </Table>
        </Card>
        <Card title="Job profitability" padded={false} className="xl:col-span-2">
          <Table>
            <thead><tr><th>Job</th><th>Customer</th><th className="text-end">Service fees</th><th className="text-end">Markup</th><th className="text-end">Absorbed costs</th><th className="text-end">Trucking</th><th className="text-end">Margin</th></tr></thead>
            <tbody>{(profit.data ?? []).map((p) => <tr key={p.job_id}><td><Link to="/jobs/$jobId" params={{ jobId: p.job_id }} className="font-mono text-brand-2 hover:underline">{p.bl_no}</Link><p className="text-xs text-muted">{p.job_no}</p></td><td>{p.customer_name}</td><td className="text-end tabular">{fmtMoney(p.service_revenue)}</td><td className="text-end tabular">{fmtMoney(p.markup_revenue)}</td><td className="text-end tabular">{fmtMoney(p.absorbed_costs)}</td><td className="text-end tabular">{fmtMoney(p.trucking_cost)}</td><td className={`text-end font-medium tabular ${Number(p.margin) < 0 ? 'text-bad' : 'text-ok'}`}>{fmtMoney(p.margin)}</td></tr>)}</tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
