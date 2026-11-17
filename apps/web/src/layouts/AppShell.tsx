import { Suspense, type ReactNode } from 'react';
import { Link, Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Bell, FileStack, Home, LayoutGrid, Plus, Search, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { IconButton, ProblemAlert, SnackbarProvider, Spinner } from '../components/ui';

export function Brand({ light = true }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <img src="/icon.svg" alt="" className="size-8 rounded-lg" />
      <span className={clsx('text-base font-semibold tracking-tight', light ? 'text-white' : 'text-on-surface')}>ClearPort</span>
    </div>
  );
}

type Dest = { to: string; label: string; icon: ReactNode; match: (path: string) => boolean };
const MORE_PATHS = ['/more', '/tasks', '/trips', '/finance', '/invoices', '/reports', '/notifications', '/settings', '/containers'];
const DESTINATIONS: Dest[] = [
  { to: '/', label: 'Home', icon: <Home className="size-6" />, match: (p) => p === '/' || p.startsWith('/search') },
  { to: '/jobs', label: 'Jobs', icon: <FileStack className="size-6" />, match: (p) => p.startsWith('/jobs') },
  { to: '/customers', label: 'Customers', icon: <Users className="size-6" />, match: (p) => p.startsWith('/customers') },
  { to: '/more', label: 'More', icon: <LayoutGrid className="size-6" />, match: (p) => MORE_PATHS.some((m) => p.startsWith(m)) },
];
/** Top-level screens: no back arrow. */
const ROOTS = new Set(['/', '/jobs', '/customers', '/more']);

/** Phone: bottom navigation bar with a pill behind the active icon (Material 3). */
function BottomNav({ path }: { path: string }) {
  return (
    <nav className="no-print pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-outline-variant/40 bg-surface-container lg:hidden" aria-label="Main">
      <div className="mx-auto grid max-w-lg grid-cols-4">
        {DESTINATIONS.map((d) => {
          const on = d.match(path);
          return (
            <Link key={d.to} to={d.to} className="flex h-20 flex-col items-center justify-center gap-1" aria-current={on ? 'page' : undefined}>
              <span className={clsx('flex h-8 w-16 items-center justify-center rounded-full transition', on ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant')}>{d.icon}</span>
              <span className={clsx('text-xs', on ? 'font-semibold text-on-surface' : 'font-medium text-on-surface-variant')}>{d.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Wide screens: navigation rail on the left, with the "create job" action on top. */
function NavRail({ path }: { path: string }) {
  const navigate = useNavigate();
  return (
    <nav className="no-print fixed inset-y-0 start-0 z-30 hidden w-24 flex-col items-center gap-3 bg-surface-container-low py-4 lg:flex" aria-label="Main">
      <img src="/icon.svg" alt="ClearPort" className="mb-2 size-10 rounded-xl" />
      <button onClick={() => void navigate({ to: '/jobs/new' })} className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary-container text-on-primary-container shadow-[var(--shadow-1)]" aria-label="Create job" title="Create job">
        <Plus className="size-6" />
      </button>
      {DESTINATIONS.map((d) => {
        const on = d.match(path);
        return (
          <Link key={d.to} to={d.to} className="flex flex-col items-center gap-1" aria-current={on ? 'page' : undefined}>
            <span className={clsx('flex h-8 w-14 items-center justify-center rounded-full transition', on ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant hover:bg-on-surface/8')}>{d.icon}</span>
            <span className={clsx('text-xs', on ? 'font-semibold text-on-surface' : 'font-medium text-on-surface-variant')}>{d.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell() {
  const session = useSession();
  const navigate = useNavigate();
  const router = useRouter();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const unread = useQuery({ queryKey: ['inbox'], queryFn: () => api.get<{ unread: number }>('/engagement/notifications'), refetchInterval: 30_000 });

  if (session.isLoading) return <Spinner />;
  if (!session.data) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ProblemAlert error={session.error ?? new Error('Could not reach the API')} />
        <p className="mt-3 text-sm text-on-surface-variant">Is the API running? Start everything with <code>npm run dev</code>.</p>
      </div>
    );
  }
  const isRoot = ROOTS.has(path);
  const count = unread.data?.unread ?? 0;

  return (
    <SnackbarProvider>
      <div className="min-h-full lg:ps-24">
        <NavRail path={path} />
        {/* Small top app bar: back on sub-screens, search and notifications everywhere */}
        <header className="no-print pt-safe sticky top-0 z-20 bg-surface/95 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-5xl items-center gap-1 px-1 sm:px-3">
            {isRoot ? (
              <div className="flex min-w-0 items-center gap-2 px-3">
                <img src="/icon.svg" alt="" className="size-8 rounded-lg lg:hidden" />
                <span className="truncate text-base font-semibold">{session.data.company.name}</span>
              </div>
            ) : (
              <IconButton label="Back" onClick={() => (window.history.length > 1 ? router.history.back() : void navigate({ to: '/' }))}>
                <ArrowLeft className="size-6 rtl:rotate-180" />
              </IconButton>
            )}
            <div className="ms-auto flex items-center">
              {path !== '/' && !path.startsWith('/search') && (
                <IconButton label="Search" onClick={() => void navigate({ to: '/search', search: { q: '' } })}><Search className="size-6" /></IconButton>
              )}
              <IconButton label="Notifications" onClick={() => void navigate({ to: '/notifications' })}>
                <Bell className="size-6" />
                {count > 0 && <span className="absolute end-2 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white">{count > 99 ? '99+' : count}</span>}
              </IconButton>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 pt-1 pb-[calc(env(safe-area-inset-bottom)+104px)] lg:px-8 lg:pb-12">
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
        <BottomNav path={path} />
      </div>
    </SnackbarProvider>
  );
}
