import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { BarChart3, Bell, Boxes, ClipboardList, Languages, LogOut, MapPinned, Settings, Truck, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { useHome } from '../lib/hooks';
import i18n, { setLanguage } from '../lib/i18n';
import { useSession } from '../lib/session';
import { Badge, ListCard, ListItem, SectionTitle } from '../components/ui';

const icon = (el: React.ReactNode) => <span className="flex size-10 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">{el}</span>;

/** Everything that isn't on the bottom navigation. */
export function MorePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const home = useHome();
  const session = useSession();
  const h = home.data;
  const go = (to: string) => () => void navigate({ to });
  return (
    <>
      <h1 className="mt-2 mb-4 text-2xl font-semibold tracking-tight">More</h1>
      <SectionTitle>Operations</SectionTitle>
      <ListCard>
        <ListItem leading={icon(<ClipboardList className="size-5" />)} title={t('nav.tasks')} subtitle="Open steps by person, overdue first" trailing={h?.overdueStages ? <Badge tone="bad">{h.overdueStages} overdue</Badge> : undefined} onClick={go('/tasks')} />
        <ListItem leading={icon(<Truck className="size-5" />)} title={t('nav.trips')} subtitle="Assign trucks, driver links, fleet" onClick={go('/trips')} />
        <ListItem leading={icon(<Boxes className="size-5" />)} title={t('nav.containers')} subtitle="Every container and its free time" trailing={h?.freeTimeRisk ? <Badge tone="warn">{h.freeTimeRisk} at risk</Badge> : undefined} onClick={go('/containers')} />
        <ListItem leading={icon(<MapPinned className="size-5" />)} title="Customer tracking page" subtitle="The link customers open with their mobile number" onClick={() => window.open('/track', '_blank')} />
      </ListCard>
      <SectionTitle>Money and insight</SectionTitle>
      <ListCard>
        <ListItem leading={icon(<Wallet className="size-5" />)} title={t('nav.finance')} subtitle="Payments, PRO floats, invoices, receivables" onClick={go('/finance')} />
        <ListItem leading={icon(<BarChart3 className="size-5" />)} title={t('nav.reports')} subtitle="Cycle time, free time, profitability, team" onClick={go('/reports')} />
      </ListCard>
      <SectionTitle>App</SectionTitle>
      <ListCard>
        <ListItem leading={icon(<Bell className="size-5" />)} title={t('nav.notifications')} subtitle="Inbox, messages sent, needs attention" trailing={h?.unreadNotifications ? <Badge tone="bad">{h.unreadNotifications}</Badge> : undefined} onClick={go('/notifications')} />
        <ListItem leading={icon(<Settings className="size-5" />)} title={t('nav.settings')} subtitle="Company, staff, master data, workflow" onClick={go('/settings')} />
        <ListItem
          leading={icon(<Languages className="size-5" />)}
          title="Language"
          subtitle={i18n.language === 'ar' ? 'العربية' : 'English'}
          trailing={<span className="text-sm font-medium text-primary">{i18n.language === 'ar' ? 'English' : 'العربية'}</span>}
          onClick={() => setLanguage(i18n.language === 'ar' ? 'en' : 'ar')}
        />
        <ListItem
          leading={icon(<LogOut className="size-5" />)}
          title="Sign out"
          subtitle={session.data ? `Signed in as ${session.data.user.name}` : undefined}
          onClick={() => void api.post('/session/logout').finally(() => window.location.assign('/login'))}
        />
      </ListCard>
      {session.data && <p className="mt-6 text-center text-xs text-on-surface-variant">{session.data.company.name} · signed in as {session.data.user.name}</p>}
    </>
  );
}
