import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { listQueued, type QueuedAction } from './offline';

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function useOutbox() {
  const [items, setItems] = useState<QueuedAction[]>([]);
  useEffect(() => {
    const load = () => void listQueued().then(setItems);
    load();
    window.addEventListener('outbox-changed', load);
    return () => window.removeEventListener('outbox-changed', load);
  }, []);
  return items;
}

export type StaffUser = { id: string; name: string; email: string; roles: string[]; active: boolean; phone: string | null; customerId: string | null };
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api.get<{ items: StaffUser[] }>('/v1/platform/admin/users').then((r) => r.items), staleTime: 60_000 });

export type MasterItem = { id: string; kind: string; code: string; name: string };
export const useMaster = (kind?: string) =>
  useQuery({ queryKey: ['master', kind ?? 'all'], queryFn: () => api.get<{ items: MasterItem[] }>(`/v1/platform/admin/master-data${kind ? `?kind=${kind}` : ''}`).then((r) => r.items), staleTime: 300_000 });

export type CustomerLite = { id: string; name: string; customsCode: string | null; preferredChannel: string; openJobs: number; tariff: { currency: string; perBl: string; perContainer: string; vatPct: number } | null; creditLimit: string | null; creditDays: number };
export const useCustomers = (q = '') => useQuery({ queryKey: ['customers', q], queryFn: () => api.get<{ items: CustomerLite[] }>(`/v1/customers?q=${encodeURIComponent(q)}`).then((r) => r.items) });
