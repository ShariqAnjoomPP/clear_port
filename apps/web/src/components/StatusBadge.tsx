import { Badge, type Tone } from './ui';
import { L } from '../lib/i18n';

export function stageTone(s: { done?: boolean; overdue?: boolean; status: string }): Tone {
  if (s.done) return 'ok';
  if (s.overdue) return 'bad';
  if (['HELD', 'QUERY_RAISED'].includes(s.status)) return 'warn';
  if (['NOT_STARTED', 'PENDING', 'UNASSIGNED', 'AWAITING', 'DRAFT'].includes(s.status)) return 'neutral';
  return 'info';
}

export function StageStatus({ s }: { s: { done?: boolean; overdue?: boolean; status: string; statusLabel?: { en: string; ar: string } } }) {
  return <Badge tone={stageTone(s)}>{L(s.statusLabel) || s.status}</Badge>;
}

const PHASE_TONE: Record<string, Tone> = { DOCUMENTS: 'neutral', CLEARANCE: 'info', CCRO: 'brand', DELIVERY: 'info', READY_TO_CLOSE: 'ok', CLOSED: 'neutral' };
export const phaseTone = (p: string): Tone => PHASE_TONE[p] ?? 'neutral';

export function PriorityBadge({ p }: { p: string }) {
  if (p === 'URGENT') return <Badge tone="bad">Urgent</Badge>;
  if (p === 'HIGH') return <Badge tone="warn">High</Badge>;
  return null;
}
