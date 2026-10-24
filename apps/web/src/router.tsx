import { lazy, Suspense, type ComponentType } from 'react';
import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { AppShell } from './layouts/AppShell';
import { Spinner } from './components/ui';

/** Every page is its own chunk: the first load carries only the shell. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const page = <M extends Record<string, any>>(loader: () => Promise<M>, name: keyof M & string) =>
  lazy(() => loader().then((m) => ({ default: m[name] as ComponentType })));
const SettingsPage = page(() => import('./pages/Settings'), 'SettingsPage');
const JobsPage = page(() => import('./pages/Jobs'), 'JobsPage');
const NewJobPage = page(() => import('./pages/Jobs'), 'NewJobPage');
const JobDetailPage = page(() => import('./pages/JobDetail'), 'JobDetailPage');
const CustomersPage = page(() => import('./pages/Customers'), 'CustomersPage');
const TasksPage = page(() => import('./pages/Tasks'), 'TasksPage');
const TripsPage = page(() => import('./pages/Trips'), 'TripsPage');
const TripLinkPage = page(() => import('./pages/TripLink'), 'TripLinkPage');
const FinancePage = page(() => import('./pages/Finance'), 'FinancePage');
const InvoicePage = page(() => import('./pages/Finance'), 'InvoicePage');
const NotificationsPage = page(() => import('./pages/Notifications'), 'NotificationsPage');
const ApprovePage = page(() => import('./pages/PublicPages'), 'ApprovePage');
const PortalShell = page(() => import('./pages/Portal'), 'PortalShell');
const PortalHome = page(() => import('./pages/Portal'), 'PortalHome');
const PortalJobPage = page(() => import('./pages/Portal'), 'PortalJobPage');
const HomePage = page(() => import('./pages/Home'), 'HomePage');
const SignInPage = page(() => import('./pages/SignIn'), 'SignInPage');
const TrackPage = page(() => import('./pages/Track'), 'TrackPage');
const TrackShipmentPage = page(() => import('./pages/Track'), 'TrackShipmentPage');
const SearchPage = page(() => import('./pages/Home'), 'SearchPage');
const MorePage = page(() => import('./pages/More'), 'MorePage');
const CustomerDetailPage = page(() => import('./pages/CustomerDetail'), 'CustomerDetailPage');
const ContainersPage = page(() => import('./pages/Containers'), 'ContainersPage');
const ReportsPage = page(() => import('./pages/Reports'), 'ReportsPage');

const root = createRootRoute({
  component: () => (
    <Suspense fallback={<Spinner />}>
      <Outlet />
    </Suspense>
  ),
});

// Staff sign-in (hosted demo: demouser / Demo@123).
const login = createRoute({ getParentRoute: () => root, path: '/login', component: SignInPage });
// No-login pages opened from a link (outside the app shell).
const tripLink = createRoute({ getParentRoute: () => root, path: '/t/$token', component: TripLinkPage });
const approve = createRoute({ getParentRoute: () => root, path: '/a/$token', component: ApprovePage });
const portal = createRoute({ getParentRoute: () => root, path: '/p/$token', component: PortalShell });
const portalHome = createRoute({ getParentRoute: () => portal, path: '/', component: PortalHome });
const portalJob = createRoute({ getParentRoute: () => portal, path: '/jobs/$jobId', component: PortalJobPage });
// Public tracking page: one link for every customer, opened with their mobile number.
const track = createRoute({ getParentRoute: () => root, path: '/track', component: TrackPage });
const trackShipment = createRoute({ getParentRoute: () => root, path: '/track/$jobId', component: TrackShipmentPage });

// The staff app: any call without a valid sign-in sends the browser to /login.
const app = createRoute({ getParentRoute: () => root, id: 'app', component: AppShell });
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const JOB_FILTERS = ['OPEN', 'OVERDUE', 'DOCUMENTS', 'CLEARANCE', 'CCRO', 'DELIVERY', 'READY_TO_CLOSE', 'CLOSED'] as const;
type JobFilter = (typeof JOB_FILTERS)[number];
// The kanban board is no longer in the navigation: Home and the Jobs list (with phase filters) replace it.
const home = createRoute({ getParentRoute: () => app, path: '/', component: HomePage });
const search = createRoute({ getParentRoute: () => app, path: '/search', component: SearchPage, validateSearch: (s: Record<string, unknown>): { q?: string } => ({ q: str(s.q) }) });
const more = createRoute({ getParentRoute: () => app, path: '/more', component: MorePage });
const jobs = createRoute({
  getParentRoute: () => app, path: '/jobs', component: JobsPage,
  validateSearch: (s: Record<string, unknown>): { q?: string; filter?: JobFilter } => ({ q: str(s.q), filter: JOB_FILTERS.includes(s.filter as JobFilter) ? (s.filter as JobFilter) : undefined }),
});
const newJob = createRoute({ getParentRoute: () => app, path: '/jobs/new', component: NewJobPage, validateSearch: (s: Record<string, unknown>): { customerId?: string } => ({ customerId: str(s.customerId) }) });
const job = createRoute({ getParentRoute: () => app, path: '/jobs/$jobId', component: JobDetailPage });
const tasks = createRoute({ getParentRoute: () => app, path: '/tasks', component: TasksPage });
const containers = createRoute({ getParentRoute: () => app, path: '/containers', component: ContainersPage });
const customers = createRoute({ getParentRoute: () => app, path: '/customers', component: CustomersPage });
const customer = createRoute({ getParentRoute: () => app, path: '/customers/$customerId', component: CustomerDetailPage });
const trips = createRoute({ getParentRoute: () => app, path: '/trips', component: TripsPage });
const finance = createRoute({ getParentRoute: () => app, path: '/finance', component: FinancePage });
const invoice = createRoute({ getParentRoute: () => app, path: '/invoices/$invoiceId', component: InvoicePage });
const reports = createRoute({ getParentRoute: () => app, path: '/reports', component: ReportsPage });
const notifications = createRoute({ getParentRoute: () => app, path: '/notifications', component: NotificationsPage });
const settings = createRoute({ getParentRoute: () => app, path: '/settings', component: SettingsPage });

const routeTree = root.addChildren([
  login,
  tripLink,
  approve,
  portal.addChildren([portalHome, portalJob]),
  track,
  trackShipment,
  app.addChildren([home, search, more, jobs, newJob, job, tasks, containers, customers, customer, trips, finance, invoice, reports, notifications, settings]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
