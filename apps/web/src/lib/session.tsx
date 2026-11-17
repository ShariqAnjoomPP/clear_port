import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { setBaseCurrency } from './format';

export type Company = { name: string; address: string | null; trn: string | null; baseCurrency: string; timezone: string; vatPct: string; assignSteps: boolean; sequentialSteps: boolean; phone: string | null; whatsapp: string | null; email: string | null };
export type Session = { user: { id: string; name: string; email: string }; company: Company };

/** Prototype session: the API always acts as the seeded demo user, so there is nothing to log in to. */
export const useSession = () => useQuery({
  queryKey: ['session'],
  queryFn: async () => {
    const s = await api.get<Session>('/session/me');
    setBaseCurrency(s.company.baseCurrency); // money everywhere defaults to the agency's currency
    return s;
  },
  staleTime: Infinity,
});
