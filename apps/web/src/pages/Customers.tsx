import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useCustomers } from '../lib/hooks';
import { Avatar, Badge, Button, Empty, Field, Input, ListCard, ListItem, Modal, ProblemAlert, SearchBar, Select, Skeleton, Spinner } from '../components/ui';
import { currencyCode } from '../lib/format';

type Contact = { id?: string; name: string; email?: string; phone?: string; role?: string; whatsappOptIn: boolean };
export type CustomerFull = {
  id: string; name: string; tradeLicenceNo: string | null; customsCode: string | null; address: string | null; preferredChannel: string; language: string;
  creditLimit: string | null; creditDays: number; tariff: { currency: string; perBl: string; perContainer: string; vatPct: number; markupPct: number } | null; contacts: Contact[]; portalUrl: string | null;
  stats: { open_jobs: number; containers_in_progress: number; outstanding: string | null; avg_days: string | null };
};

/** Customers are added in "Create job"; this list is for finding them, seeing their jobs and editing details. */
export function CustomersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const list = useCustomers(q.trim());
  return (
    <>
      <h1 className="mt-2 mb-3 text-2xl font-semibold tracking-tight">Customers</h1>
      <SearchBar value={q} onChange={setQ} placeholder="Search name, phone, email, customs code…" />
      <div className="mt-3">
        {list.isLoading ? <Skeleton className="h-64" /> : !list.data?.length ? (
          <ListCard>
            <Empty icon={<Users className="size-7" />} title={q ? 'No customer found' : 'No customers yet'} action={!q ? <Button variant="primary" onClick={() => void navigate({ to: '/jobs/new', search: {} })}><Plus className="size-4" /> Create job</Button> : undefined}>
              {q ? 'Try a name, phone number or email.' : 'Customers are added when you create a job.'}
            </Empty>
          </ListCard>
        ) : (
          <ListCard>
            {list.data.map((c) => (
              <ListItem
                key={c.id}
                leading={<Avatar name={c.name} />}
                title={c.name}
                subtitle={[c.contacts[0]?.name, c.contacts[0]?.phone].filter(Boolean).join(' · ') || c.customsCode || 'No contact yet'}
                meta={<>
                  {c.openJobs > 0 ? <Badge tone="brand">{c.openJobs} open job{c.openJobs === 1 ? '' : 's'}</Badge> : <Badge>No open jobs</Badge>}
                  <Badge>{c.preferredChannel === 'WHATSAPP' ? 'WhatsApp' : c.preferredChannel === 'EMAIL' ? 'Email' : 'SMS'}</Badge>
                </>}
                onClick={() => void navigate({ to: '/customers/$customerId', params: { customerId: c.id } })}
              />
            ))}
          </ListCard>
        )}
      </div>
    </>
  );
}

export function CustomerModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<CustomerFull>(`/customers/${id}`), enabled: !!id });
  if (id && existing.isLoading) return <Modal open onClose={onClose} title="Customer"><Spinner /></Modal>;
  return <CustomerForm initial={existing.data ?? null} onClose={() => { void qc.invalidateQueries({ queryKey: ['customers'] }); void qc.invalidateQueries({ queryKey: ['customer'] }); onClose(); }} />;
}

function CustomerForm({ initial, onClose }: { initial: CustomerFull | null; onClose: () => void }) {
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
        tariff: { currency: currencyCode(), perBl: f.perBl, perContainer: f.perContainer, vatPct: Number(f.vatPct), markupPct: Number(f.markupPct) },
        contacts: contacts.filter((c) => c.name.trim()),
      };
      return initial ? api.put(`/customers/${initial.id}`, body) : api.post('/customers', body);
    },
    onSuccess: onClose,
  });
  return (
    <Modal open onClose={onClose} wide title={initial ? initial.name : 'New customer'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Customs / importer code"><Input value={f.customsCode} onChange={(e) => set('customsCode', e.target.value)} /></Field>
        <Field label="Trade licence no."><Input value={f.tradeLicenceNo} onChange={(e) => set('tradeLicenceNo', e.target.value)} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Preferred channel"><Select value={f.preferredChannel} onChange={(e) => set('preferredChannel', e.target.value)}><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option><option value="SMS">SMS</option></Select></Field>
        <Field label="Language"><Select value={f.language} onChange={(e) => set('language', e.target.value)}><option value="en">English</option><option value="ar">Arabic</option></Select></Field>
        <Field label={`Credit limit (${currencyCode()})`}><Input inputMode="decimal" value={f.creditLimit} onChange={(e) => set('creditLimit', e.target.value)} /></Field>
        <Field label="Credit days"><Input inputMode="numeric" value={f.creditDays} onChange={(e) => set('creditDays', e.target.value)} /></Field>
        <p className="pt-2 text-sm font-semibold sm:col-span-2">Tariff ({currencyCode()})</p>
        <Field label="Service fee per BL"><Input inputMode="decimal" value={f.perBl} onChange={(e) => set('perBl', e.target.value)} /></Field>
        <Field label="Fee per container"><Input inputMode="decimal" value={f.perContainer} onChange={(e) => set('perContainer', e.target.value)} /></Field>
        <Field label="VAT % on service"><Input inputMode="decimal" value={f.vatPct} onChange={(e) => set('vatPct', e.target.value)} /></Field>
        <Field label="Markup % on disbursements"><Input inputMode="decimal" value={f.markupPct} onChange={(e) => set('markupPct', e.target.value)} /></Field>
        <div className="flex items-center justify-between pt-2 sm:col-span-2">
          <p className="text-sm font-semibold">Contacts</p>
          <Button size="sm" variant="ghost" onClick={() => setContacts((c) => [...c, { name: '', whatsappOptIn: false }])}><Plus className="size-4" /> Add</Button>
        </div>
        {contacts.map((c, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-line p-2 sm:col-span-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
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

/** The customer's own no-login portal link: share it with them, or replace it if it was sent to the wrong person. */
export function PortalLink({ customerId, url: initialUrl }: { customerId: string; url: string | null }) {
  const [url, setUrl] = useState(initialUrl);
  const renew = useMutation({ mutationFn: () => api.post<{ url: string }>(`/customers/${customerId}/portal-link`), onSuccess: (r) => setUrl(r.url) });
  return (
    <div className="mb-4 rounded-lg border border-line bg-canvas p-3">
      <p className="text-sm font-medium">Customer portal link</p>
      <p className="text-xs text-muted">The customer sees their shipments, shared documents, invoices and charges to approve. No login needed.</p>
      {url && (
        <div className="mt-2 space-y-2">
          <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Portal link" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="tonal" onClick={() => void navigator.clipboard.writeText(url)}><Copy className="size-4" /> Copy</Button>
            <a href={url} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink className="size-4" /> Open</Button></a>
            <Button size="sm" variant="ghost" loading={renew.isPending} onClick={() => renew.mutate()}><RefreshCw className="size-4" /> New link</Button>
          </div>
        </div>
      )}
      <ProblemAlert error={renew.error} />
    </div>
  );
}
