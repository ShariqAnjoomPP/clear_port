import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip, Plus, Trash2 } from 'lucide-react';
import { api, uploadDocument } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useMaster } from '../lib/hooks';
import { L } from '../lib/i18n';
import { sendOrQueue } from '../lib/offline';
import { SignaturePad } from './SignaturePad';
import { Button, Field, Input, Modal, ProblemAlert, Select, Textarea } from './ui';
import type { NextStep, StageView } from './types';

type PaymentRow = { feeType: string; amount: string; paymentMethod: string; billable: boolean; receipt?: File; receiptDocumentId?: string };
const PAYABLE = ['BAYAN', 'DO', 'CCRO', 'INSPECTION'];

/**
 * Generic stage form driven by the workflow catalogue: shows the stage's fields (required ones marked),
 * optional payments with receipt photos, and remarks. Field users can submit offline (queued with an idempotency key).
 */
export function TransitionDialog({
  jobId, stage, step, containers, onClose, onDone, offline = false,
}: {
  jobId: string; stage: Pick<StageView, 'id' | 'key' | 'label' | 'fields' | 'data' | 'version'>; step: NextStep;
  containers?: { id: string; containerNo: string }[]; onClose: () => void; onDone: (queued: boolean) => void; offline?: boolean;
}) {
  const { t } = useTranslation();
  const { can, user } = useAuth();
  const fees = useMaster('FEE_TYPE');
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...stage.data }));
  const [remarks, setRemarks] = useState('');
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const required = new Set(step.requiredFields);
  // Show what this step needs: its required fields, free-text notes, and the reference number until one is recorded.
  const fields = stage.fields.filter((f) => required.has(f.key) || f.type === 'textarea' || (f.key === 'referenceNo' && !stage.data.referenceNo));
  const hasStageRemarks = fields.some((f) => f.key === 'remarks');
  const canPay = can('disbursement.create') && PAYABLE.includes(stage.key);

  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const disbursements = [];
      for (const p of payments) {
        if (!p.amount) continue;
        let receiptDocumentId = p.receiptDocumentId;
        if (p.receipt && !receiptDocumentId) receiptDocumentId = (await uploadDocument(jobId, p.receipt, 'RECEIPT', { stageInstanceId: stage.id })).id;
        disbursements.push({ feeType: p.feeType, amount: p.amount, currency: 'AED', paymentMethod: p.paymentMethod, paidOn: new Date().toISOString().slice(0, 10), billable: p.billable, receiptDocumentId, markupPct: 0 });
      }
      const fieldsToSend = Object.fromEntries(fields.map((f) => [f.key, values[f.key]]).filter(([, v]) => v !== undefined && v !== ''));
      const body = { to: step.to, fields: fieldsToSend, remarks: (remarks || (values.remarks as string | undefined)) || undefined, disbursements, clientOccurredAt: new Date().toISOString() };
      const path = `/v1/workflow/jobs/${jobId}/stages/${stage.id}/transitions`;
      if (offline) {
        const r = await sendOrQueue('POST', path, body, `${L(stage.label)} → ${L(step.label)}`);
        onDone(r.queued);
      } else {
        await api.post(path, body, { ifMatch: stage.version });
        onDone(false);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${L(stage.label)}: ${L(step.label)}`}
      wide={payments.length > 0}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={busy} onClick={submit}>{L(step.label)}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {fields.map((f) => (
          <Field key={f.key} label={L(f.label)} required={required.has(f.key)}>
            {f.type === 'text' && <Input value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} />}
            {f.type === 'date' && <Input type="date" value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} />}
            {f.type === 'textarea' && <Textarea value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} />}
            {f.type === 'signature' && <SignaturePad value={values[f.key] as string | undefined} onChange={(v) => set(f.key, v)} />}
            {f.type === 'containers' && (
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-line p-2">
                {(containers ?? []).map((c) => {
                  const selected = ((values[f.key] as string[] | undefined) ?? []).includes(c.id);
                  return (
                    <label key={c.id} className="flex items-center gap-2 text-sm font-mono">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) => {
                          const cur = (values[f.key] as string[] | undefined) ?? [];
                          set(f.key, e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id));
                        }}
                      />
                      {c.containerNo}
                    </label>
                  );
                })}
              </div>
            )}
          </Field>
        ))}

        {canPay && !offline && (
          <div className="rounded-lg border border-line">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <p className="text-sm font-medium">Amounts paid at this step</p>
              <Button size="sm" variant="ghost" onClick={() => setPayments((p) => [...p, { feeType: fees.data?.[0]?.code ?? 'OTHER', amount: '', paymentMethod: 'CASH_FLOAT', billable: true }])}>
                <Plus className="size-4" /> Add payment
              </Button>
            </div>
            {payments.length === 0 && <p className="px-3 py-3 text-xs text-muted">Record duty, fees or charges paid now so they are billed back to the customer.</p>}
            {payments.map((p, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 border-b border-line p-3 last:border-0 sm:grid-cols-[1.4fr_1fr_1fr_auto_auto]">
                <Select value={p.feeType} onChange={(e) => setPayments((s) => s.map((x, j) => (j === i ? { ...x, feeType: e.target.value } : x)))} aria-label="Fee type">
                  {(fees.data ?? []).map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
                </Select>
                <Input inputMode="decimal" placeholder="Amount (AED)" value={p.amount} onChange={(e) => setPayments((s) => s.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <Select value={p.paymentMethod} onChange={(e) => setPayments((s) => s.map((x, j) => (j === i ? { ...x, paymentMethod: e.target.value } : x)))} aria-label="Payment method">
                  <option value="CASH_FLOAT">PRO float (cash)</option>
                  <option value="COMPANY_CARD">Company card</option>
                  <option value="BANK_TRANSFER">Bank transfer</option>
                  <option value="ONLINE">Online</option>
                </Select>
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input type="checkbox" checked={p.billable} onChange={(e) => setPayments((s) => s.map((x, j) => (j === i ? { ...x, billable: e.target.checked } : x)))} /> Bill customer
                </label>
                <div className="flex items-center gap-1">
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-brand-2 hover:bg-brand-soft" title="Attach receipt photo">
                    <Paperclip className="size-4" />
                    {p.receipt ? 'Receipt ✓' : 'Receipt'}
                    <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => setPayments((s) => s.map((x, j) => (j === i ? { ...x, receipt: e.target.files?.[0] } : x)))} />
                  </label>
                  <button className="rounded p-1 text-muted hover:text-bad" aria-label="Remove payment" onClick={() => setPayments((s) => s.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!hasStageRemarks && (
          <Field label={t('common.remarks')}>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional note for the timeline" />
          </Field>
        )}
        {offline && !navigator.onLine && <p className="text-xs text-warn">You are offline. This update will be saved on the device and sent automatically when you reconnect.</p>}
        <ProblemAlert error={error} />
        <p className="text-xs text-muted">Recorded as {user?.name}.</p>
      </div>
    </Modal>
  );
}
