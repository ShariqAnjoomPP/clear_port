import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { api } from '../lib/api';
import { useStaff } from '../lib/hooks';
import { Button, Field, Input, Modal, ProblemAlert, Select } from './ui';
import { currencyCode } from '../lib/format';

type Vehicle = { id: string; plateNo: string; type: string; registrationExpiry: string | null };

/** Assign a truck, driver, inspection agent and delivery details to one or more containers of a job. */
export function AssignTripModal({ jobId, containers, onClose }: { jobId: string; containers: { id: string; containerNo: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const drivers = useStaff('DRIVER');
  const inspectors = useStaff('INSPECTOR');
  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: () => api.get<{ items: Vehicle[] }>('/fieldops/vehicles').then((r) => r.items) });
  const [selected, setSelected] = useState<string[]>(containers.map((c) => c.id));
  const [f, setF] = useState({ driverId: '', vehicleId: '', inspectionAgentId: '', deliveryAddress: '', deliveryContact: '', deliveryWindow: '', cost: '' });
  const [link, setLink] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.post<{ id: string; tripNo: string; link: string }>('/fieldops/trips', { jobId, containerIds: selected, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), currency: f.cost ? currencyCode() : undefined }),
    onSuccess: (r) => {
      setLink(r.link);
      void qc.invalidateQueries();
    },
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  if (link)
    return (
      <Modal open onClose={onClose} title="Trip assigned" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <p className="text-sm">Send this link to the driver. It works without an account and stops working when the trip is completed. (Sending it by WhatsApp automatically arrives in milestone 5.)</p>
        <div className="mt-3 flex gap-2"><Input readOnly value={link} className="font-mono text-xs" /><Button onClick={() => void navigator.clipboard.writeText(link)}><Copy className="size-4" /></Button></div>
        <a href={link} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-brand-2 underline">Open driver view</a>
      </Modal>
    );
  return (
    <Modal open onClose={onClose} title="Assign truck" wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!selected.length || !f.driverId || !f.vehicleId || !f.deliveryAddress} onClick={() => save.mutate()}>Assign {selected.length} container(s)</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Containers" className="sm:col-span-2">
          <div className="flex flex-wrap gap-2">
            {containers.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 font-mono text-sm">
                <input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} /> {c.containerNo}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Driver" required>
          <Select value={f.driverId} onChange={(e) => set('driverId', e.target.value)}><option value="">Select…</option>{(drivers.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name} · {d.transporter ?? 'own'}</option>)}</Select>
        </Field>
        <Field label="Vehicle" required>
          <Select value={f.vehicleId} onChange={(e) => set('vehicleId', e.target.value)}><option value="">Select…</option>{(vehicles.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.plateNo} · {v.type}</option>)}</Select>
        </Field>
        <Field label="Physical inspection agent">
          <Select value={f.inspectionAgentId} onChange={(e) => set('inspectionAgentId', e.target.value)}><option value="">—</option>{(inspectors.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        </Field>
        <Field label={`Trucking cost (${currencyCode()})`} hint="For job profitability"><Input inputMode="decimal" value={f.cost} onChange={(e) => set('cost', e.target.value)} /></Field>
        <Field label="Delivery address" required className="sm:col-span-2"><Input value={f.deliveryAddress} onChange={(e) => set('deliveryAddress', e.target.value)} /></Field>
        <Field label="Delivery contact"><Input value={f.deliveryContact} onChange={(e) => set('deliveryContact', e.target.value)} /></Field>
        <Field label="Delivery window"><Input value={f.deliveryWindow} onChange={(e) => set('deliveryWindow', e.target.value)} placeholder="e.g. 08:00–14:00" /></Field>
      </div>
      <div className="mt-3"><ProblemAlert error={save.error} /></div>
    </Modal>
  );
}
