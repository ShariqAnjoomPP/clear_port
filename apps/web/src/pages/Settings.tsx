import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { STAFF_ROLES } from '@clearport/contracts';
import { api } from '../lib/api';
import { useMaster, type Staff } from '../lib/hooks';
import { useSession, type Company } from '../lib/session';
import { fmtDate, fmtDateTime, humanize } from '../lib/format';
import { L } from '../lib/i18n';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, ProblemAlert, Select, Spinner, Table, Tabs } from '../components/ui';
import type { I18n } from '../components/types';

type Tab = 'company' | 'staff' | 'master' | 'workflow';

export function SettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('company');
  return (
    <>
      <PageHeader title={t('nav.settings')} subtitle="Company details, staff, master data and the clearance workflow." />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'company', label: 'Company' }, { value: 'staff', label: 'Staff' }, { value: 'master', label: 'Master data' }, { value: 'workflow', label: 'Workflow & SLAs' }]} />
      <div className="mt-4">{tab === 'company' ? <CompanyTab /> : tab === 'staff' ? <StaffTab /> : tab === 'master' ? <Master /> : <Workflow />}</div>
    </>
  );
}

function CompanyTab() {
  const qc = useQueryClient();
  const session = useSession();
  const [f, setF] = useState<Company | null>(null);
  useEffect(() => {
    if (session.data && !f) setF(session.data.company);
  }, [session.data, f]);
  const save = useMutation({
    mutationFn: (c: Company) => api.put('/settings/company', { ...c, address: c.address ?? '', trn: c.trn ?? '', phone: c.phone ?? '', whatsapp: c.whatsapp ?? '', email: c.email ?? '' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['session'] }),
  });
  if (!f) return <Spinner />;
  return (
    <Card title="Company" actions={<Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate(f)}>Save</Button>}>
      <div className="grid grid-cols-1 max-w-2xl gap-3 sm:grid-cols-2">
        <Field label="Company name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="TRN (VAT number)"><Input value={f.trn ?? ''} onChange={(e) => setF({ ...f, trn: e.target.value })} /></Field>
        <Field label="Base currency"><Input value={f.baseCurrency} maxLength={3} onChange={(e) => setF({ ...f, baseCurrency: e.target.value.toUpperCase() })} /></Field>
        <Field label="Time zone"><Input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
        <Field label="VAT %"><Input type="number" min={0} max={30} step="0.01" value={f.vatPct} onChange={(e) => setF({ ...f, vatPct: e.target.value })} /></Field>
        <p className="pt-2 text-sm font-semibold sm:col-span-2">How customers reach you <span className="block text-xs font-normal text-on-surface-variant">Shown as WhatsApp, call and email buttons on the customer tracking page (/track).</span></p>
        <Field label="WhatsApp number"><Input type="tel" inputMode="tel" value={f.whatsapp ?? ''} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} placeholder="+968 9xxx xxxx" /></Field>
        <Field label="Phone"><Input type="tel" inputMode="tel" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email" className="sm:col-span-2"><Input type="email" inputMode="email" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <label className="flex items-start gap-3 rounded-2xl bg-surface-container-low p-3 sm:col-span-2">
          <input type="checkbox" className="mt-0.5 size-5 accent-[var(--color-primary)]" checked={f.assignSteps} onChange={(e) => setF({ ...f, assignSteps: e.target.checked })} />
          <span>
            <span className="block text-sm font-medium">Assign staff to each step</span>
            <span className="block text-xs text-on-surface-variant">For teams: each step (Bayan, DO, port release, inspection…) gets a responsible person, and filing the Bayan or applying for the DO or port release waits until someone is assigned. Leave off if one person does everything.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-2xl bg-surface-container-low p-3 sm:col-span-2">
          <input type="checkbox" className="mt-0.5 size-5 accent-[var(--color-primary)]" checked={f.sequentialSteps} onChange={(e) => setF({ ...f, sequentialSteps: e.target.checked })} />
          <span>
            <span className="block text-sm font-medium">Steps one by one</span>
            <span className="block text-xs text-on-surface-variant">Each step starts only after the previous one is complete: Documents → Bayan → Customer → Inspection → DO → Port release → Delivery. Turn off to work on the DO while customs is still in progress.</span>
          </span>
        </label>
      </div>
      <div className="mt-3"><ProblemAlert error={save.error} /></div>
      {save.isSuccess && <p className="mt-2 text-sm text-ok">Saved.</p>}
    </Card>
  );
}

const emptyStaff = { name: '', role: 'PRO', phone: '', email: '', licenceNo: '', licenceExpiry: '', transporter: '' };

function StaffTab() {
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: ['staff', 'with-inactive'], queryFn: () => api.get<{ items: Staff[] }>('/settings/staff?all=1').then((r) => r.items) });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(emptyStaff);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['staff'] });
  const save = useMutation({
    mutationFn: () => api.post('/settings/staff', { ...f, licenceExpiry: f.licenceExpiry || undefined }),
    onSuccess: () => { setOpen(false); setF(emptyStaff); refresh(); },
  });
  const toggle = useMutation({ mutationFn: (s: Staff) => api.patch(`/settings/staff/${s.id}`, { active: !s.active }), onSuccess: refresh });
  return (
    <Card padded={false} title="Staff" actions={<Button size="sm" variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" /> Add staff</Button>}>
      <p className="px-4 pt-3 text-sm text-muted">The people who do the work. Assign them to stages and trips. They don't log in to the prototype.</p>
      {staff.isLoading ? <Spinner /> : (
        <Table>
          <thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Licence</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(staff.data ?? []).map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.name}</td>
                <td><Badge tone="brand">{humanize(s.role)}</Badge></td>
                <td className="text-muted">{s.phone ?? '—'}</td>
                <td className="text-muted">{s.licenceNo ? `${s.licenceNo} · exp. ${fmtDate(s.licenceExpiry)}` : '—'}</td>
                <td><Badge tone={s.active ? 'ok' : 'neutral'}>{s.active ? 'active' : 'inactive'}</Badge></td>
                <td className="text-end"><Button size="sm" variant="ghost" onClick={() => toggle.mutate(s)}>{s.active ? 'Deactivate' : 'Activate'}</Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add staff" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Create</Button></>}>
        <div className="grid gap-3">
          <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{STAFF_ROLES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</Select></Field>
          <Field label="Mobile"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          {f.role === 'DRIVER' && (
            <>
              <Field label="Licence no."><Input value={f.licenceNo} onChange={(e) => setF({ ...f, licenceNo: e.target.value })} /></Field>
              <Field label="Licence expiry"><Input type="date" value={f.licenceExpiry} onChange={(e) => setF({ ...f, licenceExpiry: e.target.value })} /></Field>
              <Field label="Transporter"><Input value={f.transporter} onChange={(e) => setF({ ...f, transporter: e.target.value })} /></Field>
            </>
          )}
          <ProblemAlert error={save.error} />
        </div>
      </Modal>
    </Card>
  );
}

function Master() {
  const qc = useQueryClient();
  const items = useMaster();
  const [f, setF] = useState({ kind: 'FEE_TYPE', code: '', name: '' });
  const add = useMutation({ mutationFn: () => api.post('/settings/master-data', f), onSuccess: () => { setF({ ...f, code: '', name: '' }); void qc.invalidateQueries({ queryKey: ['master'] }); } });
  const archive = useMutation({ mutationFn: (id: string) => api.del(`/settings/master-data/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['master'] }) });
  const kinds = ['PORT', 'TERMINAL', 'SHIPPING_LINE', 'FEE_TYPE'];
  return (
    <div className="space-y-4">
      <Card title="Add item">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_160px_1fr_auto]">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{kinds.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</Select>
          <Input placeholder="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          <Input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Button variant="primary" disabled={!f.code || !f.name} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
        </div>
        <div className="mt-2"><ProblemAlert error={add.error} /></div>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {kinds.map((k) => (
          <Card key={k} title={humanize(k)} padded={false}>
            <Table>
              <tbody>{(items.data ?? []).filter((i) => i.kind === k).map((i) => <tr key={i.id}><td className="w-32 font-mono">{i.code}</td><td>{i.name}</td><td className="text-end"><button className="text-muted hover:text-bad" onClick={() => archive.mutate(i.id)} aria-label="Archive"><Trash2 className="size-4" /></button></td></tr>)}</tbody>
            </Table>
          </Card>
        ))}
      </div>
    </div>
  );
}

type Stage = { key: string; level: string; order: number; label: I18n; slaHours?: number; ownerRole: string; statuses: { key: string; label: I18n; done?: boolean }[]; transitions: { from: string[]; to: string; guard?: unknown }[] };
function Workflow() {
  const qc = useQueryClient();
  const wf = useQuery({ queryKey: ['workflow'], queryFn: () => api.get<{ active: { version: number; stages: Stage[] }; versions: { version: number; active: boolean; createdAt: string }[] }>('/workflow/definition') });
  const [sla, setSla] = useState<Record<string, number>>({});
  const publish = useMutation({ mutationFn: () => api.put('/workflow/definition/sla', { sla }), onSuccess: () => { setSla({}); void qc.invalidateQueries({ queryKey: ['workflow'] }); } });
  if (wf.isLoading || !wf.data) return <Spinner />;
  return (
    <div className="space-y-4">
      <Card title={`Active workflow — version ${wf.data.active.version}`} actions={<Button size="sm" variant="primary" disabled={!Object.keys(sla).length} loading={publish.isPending} onClick={() => publish.mutate()}>Publish as v{wf.data.active.version + 1}</Button>} padded={false}>
        <p className="px-4 pt-3 text-sm text-muted">The workflow is stored in the database. Changing SLA hours publishes a new version: running jobs keep the version they started with, new jobs use the new one.</p>
        <Table>
          <thead><tr><th>#</th><th>Stage</th><th>Level</th><th>Owner</th><th>Statuses</th><th>Gated</th><th>SLA (hours)</th></tr></thead>
          <tbody>
            {[...wf.data.active.stages].sort((a, b) => a.order - b.order).map((s) => (
              <tr key={s.key}>
                <td className="text-muted">{s.order}</td>
                <td className="font-medium">{L(s.label)}</td>
                <td><Badge>{s.level.toLowerCase()}</Badge></td>
                <td className="text-muted">{humanize(s.ownerRole)}</td>
                <td className="text-xs">{s.statuses.map((x) => <span key={x.key} className={`me-1 ${x.done ? 'text-ok' : 'text-muted'}`}>{L(x.label)}{x.done ? ' ✓' : ''} ·</span>)}</td>
                <td>{s.transitions.some((t) => t.guard) ? <Badge tone="warn">yes</Badge> : '—'}</td>
                <td><Input type="number" min={1} className="h-8 w-24" value={sla[s.key] ?? s.slaHours ?? ''} onChange={(e) => setSla({ ...sla, [s.key]: Number(e.target.value) })} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="p-3"><ProblemAlert error={publish.error} /></div>
      </Card>
      <Card title="Version history" padded={false}>
        <Table><tbody>{wf.data.versions.map((v) => <tr key={v.version}><td>v{v.version}</td><td className="text-muted">{fmtDateTime(v.createdAt)}</td><td>{v.active && <Badge tone="ok">active</Badge>}</td></tr>)}</tbody></Table>
      </Card>
    </div>
  );
}
