import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { ROLES } from '@clearport/kernel';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCustomers, useMaster, useUsers } from '../lib/hooks';
import { fmtDateTime } from '../lib/format';
import { L } from '../lib/i18n';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, ProblemAlert, Select, Spinner, Table, Tabs } from '../components/ui';
import type { I18n } from '../components/types';

export function SettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'users' | 'master' | 'workflow'>('users');
  return (
    <>
      <PageHeader title={t('nav.settings')} subtitle="Users and roles, master data, and the clearance workflow." />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'users', label: 'Users & roles' }, { value: 'master', label: 'Master data' }, { value: 'workflow', label: 'Workflow & SLAs' }]} />
      <div className="mt-4">{tab === 'users' ? <Users /> : tab === 'master' ? <Master /> : <Workflow />}</div>
    </>
  );
}

function Users() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const users = useUsers();
  const customers = useCustomers();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', phone: '', role: 'COORDINATOR', customerId: '' });
  const save = useMutation({
    mutationFn: () => api.post('/v1/platform/admin/users', { name: f.name, email: f.email, phone: f.phone || undefined, roles: [f.role], customerId: f.role === 'CUSTOMER' ? f.customerId : undefined }),
    onSuccess: () => { setOpen(false); void qc.invalidateQueries({ queryKey: ['users'] }); },
  });
  const toggle = useMutation({ mutationFn: (u: { id: string; active: boolean }) => api.patch(`/v1/platform/admin/users/${u.id}`, { active: !u.active }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }) });
  return (
    <Card padded={false} title="Users" actions={can('admin.users') && <Button size="sm" variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" /> Add user</Button>}>
      <Table>
        <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th /></tr></thead>
        <tbody>
          {(users.data ?? []).map((u) => (
            <tr key={u.id}>
              <td className="font-medium">{u.name}</td><td className="text-muted">{u.email}</td>
              <td>{u.roles.map((r) => <Badge key={r} tone="brand" className="me-1">{r.toLowerCase()}</Badge>)}</td>
              <td><Badge tone={u.active ? 'ok' : 'neutral'}>{u.active ? 'active' : 'disabled'}</Badge></td>
              <td className="text-end">{can('admin.users') && <Button size="sm" variant="ghost" onClick={() => toggle.mutate(u)}>{u.active ? 'Disable' : 'Enable'}</Button>}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Modal open={open} onClose={() => setOpen(false)} title="Add user" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Create</Button></>}>
        <div className="grid gap-3">
          <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email" required><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Mobile"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}</Select></Field>
          {f.role === 'CUSTOMER' && <Field label="Customer" required><Select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">Select…</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
          <p className="text-xs text-muted">In production the user receives a Cognito invitation and must set up MFA for owner, admin and accounts roles.</p>
          <ProblemAlert error={save.error} />
        </div>
      </Modal>
    </Card>
  );
}

function Master() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const items = useMaster();
  const [f, setF] = useState({ kind: 'FEE_TYPE', code: '', name: '' });
  const add = useMutation({ mutationFn: () => api.post('/v1/platform/admin/master-data', f), onSuccess: () => { setF({ ...f, code: '', name: '' }); void qc.invalidateQueries({ queryKey: ['master'] }); } });
  const archive = useMutation({ mutationFn: (id: string) => api.del(`/v1/platform/admin/master-data/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['master'] }) });
  const kinds = ['PORT', 'TERMINAL', 'SHIPPING_LINE', 'FEE_TYPE'];
  return (
    <div className="space-y-4">
      {can('admin.config') && (
        <Card title="Add item">
          <div className="grid gap-2 sm:grid-cols-[180px_160px_1fr_auto]">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{kinds.map((k) => <option key={k} value={k}>{k.replace('_', ' ').toLowerCase()}</option>)}</Select>
            <Input placeholder="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
            <Input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Button variant="primary" disabled={!f.code || !f.name} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
          </div>
          <div className="mt-2"><ProblemAlert error={add.error} /></div>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {kinds.map((k) => (
          <Card key={k} title={k.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} padded={false}>
            <Table>
              <tbody>{(items.data ?? []).filter((i) => i.kind === k).map((i) => <tr key={i.id}><td className="w-32 font-mono">{i.code}</td><td>{i.name}</td><td className="text-end">{can('admin.config') && <button className="text-muted hover:text-bad" onClick={() => archive.mutate(i.id)} aria-label="Archive"><Trash2 className="size-4" /></button>}</td></tr>)}</tbody>
            </Table>
          </Card>
        ))}
      </div>
    </div>
  );
}

type Stage = { key: string; level: string; order: number; label: I18n; slaHours?: number; ownerRole: string; statuses: { key: string; label: I18n; done?: boolean }[]; transitions: { from: string[]; to: string; guard?: unknown }[] };
function Workflow() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const wf = useQuery({ queryKey: ['workflow'], queryFn: () => api.get<{ active: { version: number; stages: Stage[] }; versions: { version: number; active: boolean; createdAt: string }[] }>('/v1/platform/admin/workflow') });
  const [sla, setSla] = useState<Record<string, number>>({});
  const publish = useMutation({ mutationFn: () => api.put('/v1/platform/admin/workflow/sla', { sla }), onSuccess: () => { setSla({}); void qc.invalidateQueries({ queryKey: ['workflow'] }); } });
  if (wf.isLoading || !wf.data) return <Spinner />;
  return (
    <div className="space-y-4">
      <Card title={`Active workflow — version ${wf.data.active.version}`} actions={can('admin.config') && <Button size="sm" variant="primary" disabled={!Object.keys(sla).length} loading={publish.isPending} onClick={() => publish.mutate()}>Publish as v{wf.data.active.version + 1}</Button>} padded={false}>
        <p className="px-4 pt-3 text-sm text-muted">Stages, statuses and gates are configuration (ADR-008). Running jobs keep the version they started with; new jobs use the new one.</p>
        <Table>
          <thead><tr><th>#</th><th>Stage</th><th>Level</th><th>Owner</th><th>Statuses</th><th>Gated</th><th>SLA (hours)</th></tr></thead>
          <tbody>
            {[...wf.data.active.stages].sort((a, b) => a.order - b.order).map((s) => (
              <tr key={s.key}>
                <td className="text-muted">{s.order}</td>
                <td className="font-medium">{L(s.label)}</td>
                <td><Badge>{s.level.toLowerCase()}</Badge></td>
                <td className="text-muted">{s.ownerRole.toLowerCase()}</td>
                <td className="text-xs">{s.statuses.map((x) => <span key={x.key} className={`me-1 ${x.done ? 'text-ok' : 'text-muted'}`}>{L(x.label)}{x.done ? ' ✓' : ''} ·</span>)}</td>
                <td>{s.transitions.some((t) => t.guard) ? <Badge tone="warn">yes</Badge> : '—'}</td>
                <td><Input type="number" min={1} className="h-8 w-24" disabled={!can('admin.config')} value={sla[s.key] ?? s.slaHours ?? ''} onChange={(e) => setSla({ ...sla, [s.key]: Number(e.target.value) })} /></td>
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
