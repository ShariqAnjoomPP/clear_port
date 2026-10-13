import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Bell, BarChart3, Boxes, ClipboardList, CloudOff, FileStack, Kanban, Languages, LogOut, Menu, RefreshCw, Search, Settings, Smartphone, Truck, Users, Wallet, X } from 'lucide-react';
import type { Permission } from '@clearport/kernel';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOnline, useOutbox } from '../lib/hooks';
import i18n, { setLanguage } from '../lib/i18n';
import { syncOutbox } from '../lib/offline';
import { Spinner } from '../components/ui';

type NavItem = { to: string; label: string; icon: ReactNode; perm?: Permission; fieldOnly?: boolean; officeOnly?: boolean };

export function Brand({ light = true }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <img src="/icon.svg" alt="" className="size-8 rounded-lg" />
      <span className={clsx('text-base font-semibold tracking-tight', light ? 'text-white' : 'text-ink')}>ClearPort</span>
    </div>
  );
}

export function SyncPill() {
  const { t } = useTranslation();
  const online = useOnline();
  const queued = useOutbox();
  const pending = queued.filter((q) => q.status === 'pending').length;
  const failed = queued.filter((q) => q.status === 'failed').length;
  if (online && !pending && !failed) return null;
  return (
    <button onClick={() => void syncOutbox()} className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', !online ? 'bg-warn-soft text-warn' : failed ? 'bg-bad-soft text-bad' : 'bg-info-soft text-info')}>
      {!online ? <CloudOff className="size-3.5" /> : <RefreshCw className="size-3.5" />}
      {!online ? t('common.offline') : failed ? `${failed} update(s) need attention` : t('common.pending', { count: pending })}
    </button>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const { user, ready, can, has, logout } = useAuth();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => setOpen(false), [path]);

  const unread = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ unread: number }>('/v1/notifications'),
    refetchInterval: 30_000,
    enabled: !!user && !has('CUSTOMER'),
  });

  if (!ready) return <Spinner />;
  if (!user) return <Navigate to="/login" />;
  if (has('CUSTOMER')) return <Navigate to="/portal" />;

  const field = user.roles.some((r) => ['PRO', 'INSPECTOR', 'DRIVER'].includes(r));
  const office = user.roles.some((r) => ['OWNER', 'COORDINATOR', 'ACCOUNTS', 'ADMIN'].includes(r));
  const nav: NavItem[] = [
    { to: '/board', label: t('nav.board'), icon: <Kanban className="size-4" />, perm: 'job.read', officeOnly: true },
    { to: '/field', label: t('nav.tasks'), icon: <Smartphone className="size-4" />, fieldOnly: true },
    { to: '/tasks', label: t('nav.tasks'), icon: <ClipboardList className="size-4" />, officeOnly: true },
    { to: '/jobs', label: t('nav.jobs'), icon: <FileStack className="size-4" />, perm: 'job.read' },
    { to: '/containers', label: t('nav.containers'), icon: <Boxes className="size-4" />, perm: 'job.read', officeOnly: true },
    { to: '/customers', label: t('nav.customers'), icon: <Users className="size-4" />, perm: 'customer.read' },
    { to: '/trips', label: t('nav.trips'), icon: <Truck className="size-4" />, perm: 'field.manage' },
    { to: '/finance', label: t('nav.finance'), icon: <Wallet className="size-4" />, perm: 'invoice.read' },
    { to: '/reports', label: t('nav.reports'), icon: <BarChart3 className="size-4" />, perm: 'report.read' },
    { to: '/settings', label: t('nav.settings'), icon: <Settings className="size-4" />, perm: 'admin.config' },
  ].filter((n) => (!n.perm || can(n.perm as Permission)) && (!n.fieldOnly || (field && !office)) && (!n.officeOnly || office)) as NavItem[];

  const sidebar = (
    <nav className="flex h-full flex-col bg-navy text-white/80">
      <div className="flex h-16 items-center justify-between px-4">
        <Brand />
        <button className="rounded p-1 hover:bg-white/10 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {nav.map((n) => (
          <Link key={n.to} to={n.to} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/10 hover:text-white" activeProps={{ className: 'bg-white/12 text-white font-medium' }}>
            {n.icon}
            {n.label}
          </Link>
        ))}
      </div>
      <div className="border-t border-white/10 p-3 text-xs">
        <p className="truncate font-medium text-white">{user.name}</p>
        <p className="truncate text-white/60">{user.roles.join(' · ').toLowerCase()} · {user.tenantName}</p>
        <button onClick={() => void logout().then(() => navigate({ to: '/login' }))} className="mt-2 inline-flex items-center gap-1.5 text-white/70 hover:text-white">
          <LogOut className="size-3.5" /> {t('common.signOut')}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-64">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur">
          <button className="rounded-lg p-2 hover:bg-canvas lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
          {can('job.read') && (
            <form
              className="relative hidden max-w-md flex-1 sm:block"
              onSubmit={(e) => {
                e.preventDefault();
                void navigate({ to: '/jobs', search: { q } });
              }}
            >
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} className="h-10 w-full rounded-lg border border-line bg-canvas ps-9 pe-3 text-sm focus:border-brand focus:bg-white focus:outline-none" />
            </form>
          )}
          <div className="ms-auto flex items-center gap-2">
            <SyncPill />
            <button onClick={() => setLanguage(i18n.language === 'ar' ? 'en' : 'ar')} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted hover:bg-canvas hover:text-ink">
              <Languages className="size-4" /> <span className="hidden sm:inline">{t('common.language')}</span>
            </button>
            <Link to="/notifications" className="relative rounded-lg p-2 text-muted hover:bg-canvas hover:text-ink" aria-label={t('nav.notifications')}>
              <Bell className="size-5" />
              {!!unread.data?.unread && <span className="absolute -end-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-bad text-[10px] font-bold text-white">{unread.data.unread}</span>}
            </Link>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
            <Suspense fallback={<Spinner />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
