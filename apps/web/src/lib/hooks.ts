import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type StaffRole = 'COORDINATOR' | 'PRO' | 'INSPECTOR' | 'DRIVER' | 'ACCOUNTS';
export type Staff = { id: string; name: string; role: StaffRole; phone: string | null; email: string | null; licenceNo: string | null; licenceExpiry: string | null; transporter: string | null; active: boolean };

/** Active staff, optionally one role (assignment pickers). */
export const useStaff = (role?: StaffRole) =>
  useQuery({ queryKey: ['staff', role ?? 'all'], queryFn: () => api.get<{ items: Staff[] }>(`/settings/staff${role ? `?role=${role}` : ''}`).then((r) => r.items), staleTime: 60_000 });

export type MasterItem = { id: string; kind: string; code: string; name: string };
export const useMaster = (kind?: string) =>
  useQuery({ queryKey: ['master', kind ?? 'all'], queryFn: () => api.get<{ items: MasterItem[] }>(`/settings/master-data${kind ? `?kind=${kind}` : ''}`).then((r) => r.items), staleTime: 300_000 });

export type Contact = { id?: string; name: string; email?: string; phone?: string; role?: string; whatsappOptIn: boolean };
export type CustomerLite = { id: string; name: string; customsCode: string | null; preferredChannel: string; openJobs: number; tariff: { currency: string; perBl: string; perContainer: string; vatPct: number } | null; creditLimit: string | null; creditDays: number; contacts: Contact[] };
export const useCustomers = (q = '') => useQuery({ queryKey: ['customers', q], queryFn: () => api.get<{ items: CustomerLite[] }>(`/customers?q=${encodeURIComponent(q)}`).then((r) => r.items) });

export type HomeSummary = {
  openJobs: number; overdueJobs: number; customers: number; overdueStages: number; freeTimeRisk: number; pendingApprovals: number; unreadNotifications: number;
  recent: import('../components/types').JobSummary[];
};
/** Counts and recent jobs for the Home screen. */
export const useHome = () => useQuery({ queryKey: ['home'], queryFn: () => api.get<HomeSummary>('/insight/home'), refetchInterval: 30_000 });
