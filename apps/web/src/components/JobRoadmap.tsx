import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, CheckCircle2, Truck } from 'lucide-react';
import { api } from '../lib/api';
import { fmtDate, fmtDateTime } from '../lib/format';
import { L } from '../lib/i18n';
import { StageCard } from './StageCard';
import { stageTone } from './StatusBadge';
import { Badge, Empty } from './ui';
import type { JobDetail, StageView } from './types';

/** The road a job travels. Bayan, customer and inspection (customs) run alongside the DO (shipping line); both meet at CCRO. */
const ROAD = ['DOCUMENTS', 'BAYAN', 'CUSTOMER_COMM', 'INSPECTION', 'DO', 'CCRO', 'DELIVERY'] as const;
type RoadKey = (typeof ROAD)[number];
const SHORT: Record<RoadKey, string> = { DOCUMENTS: 'Documents', BAYAN: 'Bayan', CUSTOMER_COMM: 'Customer', INSPECTION: 'Inspection', DO: 'DO', CCRO: 'CCRO', DELIVERY: 'Delivery' };
const CONTAINER_KEYS = ['TRUCK', 'PHYSICAL_INSPECTION', 'RELEASE', 'DELIVERY'];

type NodeState = { done: boolean; started: boolean; actionable: boolean; caption: string };

function nodeState(j: JobDetail, key: RoadKey): NodeState {
  if (key === 'DELIVERY') {
    const per = j.containers.map((c) => j.stages.containerStages[c.id] ?? []);
    const delivered = per.filter((list) => list.find((s) => s.key === 'DELIVERY')?.done).length;
    const any = per.some((list) => list.length > 0);
    return {
      done: j.containers.length > 0 && delivered === j.containers.length,
      started: any,
      actionable: per.some((list) => list.some((s) => !s.done && s.nextSteps.some((n) => n.gateOpen))),
      caption: any ? `${delivered}/${j.containers.length} delivered` : 'After port release',
    };
  }
  const s = j.stages.jobStages.find((x) => x.key === key);
  if (!s) return { done: false, started: false, actionable: false, caption: '—' };
  return { done: s.done, started: !!s.startedAt || s.status !== s.statuses[0]?.key, actionable: s.nextSteps.some((n) => n.gateOpen), caption: L(s.statusLabel) };
}

/** The step to show first: the earliest one that can be worked on now, else the earliest unfinished one. */
export function currentRoadKey(j: JobDetail): RoadKey {
  const open = ROAD.filter((k) => !nodeState(j, k).done);
  if (!open.length) return 'DELIVERY';
  return open.find((k) => nodeState(j, k).actionable) ?? open[0]!;
}

export type { RoadKey };

/** Which roadmap step is shown: starts on the current one and follows the job when it moves on. */
export function useRoadSelection(j: JobDetail | undefined) {
  const current = j ? currentRoadKey(j) : 'DOCUMENTS';
  const [selected, setSelected] = useState<RoadKey>(current);
  const lastCurrent = useRef(current);
  useEffect(() => {
    if (lastCurrent.current !== current) {
      lastCurrent.current = current;
      setSelected(current);
    }
  }, [current]);
  return [selected, setSelected] as const;
}

/** Roadmap across the top: done steps ticked, the current step highlighted, upcoming steps grey and locked. Tap a done step to look back. */
export function JobRoadmap({ j, selected, onSelect }: { j: JobDetail; selected: RoadKey; onSelect: (k: RoadKey) => void }) {
  const current = currentRoadKey(j);
  const setSelected = onSelect;
  const nodeRefs = useRef<Partial<Record<RoadKey, HTMLButtonElement | null>>>({});
  useEffect(() => {
    nodeRefs.current[selected]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selected]);

  return (
      <nav aria-label="Job progress" className="no-scrollbar -mx-4 overflow-x-auto px-4 pt-2 pb-1">
        <ol className="flex min-w-max items-start">
          {ROAD.map((key, i) => {
            const st = nodeState(j, key);
            const isCurrent = key === current && j.status === 'OPEN';
            const isSelected = key === selected;
            // Only completed steps and the current one can be opened; upcoming steps unlock one by one.
            const reachable = st.done || key === current;
            return (
              <li key={key} className="flex items-start">
                <button
                  ref={(el) => { nodeRefs.current[key] = el; }}
                  onClick={() => reachable && setSelected(key)}
                  disabled={!reachable}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-pressed={isSelected}
                  title={reachable ? undefined : 'Unlocks when the steps before it are complete'}
                  className={clsx('flex w-[76px] flex-col items-center gap-1 rounded-2xl px-1 py-2 transition', isSelected && 'bg-secondary-container', !reachable && 'cursor-not-allowed opacity-55')}
                >
                  <span
                    className={clsx(
                      'flex size-9 items-center justify-center rounded-full text-sm font-semibold',
                      st.done ? 'bg-primary text-on-primary'
                        : isCurrent ? 'bg-primary-container text-on-primary-container ring-[3px] ring-primary'
                          : st.started ? 'bg-primary-container text-on-primary-container'
                            : 'bg-surface-container-highest text-on-surface-variant',
                    )}
                  >
                    {st.done ? <Check className="size-5" /> : key === 'DELIVERY' ? <Truck className="size-4" /> : i + 1}
                  </span>
                  <span className={clsx('text-xs', isCurrent || isSelected ? 'font-semibold text-on-surface' : 'font-medium text-on-surface-variant')}>{SHORT[key]}</span>
                  <span className={clsx('max-w-full truncate text-[10px]', isCurrent ? 'text-primary' : 'text-on-surface-variant')}>{isCurrent ? 'Current' : st.caption}</span>
                </button>
                {i < ROAD.length - 1 && <span className={clsx('mt-[26px] h-[3px] w-4 shrink-0 rounded-full', nodeState(j, ROAD[i + 1]!).done || st.done ? 'bg-primary' : 'bg-outline-variant')} aria-hidden />}
              </li>
            );
          })}
        </ol>
      </nav>
  );
}

/** Details of the step selected on the roadmap. */
export function RoadStepDetail({ j, selected, onChanged }: { j: JobDetail; selected: RoadKey; onChanged: () => void }) {
  return selected === 'DELIVERY'
    ? <DeliveryDetail j={j} onChanged={onChanged} />
    : <StageDetail j={j} stage={j.stages.jobStages.find((s) => s.key === selected)} isCurrent={selected === currentRoadKey(j)} onChanged={onChanged} />;
}

type TimelineItem = { at: string; kind: string; title: string; actor: string | null; remarks?: string | null; container?: string | null };
const useTimeline = (jobId: string) => useQuery({ queryKey: ['timeline', jobId], queryFn: () => api.get<{ items: TimelineItem[] }>(`/jobs/${jobId}/timeline`).then((r) => r.items) });

/** One job-level step: its actions (if any), what was recorded, and its own history. */
function StageDetail({ j, stage, isCurrent, onChanged }: { j: JobDetail; stage: StageView | undefined; isCurrent: boolean; onChanged: () => void }) {
  const timeline = useTimeline(j.id);
  if (!stage) return null;
  const conts = j.containers.map((c) => ({ id: c.id, containerNo: c.containerNo }));
  const history = (timeline.data ?? []).filter((i) => i.kind === 'stage' && i.title.startsWith(`${stage.label.en}:`));
  const recorded = recordedFields(stage, j);
  return (
    <div className="space-y-3">
      {isCurrent && j.status === 'OPEN' && <Badge tone="brand">Current step</Badge>}
      <StageCard jobId={j.id} stage={stage} canAssign={j.status === 'OPEN'} containers={conts} onChanged={onChanged} />
      {recorded.length > 0 && (
        <div className="rounded-[var(--radius-card)] bg-surface-container-lowest p-4 ring-1 ring-outline-variant/60">
          <p className="mb-2 text-sm font-semibold">Recorded</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {recorded.map(([label, value]) => (
              <div key={label} className="min-w-0"><dt className="text-xs text-on-surface-variant">{label}</dt><dd className="break-words">{value}</dd></div>
            ))}
          </dl>
        </div>
      )}
      <StageHistory items={history} />
    </div>
  );
}

/** Values captured on a step (reference numbers, dates, selected containers…), readable. Signatures are not repeated here. */
function recordedFields(stage: StageView, j: JobDetail): [string, string][] {
  const out: [string, string][] = [];
  if (stage.referenceNo) out.push(['Reference', stage.referenceNo]);
  for (const f of stage.fields) {
    if (f.key === 'referenceNo' || f.type === 'signature') continue;
    const v = stage.data[f.key];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    const text = f.type === 'containers' && Array.isArray(v)
      ? v.map((id) => j.containers.find((c) => c.id === id)?.containerNo ?? id).join(', ')
      : f.type === 'date' ? fmtDate(String(v)) : String(v);
    out.push([L(f.label), text]);
  }
  return out;
}

function StageHistory({ items }: { items: TimelineItem[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-[var(--radius-card)] bg-surface-container-lowest p-4 ring-1 ring-outline-variant/60">
      <p className="mb-2 text-sm font-semibold">History</p>
      <ol className="space-y-2.5">
        {items.map((i, idx) => (
          <li key={idx} className="flex gap-3 text-sm">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden />
            <div className="min-w-0">
              <p>{i.title.split(': ').slice(1).join(': ')}{i.container && <span className="ms-1 font-mono text-xs text-on-surface-variant">{i.container}</span>}</p>
              {i.remarks && <p className="text-on-surface-variant italic">“{i.remarks}”</p>}
              <p className="text-xs text-on-surface-variant">{fmtDateTime(i.at)}{i.actor && ` · ${i.actor}`}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Delivery is per container: each one's four steps at a glance, and the card for its current step. */
function DeliveryDetail({ j, onChanged }: { j: JobDetail; onChanged: () => void }) {
  const conts = j.containers.map((c) => ({ id: c.id, containerNo: c.containerNo }));
  if (!Object.keys(j.stages.containerStages).length) {
    return <div className="rounded-[var(--radius-card)] bg-surface-container-lowest ring-1 ring-outline-variant/60"><Empty icon={<Truck className="size-7" />} title="Not started yet">Each container gets its truck, release and delivery steps once the port release is issued.</Empty></div>;
  }
  return (
    <div className="space-y-3">
      {j.containers.map((c) => {
        const stages = (j.stages.containerStages[c.id] ?? []).slice().sort((a, b) => CONTAINER_KEYS.indexOf(a.key) - CONTAINER_KEYS.indexOf(b.key));
        const next = stages.find((s) => !s.done && s.nextSteps.some((n) => n.gateOpen)) ?? stages.find((s) => !s.done);
        return (
          <section key={c.id} className="rounded-[var(--radius-card)] bg-surface-container-low p-3 ring-1 ring-outline-variant/60">
            <div className="flex items-center justify-between gap-2 px-1">
              <p className="font-mono text-sm font-semibold">{c.containerNo} <span className="font-sans text-xs font-normal text-on-surface-variant">{c.sizeType}</span></p>
              {!next && <span className="inline-flex items-center gap-1 text-sm font-medium text-success"><CheckCircle2 className="size-4" /> Delivered</span>}
            </div>
            <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {stages.map((s) => <span key={s.id} className="shrink-0"><Badge tone={stageTone(s)}>{L(s.label)}: {L(s.statusLabel)}</Badge></span>)}
            </div>
            {next && <div className="mt-2"><StageCard jobId={j.id} stage={next} canAssign={j.status === 'OPEN'} containers={conts} onChanged={onChanged} /></div>}
          </section>
        );
      })}
      <p className="px-1 text-sm text-on-surface-variant">Assign trucks from the Trips tab; drivers update truck, release and delivery from their own link.</p>
    </div>
  );
}
