import { useEffect, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, FilePlus2, FileStack, MessageSquareWarning, PackageSearch, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useHome, type CustomerLite } from '../lib/hooks';
import { useSession } from '../lib/session';
import { JobListItem } from '../components/JobListItem';
import { Avatar, Badge, Empty, ListCard, ListItem, SearchBar, SectionTitle, Skeleton, Spinner } from '../components/ui';
import type { JobSummary } from '../components/types';

const SEARCH_HINT = 'Search B/L, customer, phone…';

/** Waits until typing pauses before searching. */
function useDebounced(value: string, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Jobs and customers matching one query: B/L, job no., customer name/phone/email, container no., Bayan/DO/CCRO no. */
export function SearchResults({ q }: { q: string }) {
  const navigate = useNavigate();
  const term = q.trim();
  const enabled = term.length >= 2;
  const jobs = useQuery({ queryKey: ['search-jobs', term], queryFn: () => api.get<{ items: JobSummary[] }>(`/jobs?q=${encodeURIComponent(term)}`).then((r) => r.items), enabled });
  const customers = useQuery({ queryKey: ['search-customers', term], queryFn: () => api.get<{ items: CustomerLite[] }>(`/customers?q=${encodeURIComponent(term)}`).then((r) => r.items), enabled });
  if (!enabled) return <p className="px-2 py-6 text-center text-sm text-on-surface-variant">Type at least 2 characters.</p>;
  if (jobs.isLoading || customers.isLoading) return <Spinner />;
  const nJobs = jobs.data?.length ?? 0;
  const nCustomers = customers.data?.length ?? 0;
  if (!nJobs && !nCustomers) return <Empty icon={<PackageSearch className="size-7" />} title={`Nothing found for “${term}”`}>Try a B/L or container number, a customer name or a phone number.</Empty>;
  return (
    <>
      {nCustomers > 0 && (
        <>
          <SectionTitle>Customers · {nCustomers}</SectionTitle>
          <ListCard>
            {customers.data!.slice(0, 8).map((c) => (
              <ListItem
                key={c.id}
                leading={<Avatar name={c.name} />}
                title={c.name}
                subtitle={[c.contacts[0]?.name, c.contacts[0]?.phone].filter(Boolean).join(' · ') || c.customsCode || '—'}
                trailing={c.openJobs ? <Badge tone="brand">{c.openJobs} open</Badge> : undefined}
                onClick={() => void navigate({ to: '/customers/$customerId', params: { customerId: c.id } })}
              />
            ))}
          </ListCard>
        </>
      )}
      {nJobs > 0 && (
        <>
          <SectionTitle>Jobs · {nJobs}</SectionTitle>
          <ListCard>{jobs.data!.slice(0, 20).map((j) => <JobListItem key={j.jobId} j={j} />)}</ListCard>
        </>
      )}
    </>
  );
}

/** Big tappable widget on Home. */
function Widget({ icon, title, value, sub, onClick, primary }: { icon: React.ReactNode; title: string; value?: React.ReactNode; sub?: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={
        primary
          ? 'col-span-2 flex items-center gap-4 rounded-[var(--radius-card)] bg-primary p-5 text-start text-on-primary shadow-[var(--shadow-1)] transition active:scale-[0.99]'
          : 'flex flex-col gap-3 rounded-[var(--radius-card)] bg-secondary-container p-4 text-start text-on-secondary-container transition active:scale-[0.98]'
      }
    >
      <span className={primary ? 'rounded-2xl bg-white/15 p-3' : 'w-fit rounded-xl bg-white/60 p-2.5'}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={primary ? 'block text-lg font-semibold' : 'block text-sm font-medium'}>{title}</span>
        {value !== undefined && <span className="block text-3xl font-semibold tabular">{value}</span>}
        {sub && <span className={primary ? 'block text-sm text-white/80' : 'mt-0.5 block text-xs'}>{sub}</span>}
      </span>
    </button>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const session = useSession();
  const home = useHome();
  const [q, setQ] = useState('');
  const live = useDebounced(q);
  const h = home.data;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <div className="mt-2 mb-4">
        <p className="text-sm text-on-surface-variant">{greeting}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{session.data?.user.name ?? 'Welcome'}</h1>
      </div>
      <SearchBar value={q} onChange={setQ} onSubmit={() => void navigate({ to: '/search', search: { q } })} placeholder={SEARCH_HINT} />

      {live.trim().length >= 2 ? (
        <div className="mt-2"><SearchResults q={live} /></div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Widget primary icon={<FilePlus2 className="size-7" />} title="Create job" sub="New B/L — pick or add the customer" onClick={() => void navigate({ to: '/jobs/new', search: {} })} />
            <Widget
              icon={<FileStack className="size-6" />}
              title="Jobs"
              value={h ? h.openJobs : <Skeleton className="h-9 w-12" />}
              sub={h ? (h.overdueJobs ? <span className="font-medium text-error">{h.overdueJobs} overdue</span> : 'open') : undefined}
              onClick={() => void navigate({ to: '/jobs', search: {} })}
            />
            <Widget icon={<Users className="size-6" />} title="Customers" value={h ? h.customers : <Skeleton className="h-9 w-12" />} sub="total" onClick={() => void navigate({ to: '/customers', search: {} })} />
          </div>

          {h && (h.overdueStages > 0 || h.freeTimeRisk > 0 || h.pendingApprovals > 0) && (
            <>
              <SectionTitle>Needs attention</SectionTitle>
              <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
                {h.overdueStages > 0 && <AttentionChip icon={<Clock className="size-4" />} tone="bad" label={`${h.overdueStages} overdue step${h.overdueStages === 1 ? '' : 's'}`} onClick={() => void navigate({ to: '/jobs', search: { filter: 'OVERDUE' } })} />}
                {h.freeTimeRisk > 0 && <AttentionChip icon={<AlertTriangle className="size-4" />} tone="warn" label={`${h.freeTimeRisk} free time ending`} onClick={() => void navigate({ to: '/containers' })} />}
                {h.pendingApprovals > 0 && <AttentionChip icon={<MessageSquareWarning className="size-4" />} tone="info" label={`${h.pendingApprovals} awaiting customer`} onClick={() => void navigate({ to: '/notifications' })} />}
              </div>
            </>
          )}

          <SectionTitle>Recent jobs</SectionTitle>
          {home.isLoading ? <Skeleton className="h-40" /> : !h?.recent.length ? (
            <ListCard>
              <Empty icon={<FilePlus2 className="size-7" />} title="No jobs yet">Create your first job. You can add the customer in the same step.</Empty>
            </ListCard>
          ) : (
            <ListCard>{h.recent.map((j) => <JobListItem key={j.jobId} j={j} />)}</ListCard>
          )}
        </>
      )}
    </>
  );
}

function AttentionChip({ icon, label, tone, onClick }: { icon: React.ReactNode; label: string; tone: 'bad' | 'warn' | 'info'; onClick: () => void }) {
  const cls = tone === 'bad' ? 'bg-error-container text-error' : tone === 'warn' ? 'bg-warning-container text-warning' : 'bg-info-container text-info-role';
  return (
    <button onClick={onClick} className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium ${cls}`}>
      {icon}
      {label}
    </button>
  );
}

/** Full-screen search, reached from the app bar or by submitting the Home search. */
export function SearchPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { q?: string };
  const [q, setQ] = useState(search.q ?? '');
  const live = useDebounced(q);
  return (
    <>
      <SearchBar value={q} onChange={setQ} autoFocus onSubmit={() => void navigate({ to: '/search', search: { q }, replace: true })} placeholder={SEARCH_HINT} />
      <div className="mt-2"><SearchResults q={live} /></div>
    </>
  );
}
