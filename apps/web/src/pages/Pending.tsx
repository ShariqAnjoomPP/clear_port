import { Construction } from 'lucide-react';
import { useRouterState } from '@tanstack/react-router';
import { Empty, PageHeader } from '../components/ui';

/** Placeholder for screens not yet moved to the lite API. Each one is replaced in its milestone. */
const MILESTONE: Record<string, string> = {
  '/': 'Board — milestone 6',
  '/containers': 'Containers — milestone 6',
  '/reports': 'Reports — milestone 6',
};

export function PendingPage() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const label = MILESTONE[path] ?? 'This screen';
  return (
    <>
      <PageHeader title={label.split(' — ')[0]} />
      <Empty icon={<Construction className="size-6" />} title="Not built yet">
        {label.includes('—') ? `Coming in ${label.split(' — ')[1]}.` : 'Coming in a later milestone.'}
      </Empty>
    </>
  );
}
