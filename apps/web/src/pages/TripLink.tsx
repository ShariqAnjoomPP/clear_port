import { useEffect, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MapPin, Phone, Truck } from 'lucide-react';
import { api } from '../lib/api';
import { L } from '../lib/i18n';
import { Brand } from '../layouts/AppShell';
import { StageStatus } from '../components/StatusBadge';
import { Badge, Button, Card, Field, Input, ProblemAlert, Spinner } from '../components/ui';
import type { I18n, NextStep, StageField } from '../components/types';

/** No-login page for pages opened from a link (driver trip now; customer approval and portal in M5). */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      <header className="bg-navy px-4 py-3"><Brand /></header>
      <main className="mx-auto max-w-xl p-4">{children}</main>
    </div>
  );
}

type TripStage = { id: string; key: string; label: I18n; status: string; statusLabel?: I18n; done: boolean; fields: StageField[]; nextSteps: NextStep[] };
type TripView = { tripNo: string; status: string; driverName: string; plateNo: string; deliveryAddress: string; deliveryContact: string | null; deliveryWindow: string | null; blNo: string; port: string | null; terminal: string | null; containers: { id: string; containerNo: string; sizeType: string; stages: TripStage[] }[] };

/** Driver trip link: no account needed. Big buttons; proof of delivery with the receiver's name. */
export function TripLinkPage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const qc = useQueryClient();
  // Once completed the link is switched off, so stop refreshing and keep showing the final state.
  const live = (q: { state: { data?: TripView } }) => q.state.data?.status !== 'COMPLETED';
  const trip = useQuery({
    queryKey: ['trip-link', token],
    queryFn: () => api.get<TripView>(`/public/trips/${token}`),
    retry: false,
    refetchInterval: (q) => (live(q) ? 30_000 : false),
    refetchOnWindowFocus: (q) => live(q),
  });
  const [pod, setPod] = useState<{ stage: TripStage; step: NextStep } | null>(null);
  const [receiver, setReceiver] = useState('');
  // The proof-of-delivery form opens below the containers; bring it into view so the driver sees it on a phone.
  const podRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pod) podRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [pod]);
  const act = useMutation({
    mutationFn: (v: { stage: TripStage; step: NextStep; fields?: Record<string, unknown> }) => api.post<TripView>(`/public/trips/${token}/stages/${v.stage.id}/transitions`, { to: v.step.to, fields: v.fields ?? {} }),
    // The response is the updated trip (it still arrives after the last delivery, when the link itself is switched off).
    onSuccess: (view) => { setPod(null); setReceiver(''); qc.setQueryData(['trip-link', token], view); },
  });
  return (
    <PublicShell>
      {trip.isLoading ? <Spinner /> : trip.error ? <ProblemAlert error={trip.error} /> : trip.data && (
        <div className="space-y-3">
          <Card>
            <div className="flex items-center justify-between"><p className="text-lg font-semibold">{trip.data.tripNo}</p><Badge tone="info">{trip.data.status.toLowerCase().replace('_', ' ')}</Badge></div>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted"><Truck className="size-4" /> {trip.data.driverName} · {trip.data.plateNo}</p>
            <p className="mt-1 text-sm">Pick up at <span className="font-medium">{trip.data.port ?? 'port'}{trip.data.terminal ? ` · ${trip.data.terminal}` : ''}</span> · BL <span className="font-mono">{trip.data.blNo}</span></p>
            <a className="mt-2 flex items-start gap-1.5 text-sm text-brand-2" href={`https://maps.google.com/?q=${encodeURIComponent(trip.data.deliveryAddress)}`} target="_blank" rel="noreferrer"><MapPin className="mt-0.5 size-4 shrink-0" /> {trip.data.deliveryAddress}</a>
            {trip.data.deliveryContact && <a className="mt-1 flex items-center gap-1.5 text-sm text-brand-2" href={`tel:${trip.data.deliveryContact}`}><Phone className="size-4" /> {trip.data.deliveryContact}</a>}
            {trip.data.deliveryWindow && <p className="mt-1 text-sm text-muted">Window: {trip.data.deliveryWindow}</p>}
          </Card>
          {trip.data.status === 'COMPLETED' && <p className="flex items-center gap-1.5 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok"><CheckCircle2 className="size-4" /> Trip completed. Thank you, this link is now closed.</p>}
          <ProblemAlert error={act.error} />
          {trip.data.containers.map((c) => {
            const active = c.stages.find((s) => s.nextSteps.length && !s.done) ?? c.stages.find((s) => s.nextSteps.length);
            return (
              <Card key={c.id} title={<span className="font-mono text-base">{c.containerNo}</span>} actions={<Badge>{c.sizeType}</Badge>}>
                <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
                  {c.stages.map((s) => <div key={s.id} className="flex items-center justify-between gap-1 rounded-lg bg-canvas px-2 py-1.5"><span>{L(s.label)}</span><StageStatus s={s} /></div>)}
                </div>
                {active?.nextSteps.map((step) => (
                  <Button
                    key={step.to}
                    size="lg"
                    className="mb-2 w-full"
                    variant={step.gateOpen && step.primary ? 'primary' : 'secondary'}
                    disabled={!step.gateOpen || act.isPending}
                    onClick={() => (step.requiredFields.length ? setPod({ stage: active, step }) : act.mutate({ stage: active, step }))}
                  >
                    {L(step.label)}
                  </Button>
                ))}
                {active?.nextSteps.some((s) => !s.gateOpen) && <p className="text-xs text-warn">Waiting for: {[...new Set(active.nextSteps.flatMap((s) => s.waitingFor))].join(' · ')}</p>}
                {!active && <p className="flex items-center gap-1.5 text-sm text-ok"><CheckCircle2 className="size-4" /> Done</p>}
              </Card>
            );
          })}
          {pod && (
            <div ref={podRef}>
            <Card title="Proof of delivery">
              <div className="space-y-3">
                <Field label="Received by" required><Input value={receiver} onChange={(e) => setReceiver(e.target.value)} /></Field>
                <Button variant="primary" size="lg" className="w-full" disabled={!receiver.trim()} loading={act.isPending} onClick={() => act.mutate({ stage: pod.stage, step: pod.step, fields: { receiverName: receiver.trim() } })}>Confirm delivery</Button>
                <Button variant="ghost" className="w-full" onClick={() => setPod(null)}>Cancel</Button>
              </div>
            </Card>
            </div>
          )}
        </div>
      )}
    </PublicShell>
  );
}
