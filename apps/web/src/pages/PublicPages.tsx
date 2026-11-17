import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Button, Card, Field, ProblemAlert, Spinner, Textarea } from '../components/ui';
import { ChargesTable, type ApprovalSummary } from './Portal';
import { PublicShell } from './TripLink';

/** One-tap approval link from WhatsApp / email. No login; the link opens only this request and is answered once. */
export function ApprovePage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const a = useQuery({ queryKey: ['approval', token], queryFn: () => api.get<{ status: string; summary: ApprovalSummary; expiresAt: string; decidedAt: string | null }>(`/public/approvals/${token}`), retry: false });
  const decide = useMutation({ mutationFn: (decision: 'APPROVED' | 'REJECTED') => api.post(`/public/approvals/${token}/decision`, { decision, note: note || undefined }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['approval', token] }) });
  return (
    <PublicShell>
      {a.isLoading ? <Spinner /> : a.error ? <ProblemAlert error={a.error} /> : a.data && (
        <Card title={<span>Charges for BL <span className="font-mono">{a.data.summary.blNo}</span></span>}>
          {a.data.status !== 'PENDING' ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="size-10 text-ok" />
              <p className="font-medium">{a.data.status === 'APPROVED' ? 'Thank you — charges approved.' : a.data.status === 'REJECTED' ? 'Your dispute was sent to the team.' : 'This request is no longer open. Your clearing agent will send a new one if needed.'}</p>
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
