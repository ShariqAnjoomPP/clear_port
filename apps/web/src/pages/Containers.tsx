import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { daysUntil, fmtDate, humanize } from '../lib/format';
import { Badge, Card, Input, PageHeader, Spinner, Table } from '../components/ui';

type Row = { id: string; container_no: string; size_type: string; free_time_expires_at: string | null; job_id: string; job_no: string; bl_no: string; customer_name: string; current_stage: string; stages: Record<string, string> | null; trip_no: string | null };

/** Container tracker: every active container, its current stage and free-time exposure. */
export function ContainersPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const rows = useQuery({ queryKey: ['containers'], queryFn: () => api.get<{ items: Row[] }>('/insight/containers').then((r) => r.items), refetchInterval: 30_000 });
  const list = useMemo(() => (rows.data ?? []).filter((r) => !q || `${r.container_no} ${r.bl_no} ${r.customer_name}`.toLowerCase().includes(q.toLowerCase())), [rows.data, q]);
  return (
    <>
      <PageHeader title={t('nav.containers')} subtitle="Sorted by free-time expiry — the top rows are where demurrage starts." actions={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" className="w-60" />} />
      <Card padded={false}>
        {rows.isLoading ? <Spinner /> : (
          <Table>
            <thead><tr><th>Container</th><th>BL / job</th><th>{t('common.customer')}</th><th>Current stage</th><th>Trip</th><th>Free time</th></tr></thead>
            <tbody>
              {list.map((r) => {
                const d = daysUntil(r.free_time_expires_at);
                const stageStatus = r.stages?.[r.current_stage];
                return (
                  <tr key={r.id}>
                    <td className="font-mono font-medium">{r.container_no} <span className="font-sans text-xs text-muted">{r.size_type}</span></td>
                    <td><Link to="/jobs/$jobId" params={{ jobId: r.job_id }} className="font-mono text-brand-2 hover:underline">{r.bl_no}</Link><p className="text-xs text-muted">{r.job_no}</p></td>
                    <td>{r.customer_name}</td>
                    <td>{r.current_stage === 'DONE' ? <Badge tone="ok">Delivered</Badge> : r.current_stage === 'AWAITING_CCRO' ? <Badge>Awaiting port release</Badge> : <Badge tone={stageStatus === 'HELD' ? 'warn' : 'info'}>{humanize(r.current_stage)}{stageStatus ? ` · ${humanize(stageStatus)}` : ''}</Badge>}</td>
                    <td className="text-muted">{r.trip_no ?? '—'}</td>
                    <td>{r.free_time_expires_at ? <Badge tone={d !== null && d <= 1 ? 'bad' : d !== null && d <= 3 ? 'warn' : 'neutral'}>{fmtDate(r.free_time_expires_at)}{d !== null && ` · ${d <= 0 ? 'today' : `${d}d`}`}</Badge> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
