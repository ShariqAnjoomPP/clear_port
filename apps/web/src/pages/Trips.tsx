import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Copy, Plus, Truck } from 'lucide-react';
import { api } from '../lib/api';
import { useStaff } from '../lib/hooks';
import { daysUntil, fmtDate, fmtDateTime, humanize } from '../lib/format';
import { AssignTripModal } from '../components/AssignTrip';
import { Badge, Button, Card, Input, Modal, PageHeader, ProblemAlert, Spinner, Table, Tabs } from '../components/ui';
import type { Trip } from '../components/types';

type Ready = { containerId: string; containerNo: string; sizeType: string; freeTimeExpiresAt: string | null; jobId: string; jobNo: string; blNo: string; customerName: string };
type Vehicle = { id: string; plateNo: string; type: string; registrationExpiry: string | null; transporter: string | null };

export function TripsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'ready' | 'trips' | 'fleet'>('ready');
  const ready = useQuery({ queryKey: ['ready'], queryFn: () => api.get<{ items: Ready[] }>('/fieldops/ready-containers').then((r) => r.items) });
  const trips = useQuery({ queryKey: ['trips'], queryFn: () => api.get<{ items: Trip[] }>('/fieldops/trips').then((r) => r.items) });
  return (
    <>
      <PageHeader title={t('nav.trips')} subtitle="Containers released by the port waiting for a truck, trips in progress, and the fleet." />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'ready', label: 'Ready for truck', count: ready.data?.length }, { value: 'trips', label: 'Trips', count: trips.data?.length }, { value: 'fleet', label: 'Drivers & vehicles' }]} />
      <div className="mt-4">
        {tab === 'ready' && <ReadyTab ready={ready.data} loading={ready.isLoading} />}
        {tab === 'trips' && <TripsList trips={trips.data} loading={trips.isLoading} />}
        {tab === 'fleet' && <Fleet />}
      </div>
    </>
  );
}

function ReadyTab({ ready, loading }: { ready?: Ready[]; loading: boolean }) {
  const [assign, setAssign] = useState<{ jobId: string; containers: { id: string; containerNo: string }[] } | null>(null);
  const byJob = useMemo(() => {
    const m = new Map<string, Ready[]>();
    for (const r of ready ?? []) m.set(r.jobId, [...(m.get(r.jobId) ?? []), r]);
    return [...m.values()];
  }, [ready]);
  // The modal keeps the same place in the tree whether or not the list is empty: after assigning, the list may
  // empty out, and the success view (with the driver link) must stay on screen.
  const modal = assign && <AssignTripModal jobId={assign.jobId} containers={assign.containers} onClose={() => setAssign(null)} />;
  return (
    <>
      {loading ? <Spinner /> : !byJob.length ? <Card><p className="py-6 text-center text-sm text-muted">No containers are waiting for a truck.</p></Card> : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {byJob.map((list) => {
            const j = list[0]!;
            return (
              <Card key={j.jobId} title={<span><Link to="/jobs/$jobId" params={{ jobId: j.jobId }} className="font-mono text-brand-2 hover:underline">{j.blNo}</Link> <span className="font-normal text-muted">· {j.customerName}</span></span>} actions={<Button size="sm" variant="primary" onClick={() => setAssign({ jobId: j.jobId, containers: list.map((c) => ({ id: c.containerId, containerNo: c.containerNo })) })}><Truck className="size-4" /> Assign</Button>}>
                <ul className="space-y-1.5 text-sm">
                  {list.map((c) => {
                    const d = daysUntil(c.freeTimeExpiresAt);
                    return (
                      <li key={c.containerId} className="flex items-center justify-between">
                        <span className="font-mono">{c.containerNo} <span className="font-sans text-xs text-muted">{c.sizeType}</span></span>
                        {c.freeTimeExpiresAt && <Badge tone={d !== null && d <= 1 ? 'bad' : d !== null && d <= 3 ? 'warn' : 'neutral'}>free time {fmtDate(c.freeTimeExpiresAt)}</Badge>}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      {modal}
    </>
  );
}

function TripsList({ trips, loading }: { trips?: Trip[]; loading: boolean }) {
  const qc = useQueryClient();
  const [link, setLink] = useState<string | null>(null);
  const reissue = useMutation({ mutationFn: (id: string) => api.post<{ url: string }>(`/fieldops/trips/${id}/link`), onSuccess: (r) => setLink(r.url) });
  const cancel = useMutation({ mutationFn: (id: string) => api.post(`/fieldops/trips/${id}/cancel`), onSuccess: () => void qc.invalidateQueries() });
  if (loading) return <Spinner />;
  return (
    <Card padded={false}>
      <ProblemAlert error={cancel.error ?? reissue.error} />
      <Table>
        <thead><tr><th>Trip</th><th>BL</th><th>Driver</th><th>Vehicle</th><th>Containers</th><th>Status</th><th /></tr></thead>
        <tbody>
          {(trips ?? []).map((t) => (
            <tr key={t.id}>
              <td className="font-medium">{t.tripNo}<p className="text-xs text-muted">{fmtDateTime(t.createdAt)}</p></td>
              <td><Link to="/jobs/$jobId" params={{ jobId: t.jobId }} className="font-mono text-brand-2 hover:underline">{t.blNo}</Link><p className="text-xs text-muted">{t.customerName}</p></td>
              <td>{t.driverName}<p className="text-xs text-muted">{t.driverPhone}</p></td>
              <td>{t.plateNo}</td>
              <td className="font-mono text-xs">{(t.containers ?? []).join(', ')}</td>
              <td><Badge tone={t.status === 'COMPLETED' ? 'ok' : 'info'}>{humanize(t.status)}</Badge></td>
              <td className="space-x-1 whitespace-nowrap text-end">
                {(t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS') && <Button size="sm" onClick={() => reissue.mutate(t.id)}>Driver link</Button>}
                {t.status === 'ASSIGNED' && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(t.id)}>Cancel</Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {link && (
        <Modal open onClose={() => setLink(null)} title="New driver link" footer={<Button onClick={() => setLink(null)}>Close</Button>}>
          <p className="text-sm text-muted">The previous link stops working. This one works until the trip is completed.</p>
          <div className="mt-3 flex gap-2"><Input readOnly value={link} className="font-mono text-xs" /><Button onClick={() => void navigator.clipboard.writeText(link)}><Copy className="size-4" /></Button></div>
          <a href={link} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-brand-2 underline">Open driver view</a>
        </Modal>
      )}
    </Card>
  );
}

function Fleet() {
  const qc = useQueryClient();
  const drivers = useStaff('DRIVER');
  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: () => api.get<{ items: Vehicle[] }>('/fieldops/vehicles').then((r) => r.items) });
  const [d, setD] = useState({ name: '', phone: '', licenceNo: '', licenceExpiry: '', transporter: '' });
  const [v, setV] = useState({ plateNo: '', type: 'Trailer 40ft', registrationExpiry: '', transporter: '' });
  const clean = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, x]) => x));
  // Drivers are staff with the DRIVER role.
  const addD = useMutation({ mutationFn: () => api.post('/settings/staff', { ...clean(d), role: 'DRIVER' }), onSuccess: () => { setD({ name: '', phone: '', licenceNo: '', licenceExpiry: '', transporter: '' }); void qc.invalidateQueries({ queryKey: ['staff'] }); } });
  const addV = useMutation({ mutationFn: () => api.post('/fieldops/vehicles', clean(v)), onSuccess: () => { setV({ plateNo: '', type: 'Trailer 40ft', registrationExpiry: '', transporter: '' }); void qc.invalidateQueries({ queryKey: ['vehicles'] }); } });
  const expiry = (date: string | null) => {
    const n = daysUntil(date);
    return date ? <Badge tone={n !== null && n < 0 ? 'bad' : n !== null && n <= 30 ? 'warn' : 'neutral'}>{fmtDate(date)}</Badge> : '—';
  };
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Drivers" padded={false}>
        <Table>
          <thead><tr><th>Name</th><th>Mobile</th><th>Transporter</th><th>Licence expiry</th></tr></thead>
          <tbody>{(drivers.data ?? []).map((x) => <tr key={x.id}><td className="font-medium">{x.name}</td><td>{x.phone ?? '—'}</td><td className="text-muted">{x.transporter ?? '—'}</td><td>{expiry(x.licenceExpiry)}</td></tr>)}</tbody>
        </Table>
        <div className="grid grid-cols-1 gap-2 border-t border-line p-3 sm:grid-cols-5">
          <Input placeholder="Name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
          <Input placeholder="Mobile" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} />
          <Input placeholder="Transporter" value={d.transporter} onChange={(e) => setD({ ...d, transporter: e.target.value })} />
          <Input type="date" value={d.licenceExpiry} onChange={(e) => setD({ ...d, licenceExpiry: e.target.value })} aria-label="Licence expiry" />
          <Button onClick={() => addD.mutate()} loading={addD.isPending} disabled={!d.name.trim()}><Plus className="size-4" /> Add</Button>
        </div>
        <div className="px-3 pb-3"><ProblemAlert error={addD.error} /></div>
      </Card>
      <Card title="Vehicles" padded={false}>
        <Table>
          <thead><tr><th>Plate</th><th>Type</th><th>Transporter</th><th>Registration expiry</th></tr></thead>
          <tbody>{(vehicles.data ?? []).map((x) => <tr key={x.id}><td className="font-mono font-medium">{x.plateNo}</td><td>{x.type}</td><td className="text-muted">{x.transporter ?? '—'}</td><td>{expiry(x.registrationExpiry)}</td></tr>)}</tbody>
        </Table>
        <div className="grid grid-cols-1 gap-2 border-t border-line p-3 sm:grid-cols-5">
          <Input placeholder="Plate no." value={v.plateNo} onChange={(e) => setV({ ...v, plateNo: e.target.value })} />
          <Input placeholder="Type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} />
          <Input placeholder="Transporter" value={v.transporter} onChange={(e) => setV({ ...v, transporter: e.target.value })} />
          <Input type="date" value={v.registrationExpiry} onChange={(e) => setV({ ...v, registrationExpiry: e.target.value })} aria-label="Registration expiry" />
          <Button onClick={() => addV.mutate()} loading={addV.isPending} disabled={!v.plateNo}><Plus className="size-4" /> Add</Button>
        </div>
        <div className="px-3 pb-3"><ProblemAlert error={addV.error} /></div>
      </Card>
    </div>
  );
}
