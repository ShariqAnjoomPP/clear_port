import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Paperclip, Plus, Trash2 } from 'lucide-react';
import { api, uploadDocument } from '../lib/api';
import { useMaster, useStaff } from '../lib/hooks';
import { L } from '../lib/i18n';
import { SignaturePad } from './SignaturePad';
import { Button, Field, Input, Modal, ProblemAlert, Select, Textarea } from './ui';
import type { JobDetail, NextStep, StageView } from './types';
import { currencyCode } from '../lib/format';
import { PackPicker } from './DocPack';

type PaymentRow = { feeType: string; amount: string; paymentMethod: string; paidById: string; billable: boolean; receipt?: File };
/** Stages where fees are usually paid (Bayan duty, DO line charges, inspection and CCRO fees, terminal charges at release). */
const PAYABLE = ['BAYAN', 'DO', 'CCRO', 'INSPECTION', 'RELEASE'];

/**
 * Generic stage form driven by the workflow definition: shows the fields this step needs (required ones marked),
 * optional payments made at this step (with receipt photos), and remarks. The server re-checks every rule.
 */
export function TransitionDialog({
  jobId, stage, step, containers, onClose, onDone,
}: {
  jobId: string; stage: Pick<StageView, 'id' | 'key' | 'label' | 'fields' | 'data'> & { assignee?: { id: string } | null }; step: NextStep;
  containers?: { id: string; containerNo: string }[]; onClose: () => void; onDone: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...stage.data }));
  const [remarks, setRemarks] = useState('');
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const fees = useMaster('FEE_TYPE');
  const staff = useStaff();
  const canPay = PAYABLE.includes(stage.key);
  const setPay = (i: number, patch: Partial<PaymentRow>) => setPayments((rows) => rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const required = new Set(step.requiredFields);
  // Show what this step needs: its required fields, free-text notes, and the reference number until one is recorded.
  const fields = stage.fields.filter((f) => required.has(f.key) || f.type === 'textarea' || (f.key === 'referenceNo' && !stage.data.referenceNo));
  const hasStageRemarks = fields.some((f) => f.key === 'remarks');
  // Opened from the task list there is no container list at hand: load the job's containers when a step needs them.
  const needsContainers = !containers && fields.some((f) => f.type === 'containers');
  const loaded = useQuery({ queryKey: ['job', jobId], queryFn: () => api.get<JobDetail>(`/jobs/${jobId}`), enabled: needsContainers || !!step.requiresDocument });
  const containerOptions = containers ?? loaded.data?.containers ?? [];
  // A step that needs a document (e.g. "Verify documents" needs the B/L) lets you attach it right here.
  const docName = step.requiresDocument?.replace(/_/g, ' ').toLowerCase();
  const docMissing = !!step.requiresDocument && !!loaded.data && !loaded.data.documents.some((d) => d.docType === step.requiresDocument || d.covers?.includes(step.requiresDocument!));
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docCovers, setDocCovers] = useState<string[]>([]);

  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));

  async function submit() {
    if (docMissing && !docFile) {
      setError(new Error(`Attach the ${docName} to continue`));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (docMissing && docFile) await uploadDocument(jobId, docFile, step.requiresDocument!, { customerVisible: step.requiresDocument === 'BILL_OF_LADING', stageInstanceId: stage.id, covers: docCovers });
      const disbursements = [];
      for (const p of payments) {
        if (!p.amount) continue;
        const receiptDocumentId = p.receipt ? (await uploadDocument(jobId, p.receipt, 'RECEIPT', { stageInstanceId: stage.id })).id : undefined;
        disbursements.push({
          feeType: p.feeType, amount: p.amount, currency: currencyCode(), paymentMethod: p.paymentMethod, paidOn: new Date().toISOString().slice(0, 10),
          paidById: p.paidById || undefined, billable: p.billable, receiptDocumentId, markupPct: 0,
        });
      }
      const fieldsToSend = Object.fromEntries(fields.map((f) => [f.key, values[f.key]]).filter(([, v]) => v !== undefined && v !== ''));
      await api.post(`/workflow/jobs/${jobId}/stages/${stage.id}/transitions`, {
        to: step.to,
        fields: fieldsToSend,
        remarks: (remarks || (values.remarks as string | undefined)) || undefined,
        disbursements,
      });
      onDone();
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
            {f.type === 'datetime' && <Input type="datetime-local" value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} />}
            {f.type === 'textarea' && <Textarea value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} />}
            {f.type === 'signature' && <SignaturePad value={values[f.key] as string | undefined} onChange={(v) => set(f.key, v)} />}
            {f.type === 'containers' && (
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-line p-2">
                {containerOptions.map((c) => {
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

        {docMissing && (
          <Field label={`${docName!.replace(/^\w/, (c) => c.toUpperCase())} (required for this step)`} required>
            <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-outline-variant px-4 py-3 text-sm text-on-surface-variant hover:border-primary">
              <Paperclip className="size-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{docFile ? docFile.name : 'Take a photo or choose a PDF'}</span>
              <input type="file" accept="application/pdf,image/*" capture="environment" className="hidden" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
            </label>
            {docFile && step.requiresDocument === 'BILL_OF_LADING' && <div className="mt-3"><PackPicker main="BILL_OF_LADING" value={docCovers} onChange={setDocCovers} /></div>}
          </Field>
        )}

        {canPay && (
          <div className="rounded-lg border border-line">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <p className="text-sm font-medium">Amounts paid at this step</p>
              <Button size="sm" variant="ghost" onClick={() => setPayments((p) => [...p, { feeType: fees.data?.[0]?.code ?? 'OTHER', amount: '', paymentMethod: 'CASH_FLOAT', paidById: stage.assignee?.id ?? '', billable: true }])}>
                <Plus className="size-4" /> Add payment
              </Button>
            </div>
            {payments.length === 0 && <p className="px-3 py-3 text-xs text-muted">Record duty, fees or charges paid now so they are billed back to the customer.</p>}
            {payments.map((p, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 border-b border-line p-3 last:border-0 sm:grid-cols-[1.3fr_1fr_1fr_1.1fr_auto]">
                <Select value={p.feeType} onChange={(e) => setPay(i, { feeType: e.target.value })} aria-label="Fee type">
                  {(fees.data ?? []).map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
                </Select>
                <Input inputMode="decimal" placeholder={`Amount (${currencyCode()})`} aria-label="Amount" value={p.amount} onChange={(e) => setPay(i, { amount: e.target.value })} />
                <Select value={p.paymentMethod} onChange={(e) => setPay(i, { paymentMethod: e.target.value })} aria-label="Payment method">
                  <option value="CASH_FLOAT">PRO float (cash)</option>
                  <option value="COMPANY_CARD">Company card</option>
                  <option value="BANK_TRANSFER">Bank transfer</option>
                  <option value="ONLINE">Online</option>
                </Select>
                <Select value={p.paidById} onChange={(e) => setPay(i, { paidById: e.target.value })} aria-label="Paid by">
                  <option value="">Paid by: me</option>
                  {(staff.data ?? []).filter((x) => x.role === 'PRO' || x.role === 'COORDINATOR' || x.role === 'ACCOUNTS').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
                <div className="flex items-center gap-1">
                  <label className="flex items-center gap-1 text-xs text-muted" title="Bill this amount to the customer">
                    <input type="checkbox" checked={p.billable} onChange={(e) => setPay(i, { billable: e.target.checked })} /> Bill
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-brand-2 hover:bg-brand-soft" title="Attach receipt photo">
                    <Paperclip className="size-4" />
                    {p.receipt ? '✓' : ''}
                    <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => setPay(i, { receipt: e.target.files?.[0] })} />
                  </label>
                  <button className="rounded p-1 text-muted hover:text-bad" aria-label="Remove payment" onClick={() => setPayments((rows) => rows.filter((_, j) => j !== i))}>
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
        <ProblemAlert error={error} />
      </div>
    </Modal>
  );
}
