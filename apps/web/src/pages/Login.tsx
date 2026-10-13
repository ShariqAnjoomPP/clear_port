import { useState } from 'react';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { homeFor, useAuth } from '../lib/auth';
import { Brand } from '../layouts/AppShell';
import { Button, Input, ProblemAlert, Spinner } from '../components/ui';

type DemoUser = { email: string; name: string; roles: string[]; tenant_name: string };
const ROLE_HINT: Record<string, string> = {
  OWNER: 'Sees everything: board, finance, reports, settings',
  COORDINATOR: 'Opens jobs, drives stages, assigns PROs and trucks',
  PRO: 'Mobile tasks: files Bayan, DO and CCRO, records payments',
  INSPECTOR: 'Mobile: physical inspection results with photos',
  DRIVER: 'Mobile: trips, gate-out and proof of delivery',
  ACCOUNTS: 'Reconciles payments, floats and invoices',
  ADMIN: 'Users, master data and workflow settings',
  CUSTOMER: 'Customer portal: track shipments, approve charges',
};

export function LoginPage() {
  const { t } = useTranslation();
  const { user, ready, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const cfg = useQuery({ queryKey: ['auth-config'], queryFn: () => api.get<{ mode: string }>('/auth/config') });
  const demo = useQuery({ queryKey: ['demo-users'], queryFn: () => api.get<{ items: DemoUser[] }>('/auth/demo-users').then((r) => r.items), enabled: cfg.data?.mode === 'dev' });

  if (ready && user) return <Navigate to={homeFor(user)} />;

  const signIn = async (e: string) => {
    setBusy(e);
    setError(null);
    try {
      const u = await login(e);
      await navigate({ to: homeFor(u) });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const tenants = [...new Set((demo.data ?? []).map((d) => d.tenant_name))];
  return (
    <div className="grid min-h-full lg:grid-cols-[1fr_1.2fr]">
      <div className="hidden flex-col justify-between bg-navy p-10 text-white lg:flex">
        <Brand />
        <div>
          <h1 className="text-3xl font-semibold leading-tight">Every BL, every container,<br />from documents to delivery.</h1>
          <p className="mt-4 max-w-md text-white/70">Bayan and DO run in parallel, CCRO opens only when both are done, and every container is tracked to proof of delivery — with every fee captured and billed back.</p>
        </div>
        <p className="flex items-center gap-2 text-xs text-white/50"><ShieldCheck className="size-4" /> Tenant-isolated, audited, works offline in the field.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-xl">
          <div className="mb-6 lg:hidden"><Brand light={false} /></div>
          <h2 className="text-2xl font-semibold">{t('login.title')}</h2>
          {cfg.data?.mode === 'dev' ? <p className="mt-1 text-sm text-muted">{t('login.subtitle')}</p> : <p className="mt-1 text-sm text-muted">Sign in with your company account.</p>}
          <div className="mt-5"><ProblemAlert error={error} /></div>
          {demo.isLoading && <Spinner />}
          {tenants.map((tn) => (
            <div key={tn} className="mt-5">
              <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">{tn}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {demo.data!.filter((d) => d.tenant_name === tn).map((d) => (
                  <button key={d.email} onClick={() => void signIn(d.email)} disabled={!!busy} className="rounded-xl border border-line bg-white p-3 text-start transition hover:border-brand hover:shadow-sm disabled:opacity-60">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{d.name}</span>
                      <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-2">{d.roles.join(', ').toLowerCase()}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">{ROLE_HINT[d.roles[0] ?? ''] ?? d.email}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {cfg.data?.mode === 'dev' && (
            <form className="mt-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); void signIn(email); }}>
              <Input type="email" placeholder={t('login.or')} value={email} onChange={(e) => setEmail(e.target.value)} required />
              <Button variant="primary" loading={busy === email}>{t('login.signIn')}</Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
