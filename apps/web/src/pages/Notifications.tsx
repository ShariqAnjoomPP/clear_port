import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Bell } from 'lucide-react';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import { Button, Card, Empty, PageHeader, Spinner } from '../components/ui';

type N = { id: string; title: string; body: string; jobId: string | null; readAt: string | null; createdAt: string; template: string };

export function NotificationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['notifications-list'], queryFn: () => api.get<{ items: N[] }>('/v1/notifications').then((r) => r.items) });
  const readAll = useMutation({ mutationFn: () => api.post('/v1/notifications/read-all'), onSuccess: () => void qc.invalidateQueries() });
  return (
    <>
      <PageHeader title={t('nav.notifications')} actions={<Button onClick={() => readAll.mutate()}>Mark all read</Button>} />
      <Card padded={false}>
        {list.isLoading ? <Spinner /> : !list.data?.length ? <Empty icon={<Bell className="size-8" />} title="You're all caught up" /> : (
          <ul>
            {list.data.map((n) => (
              <li key={n.id} className={clsx('flex gap-3 border-b border-line px-4 py-3 last:border-0', !n.readAt && 'bg-brand-soft/40')}>
                <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-line' : 'bg-brand')} />
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
    </>
  );
}
