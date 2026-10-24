import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { AlertTriangle, Bell, Clock, ExternalLink, Mail, MessageCircle, Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import { fmtDate, fmtDateTime, humanize, relative } from '../lib/format';
import { Badge, Button, Card, Empty, PageHeader, Spinner, Table, Tabs } from '../components/ui';

type N = { id: string; channel: string; recipient: string; title: string; body: string; link: string | null; jobId: string | null; status: string; createdAt: string; template: string };
type Alerts = {
  overdue: { jobId: string; jobNo: string; blNo: string; stageKey: string; containerNo: string | null; slaDueAt: string }[];
  freeTime: { jobId: string; jobNo: string; blNo: string; containerNo: string; freeTimeExpiresAt: string }[];
};

export const useInbox = () => useQuery({ queryKey: ['inbox'], queryFn: () => api.get<{ items: N[]; unread: number }>('/engagement/notifications'), refetchInterval: 30_000 });

export function NotificationsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'inbox' | 'outbound' | 'alerts'>('inbox');
  const inbox = useInbox();
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api.get<Alerts>('/engagement/alerts') });
  return (
    <>
      <PageHeader title={t('nav.notifications')} subtitle="Staff alerts, messages sent to customers and drivers, and work that needs attention now." />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'inbox', label: 'Inbox', count: inbox.data?.unread },
          { value: 'outbound', label: 'Messages sent' },
          { value: 'alerts', label: 'Needs attention', count: alerts.data ? alerts.data.overdue.length + alerts.data.freeTime.length : undefined },
        ]}
      />
      <div className="mt-4">
        {tab === 'inbox' && <Inbox />}
        {tab === 'outbound' && <Outbound />}
        {tab === 'alerts' && <AlertsTab alerts={alerts.data} loading={alerts.isLoading} />}
      </div>
    </>
  );
}

function Inbox() {
  const qc = useQueryClient();
  const list = useInbox();
  const readAll = useMutation({ mutationFn: () => api.post('/engagement/notifications/read-all'), onSuccess: () => void qc.invalidateQueries({ queryKey: ['inbox'] }) });
  return (
    <Card padded={false} actions={<Button size="sm" onClick={() => readAll.mutate()} disabled={!list.data?.unread}>Mark all read</Button>} title="Inbox">
      {list.isLoading ? <Spinner /> : !list.data?.items.length ? <Empty icon={<Bell className="size-8" />} title="You're all caught up" /> : (
        <ul>
          {list.data.items.map((n) => (
            <li key={n.id} className={clsx('flex gap-3 border-b border-line px-4 py-3 last:border-0', n.status === 'UNREAD' && 'bg-brand-soft/40')}>
              <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', n.status === 'UNREAD' ? 'bg-brand' : 'bg-line')} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-sm text-muted">{n.body}</p>
                <p className="mt-0.5 text-xs text-muted">{relative(n.createdAt)}{n.jobId && <> · <Link to="/jobs/$jobId" params={{ jobId: n.jobId }} className="text-brand-2 hover:underline">Open job</Link></>}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const CHANNEL_ICON: Record<string, React.ReactNode> = { WHATSAPP: <MessageCircle className="size-4" />, EMAIL: <Mail className="size-4" />, SMS: <Smartphone className="size-4" /> };

/** The prototype never sends WhatsApp, email or SMS: every message is logged here exactly as it would go out. */
export function OutboundList({ jobId }: { jobId?: string }) {
  const list = useQuery({ queryKey: ['outbound', jobId ?? 'all'], queryFn: () => api.get<{ items: N[] }>(`/engagement/outbound${jobId ? `?jobId=${jobId}` : ''}`).then((r) => r.items) });
  if (list.isLoading) return <Spinner />;
  if (!list.data?.length) return <p className="p-4 text-sm text-muted">No messages yet.</p>;
  return (
    <ul>
      {list.data.map((n) => (
        <li key={n.id} className="border-b border-line px-4 py-3 last:border-0">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">{CHANNEL_ICON[n.channel]}{n.title}</p>
            <Badge tone="neutral">{humanize(n.channel)} · logged</Badge>
          </div>
          <p className="mt-0.5 text-sm whitespace-pre-line text-muted">{n.body.replace(n.link ?? '\u0000', '').trim()}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            To {n.recipient} · {fmtDateTime(n.createdAt)}
            {n.link && <a href={n.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-2 hover:underline"><ExternalLink className="size-3.5" /> Open link</a>}
            {!jobId && n.jobId && <Link to="/jobs/$jobId" params={{ jobId: n.jobId }} className="text-brand-2 hover:underline">Open job</Link>}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Outbound() {
  return (
    <Card padded={false} title="Messages sent">
      <p className="border-b border-line px-4 py-2 text-xs text-muted">In this prototype WhatsApp, email and SMS are not really sent. Each message is recorded here as it would go out, with its link.</p>
      <OutboundList />
    </Card>
  );
}

function AlertsTab({ alerts, loading }: { alerts?: Alerts; loading: boolean }) {
  if (loading || !alerts) return <Spinner />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card padded={false} title={<span className="flex items-center gap-2"><Clock className="size-4 text-bad" /> Overdue stages</span>}>
        <Table>
          <thead><tr><th>BL</th><th>Stage</th><th>Was due</th></tr></thead>
          <tbody>
            {alerts.overdue.map((o, i) => (
              <tr key={i}>
                <td><Link to="/jobs/$jobId" params={{ jobId: o.jobId }} className="font-mono text-brand-2 hover:underline">{o.blNo}</Link></td>
                <td>{humanize(o.stageKey)}{o.containerNo && <span className="ms-1 font-mono text-xs text-muted">{o.containerNo}</span>}</td>
                <td className="text-bad">{relative(o.slaDueAt)}</td>
              </tr>
            ))}
            {!alerts.overdue.length && <tr><td colSpan={3} className="py-6 text-center text-muted">Nothing overdue.</td></tr>}
          </tbody>
        </Table>
      </Card>
      <Card padded={false} title={<span className="flex items-center gap-2"><AlertTriangle className="size-4 text-warn" /> Port free time ending</span>}>
        <Table>
          <thead><tr><th>Container</th><th>BL</th><th>Free time ends</th></tr></thead>
          <tbody>
            {alerts.freeTime.map((f) => (
              <tr key={f.containerNo}>
                <td className="font-mono">{f.containerNo}</td>
                <td><Link to="/jobs/$jobId" params={{ jobId: f.jobId }} className="font-mono text-brand-2 hover:underline">{f.blNo}</Link></td>
                <td className="text-warn">{fmtDate(f.freeTimeExpiresAt)}</td>
              </tr>
            ))}
            {!alerts.freeTime.length && <tr><td colSpan={3} className="py-6 text-center text-muted">No containers at risk.</td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
