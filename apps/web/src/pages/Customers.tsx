import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCustomers } from '../lib/hooks';
import { fmtMoney } from '../lib/format';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, ProblemAlert, Select, Spinner, Stat, Table } from '../components/ui';

type Contact = { id?: string; name: string; email?: string; phone?: string; role?: string; whatsappOptIn: boolean };
type CustomerFull = {
  id: string; name: string; tradeLicenceNo: string | null; customsCode: string | null; address: string | null; preferredChannel: string; language: string;
  creditLimit: string | null; creditDays: number; tariff: { currency: string; perBl: string; perContainer: string; vatPct: number; markupPct: number } | null; contacts: Contact[]; version: number;
  stats: { open_jobs: number; containers_in_progress: number; outstanding: string | null; avg_days: string | null };
};

export function CustomersPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const list = useCustomers(q);
  return (
    <>
      <PageHeader title={t('nav.customers')} subtitle="Importers you clear for, with their tariff, credit terms and contacts." actions={<><Input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />{can('customer.manage') && <Button variant="primary" onClick={() => setEditing('new')}><Plus className="size-4" /> New customer</Button>}</>} />
      <Card padded={false}>
        {list.isLoading ? <Spinner /> : (
          <Table>
            <thead><tr><th>Name</th><th>Customs code</th><th>Channel</th><th>Tariff</th><th>Credit</th><th>Open jobs</th></tr></thead>
            <tbody>
              {(list.data ?? []).map((c) => (
                <tr key={c.id} className="cursor-pointer" onClick={() => setEditing(c.id)}>
                  <td className="font-medium">{c.name}</td>
                  <td className="font-mono text-muted">{c.customsCode ?? '—'}</td>
                  <td><Badge tone={c.preferredChannel === 'WHATSAPP' ? 'ok' : 'neutral'}>{c.preferredChannel.toLowerCase()}</Badge></td>
                  <td className="text-muted">{c.tariff ? `${fmtMoney(c.tariff.perBl, c.tariff.currency)} / BL + ${fmtMoney(c.tariff.perContainer, c.tariff.currency)} / ctr` : '—'}</td>
                  <td className="text-muted">{c.creditLimit ? fmtMoney(c.creditLimit) : '—'} · {c.creditDays}d</td>
                  <td className="tabular">{c.openJobs}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <CustomerModal id={editing === 'new' ? null : editing} onClose={() => setEditing(null)} readOnly={!can('customer.manage')} />}
    </>
  );
}

function CustomerModal({ id, onClose, readOnly }: { id: string | null; onClose: () => void; readOnly: boolean }) {
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<CustomerFull>(`/v1/customers/${id}`), enabled: !!id });
  if (id && existing.isLoading) return <Modal open onClose={onClose} title="Customer"><Spinner /></Modal>;
  return <CustomerForm initial={existing.data ?? null} onClose={() => { void qc.invalidateQueries({ queryKey: ['customers'] }); onClose(); }} readOnly={readOnly} />;
}

function CustomerForm({ initial, onClose, readOnly }: { initial: CustomerFull | null; onClose: () => void; readOnly: boolean }) {
  const [f, setF] = useState({
    name: initial?.name ?? '', tradeLicenceNo: initial?.tradeLicenceNo ?? '', customsCode: initial?.customsCode ?? '', address: initial?.address ?? '',
    preferredChannel: initial?.preferredChannel ?? 'WHATSAPP', language: initial?.language ?? 'en', creditLimit: initial?.creditLimit ?? '', creditDays: String(initial?.creditDays ?? 30),
    perBl: initial?.tariff?.perBl ?? '750.000', perContainer: initial?.tariff?.perContainer ?? '150.000', vatPct: String(initial?.tariff?.vatPct ?? 5), markupPct: String(initial?.tariff?.markupPct ?? 0),
  });
  const [contacts, setContacts] = useState<Contact[]>(initial?.contacts ?? [{ name: '', email: '', phone: '', role: '', whatsappOptIn: false }]);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name, tradeLicenceNo: f.tradeLicenceNo, customsCode: f.customsCode, address: f.address, preferredChannel: f.preferredChannel, language: f.language,
        creditLimit: f.creditLimit || undefined, creditDays: Number(f.creditDays),
        tariff: { currency: 'AED', perBl: f.perBl, perContainer: f.perContainer, vatPct: Number(f.vatPct), markupPct: Number(f.markupPct) },
        contacts: contacts.filter((c) => c.name.trim()),
      };
      return initial ? api.put(`/v1/customers/${initial.id}`, body, { ifMatch: initial.version }) : api.post('/v1/customers', body);
    },
    onSuccess: onClose,
  });
  return (
    <Modal open onClose={onClose} wide title={initial ? initial.name : 'New customer'} footer={!readOnly && <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      {initial && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Open jobs" value={initial.stats.open_jobs} />
          <Stat label="Containers" value={initial.stats.containers_in_progress} />
          <Stat label="Outstanding" value={fmtMoney(initial.stats.outstanding ?? 0)} />
          <Stat label="Avg. days to close" value={initial.stats.avg_days ? Number(initial.stats.avg_days).toFixed(1) : '—'} />
        </div>
      )}
      <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Customs / importer code"><Input value={f.customsCode} onChange={(e) => set('customsCode', e.target.value)} /></Field>
        <Field label="Trade licence no."><Input value={f.tradeLicenceNo} onChange={(e) => set('tradeLicenceNo', e.target.value)} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Preferred channel"><Select value={f.preferredChannel} onChange={(e) => set('preferredChannel', e.target.value)}><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option><option value="SMS">SMS</option></Select></Field>
        <Field label="Language"><Select value={f.language} onChange={(e) => set('language', e.target.value)}><option value="en">English</option><option value="ar">Arabic</option></Select></Field>
        <Field label="Credit limit (AED)"><Input inputMode="decimal" value={f.creditLimit} onChange={(e) => set('creditLimit', e.target.value)} /></Field>
        <Field label="Credit days"><Input inputMode="numeric" value={f.creditDays} onChange={(e) => set('creditDays', e.target.value)} /></Field>
        <p className="pt-2 text-sm font-semibold sm:col-span-2">Tariff (AED)</p>
        <Field label="Service fee per BL"><Input inputMode="decimal" value={f.perBl} onChange={(e) => set('perBl', e.target.value)} /></Field>
        <Field label="Fee per container"><Input inputMode="decimal" value={f.perContainer} onChange={(e) => set('perContainer', e.target.value)} /></Field>
        <Field label="VAT % on service"><Input inputMode="decimal" value={f.vatPct} onChange={(e) => set('vatPct', e.target.value)} /></Field>
        <Field label="Markup % on disbursements"><Input inputMode="decimal" value={f.markupPct} onChange={(e) => set('markupPct', e.target.value)} /></Field>
        <div className="flex items-center justify-between pt-2 sm:col-span-2">
          <p className="text-sm font-semibold">Contacts</p>
          <Button size="sm" variant="ghost" onClick={() => setContacts((c) => [...c, { name: '', whatsappOptIn: false }])}><Plus className="size-4" /> Add</Button>
        </div>
        {contacts.map((c, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-line p-2 sm:col-span-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
            <Input placeholder="Name" value={c.name} onChange={(e) => setContacts((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <Input placeholder="Email" value={c.email ?? ''} onChange={(e) => setContacts((s) => s.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
            <Input placeholder="Mobile" value={c.phone ?? ''} onChange={(e) => setContacts((s) => s.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
            <label className="flex items-center gap-1 text-xs text-muted" title="Consent to receive WhatsApp updates"><input type="checkbox" checked={c.whatsappOptIn} onChange={(e) => setContacts((s) => s.map((x, j) => (j === i ? { ...x, whatsappOptIn: e.target.checked } : x)))} /> WhatsApp opt-in</label>
            <button className="text-muted hover:text-bad" aria-label="Remove contact" onClick={() => setContacts((s) => s.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
          </div>
        ))}
      </fieldset>
      <div className="mt-3"><ProblemAlert error={save.error} /></div>
    </Modal>
  );
}
