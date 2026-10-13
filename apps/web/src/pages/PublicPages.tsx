import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MapPin, Phone, Truck } from 'lucide-react';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { L } from '../lib/i18n';
import { Brand } from '../layouts/AppShell';
import { StageStatus } from '../components/StatusBadge';
import { SignaturePad } from '../components/SignaturePad';
import { Badge, Button, Card, Field, Input, ProblemAlert, Spinner, Textarea } from '../components/ui';
import type { I18n, NextStep, StageField } from '../components/types';
import { ChargesTable } from './Portal';

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      <header className="bg-navy px-4 py-3"><Brand /></header>
      <main className="mx-auto max-w-xl p-4">{children}</main>
    </div>
  );
}

/** One-tap approval link from WhatsApp / email (BAY-005). No login; the token is single-purpose and expires. */
export function ApprovePage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const a = useQuery({ queryKey: ['approval', token], queryFn: () => api.get<{ status: string; summary: Parameters<typeof ChargesTable>[0]['s']; expiresAt: string; decidedAt: string | null }>(`/public/approvals/${token}`), retry: false });
  const decide = useMutation({ mutationFn: (decision: 'APPROVED' | 'REJECTED') => api.post(`/public/approvals/${token}/decision`, { decision, note: note || undefined }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['approval', token] }) });
  return (
    <PublicShell>
      {a.isLoading ? <Spinner /> : a.error ? <ProblemAlert error={a.error} /> : a.data && (
        <Card title={<span>Charges for BL <span className="font-mono">{a.data.summary.blNo}</span></span>}>
          {a.data.status !== 'PENDING' ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="size-10 text-ok" />
              <p className="font-medium">{a.data.status === 'APPROVED' ? 'Thank you — charges approved.' : a.data.status === 'REJECTED' ? 'Your dispute was sent to the team.' : 'This request is no longer open.'}</p>
              {a.data.decidedAt && <p className="text-sm text-muted">{fmtDateTime(a.data.decidedAt)}</p>}
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">Your clearing agent paid these amounts to customs and the shipping line for your shipment. Approve to continue clearance.</p>
              <ChargesTable s={a.data.summary} />
              <Field label="Note (optional)" className="mt-4"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button variant="primary" size="lg" loading={decide.isPending} onClick={() => decide.mutate('APPROVED')}>Approve</Button>
                <Button size="lg" onClick={() => decide.mutate('REJECTED')}>Dispute</Button>
              </div>
              <div className="mt-3"><ProblemAlert error={decide.error} /></div>
              <p className="mt-3 text-xs text-muted">Link expires {fmtDateTime(a.data.expiresAt)}.</p>
            </>
          )}
        </Card>
      )}
    </PublicShell>
  );
}

type TripStage = { id: string; key: string; label: I18n; status: string; statusLabel?: I18n; done: boolean; version: number; fields: StageField[]; nextSteps: NextStep[] };
type TripView = { tripNo: string; status: string; driverName: string; plateNo: string; deliveryAddress: string; deliveryContact: string | null; deliveryWindow: string | null; blNo: string; port: string | null; terminal: string | null; containers: { id: string; containerNo: string; sizeType: string; stages: TripStage[] }[] };

/** Driver trip link (TRK-004): no account needed. Big buttons; POD with receiver name and signature. */
export function TripLinkPage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const qc = useQueryClient();
  const trip = useQuery({ queryKey: ['trip-link', token], queryFn: () => api.get<TripView>(`/public/trips/${token}`), retry: false, refetchInterval: 30_000 });
  const [pod, setPod] = useState<{ stage: TripStage; step: NextStep } | null>(null);
  const [receiver, setReceiver] = useState('');
  const [signature, setSignature] = useState('');
  const act = useMutation({
    mutationFn: (v: { stage: TripStage; step: NextStep; fields?: Record<string, unknown> }) => api.post(`/public/trips/${token}/stages/${v.stage.id}/transitions`, { to: v.step.to, fields: v.fields ?? {}, clientOccurredAt: new Date().toISOString() }),
    onSuccess: () => { setPod(null); setReceiver(''); setSignature(''); void qc.invalidateQueries({ queryKey: ['trip-link', token] }); },
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
            <Card title="Proof of delivery">
              <div className="space-y-3">
                <Field label="Received by" required><Input value={receiver} onChange={(e) => setReceiver(e.target.value)} /></Field>
                <Field label="Signature" required><SignaturePad value={signature} onChange={setSignature} /></Field>
                <Button variant="primary" size="lg" className="w-full" disabled={!receiver || !signature} loading={act.isPending} onClick={() => act.mutate({ stage: pod.stage, step: pod.step, fields: { receiverName: receiver, podSignature: signature } })}>Confirm delivery</Button>
                <Button variant="ghost" className="w-full" onClick={() => setPod(null)}>Cancel</Button>
              </div>
            </Card>
          )}
        </div>
      )}
    </PublicShell>
  );
}
