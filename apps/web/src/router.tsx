import { lazy, Suspense, type ComponentType } from 'react';
import { createRootRoute, createRoute, createRouter, Navigate, Outlet } from '@tanstack/react-router';
import { homeFor, useAuth } from './lib/auth';
import { AppShell } from './layouts/AppShell';
import { Spinner } from './components/ui';

/** Every page is its own chunk: the first load carries only the shell (performance budget, architecture §9). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const page = <M extends Record<string, any>>(loader: () => Promise<M>, name: keyof M & string) =>
  lazy(() => loader().then((m) => ({ default: m[name] as ComponentType })));
const LoginPage = page(() => import('./pages/Login'), 'LoginPage');
const BoardPage = page(() => import('./pages/Board'), 'BoardPage');
const JobsPage = page(() => import('./pages/Jobs'), 'JobsPage');
const NewJobPage = page(() => import('./pages/Jobs'), 'NewJobPage');
const JobDetailPage = page(() => import('./pages/JobDetail'), 'JobDetailPage');
const FieldPage = page(() => import('./pages/Tasks'), 'FieldPage');
const TasksPage = page(() => import('./pages/Tasks'), 'TasksPage');
const ContainersPage = page(() => import('./pages/Containers'), 'ContainersPage');
const CustomersPage = page(() => import('./pages/Customers'), 'CustomersPage');
const TripsPage = page(() => import('./pages/Trips'), 'TripsPage');
const FinancePage = page(() => import('./pages/Finance'), 'FinancePage');
const InvoicePage = page(() => import('./pages/Finance'), 'InvoicePage');
const ReportsPage = page(() => import('./pages/Reports'), 'ReportsPage');
const SettingsPage = page(() => import('./pages/Settings'), 'SettingsPage');
const NotificationsPage = page(() => import('./pages/Notifications'), 'NotificationsPage');
const PortalHome = page(() => import('./pages/Portal'), 'PortalHome');
const PortalJobPage = page(() => import('./pages/Portal'), 'PortalJobPage');
const PortalShell = page(() => import('./pages/Portal'), 'PortalShell');
const ApprovePage = page(() => import('./pages/PublicPages'), 'ApprovePage');
const TripLinkPage = page(() => import('./pages/PublicPages'), 'TripLinkPage');

function Home() {
  const { user, ready } = useAuth();
  if (!ready) return <Spinner />;
  return <Navigate to={homeFor(user)} />;
}

function FieldGuard() {
  const { user, ready } = useAuth();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to="/login" />;
  return <FieldPage />;
}

const root = createRootRoute({
  component: () => (
    <Suspense fallback={<Spinner />}>
      <Outlet />
    </Suspense>
  ),
});
const home = createRoute({ getParentRoute: () => root, path: '/', component: Home });
const login = createRoute({ getParentRoute: () => root, path: '/login', component: LoginPage });
const approve = createRoute({ getParentRoute: () => root, path: '/approve/$token', component: ApprovePage });
const tripLink = createRoute({ getParentRoute: () => root, path: '/trip/$token', component: TripLinkPage });
const field = createRoute({ getParentRoute: () => root, path: '/field', component: FieldGuard });

const app = createRoute({ getParentRoute: () => root, id: 'app', component: AppShell });
const board = createRoute({ getParentRoute: () => app, path: '/board', component: BoardPage });
const jobs = createRoute({ getParentRoute: () => app, path: '/jobs', component: JobsPage, validateSearch: (s: Record<string, unknown>): { q?: string } => (typeof s.q === 'string' && s.q ? { q: s.q } : {}) });
const newJob = createRoute({ getParentRoute: () => app, path: '/jobs/new', component: NewJobPage });
const job = createRoute({ getParentRoute: () => app, path: '/jobs/$jobId', component: JobDetailPage });
const tasks = createRoute({ getParentRoute: () => app, path: '/tasks', component: TasksPage });
const containers = createRoute({ getParentRoute: () => app, path: '/containers', component: ContainersPage });
const customers = createRoute({ getParentRoute: () => app, path: '/customers', component: CustomersPage });
const trips = createRoute({ getParentRoute: () => app, path: '/trips', component: TripsPage });
const finance = createRoute({ getParentRoute: () => app, path: '/finance', component: FinancePage });
const invoice = createRoute({ getParentRoute: () => app, path: '/invoices/$invoiceId', component: InvoicePage });
const reports = createRoute({ getParentRoute: () => app, path: '/reports', component: ReportsPage });
const settings = createRoute({ getParentRoute: () => app, path: '/settings', component: SettingsPage });
const notifications = createRoute({ getParentRoute: () => app, path: '/notifications', component: NotificationsPage });

const portal = createRoute({ getParentRoute: () => root, path: '/portal', component: PortalShell });
const portalHome = createRoute({ getParentRoute: () => portal, path: '/', component: PortalHome });
const portalJob = createRoute({ getParentRoute: () => portal, path: '/jobs/$jobId', component: PortalJobPage });

const routeTree = root.addChildren([
  home, login, approve, tripLink, field,
  app.addChildren([board, jobs, newJob, job, tasks, containers, customers, trips, finance, invoice, reports, settings, notifications]),
  portal.addChildren([portalHome, portalJob]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
