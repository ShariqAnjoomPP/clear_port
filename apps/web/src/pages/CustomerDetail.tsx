import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { FileStack, Mail, MessageCircle, Pencil, Phone, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { fmtMoney } from '../lib/format';
import { JobListItem } from '../components/JobListItem';
import { Avatar, Badge, Button, Card, Empty, ListCard, ProblemAlert, SectionTitle, Skeleton, Spinner, Stat } from '../components/ui';
import type { JobSummary } from '../components/types';
import { CustomerModal, PortalLink, type CustomerFull } from './Customers';
import { ShareTracking } from '../components/ShareTracking';

type CustomerDetail = CustomerFull & { portalUrl: string | null; stats: { open_jobs: number; containers_in_progress: number; outstanding: string | null; avg_days: string | null } };

const CHANNEL: Record<string, string> = { WHATSAPP: 'WhatsApp', EMAIL: 'Email', SMS: 'SMS' };
const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;

/** One customer: how to reach them, their jobs, their portal link and their details. */
export function CustomerDetailPage() {
  const navigate = useNavigate();
  const { customerId } = useParams({ strict: false }) as { customerId: string };
  const [editing, setEditing] = useState(false);
  const c = useQuery({ queryKey: ['customer', customerId], queryFn: () => api.get<CustomerDetail>(`/customers/${customerId}`) });
  const jobs = useQuery({ queryKey: ['jobs', 'customer', customerId], queryFn: () => api.get<{ items: JobSummary[] }>(`/jobs?customerId=${customerId}`).then((r) => r.items) });
  if (c.isLoading) return <Spinner />;
  if (!c.data) return <ProblemAlert error={c.error} />;
  const cust = c.data;
  const main = cust.contacts[0];

  return (
    <>
      <div className="mt-2 flex items-center gap-4">
        <Avatar name={cust.name} className="size-14 text-lg" />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{cust.name}</h1>
          <p className="truncate text-sm text-on-surface-variant">{[main?.name, cust.customsCode].filter(Boolean).join(' · ') || 'No contact yet'}</p>
        </div>
      </div>

      {main && (main.phone || main.email) && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {main.phone && <ContactAction href={`tel:${main.phone}`} icon={<Phone className="size-5" />} label="Call" />}
          {main.phone && <ContactAction href={waLink(main.phone)} icon={<MessageCircle className="size-5" />} label="WhatsApp" />}
          {main.email && <ContactAction href={`mailto:${main.email}`} icon={<Mail className="size-5" />} label="Email" />}
        </div>
      )}

      <Button variant="primary" size="lg" className="mt-4 w-full" onClick={() => void navigate({ to: '/jobs/new', search: { customerId: cust.id } })}>
        <Plus className="size-5" /> Create job for this customer
      </Button>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat label="Open jobs" value={cust.stats.open_jobs} />
        <Stat label="Containers in progress" value={cust.stats.containers_in_progress} />
        <Stat label="Outstanding" value={fmtMoney(cust.stats.outstanding ?? 0)} />
        <Stat label="Avg. days to close" value={cust.stats.avg_days ? Number(cust.stats.avg_days).toFixed(1) : '—'} />
      </div>

      <SectionTitle>Jobs</SectionTitle>
      {jobs.isLoading ? <Skeleton className="h-32" /> : !jobs.data?.length ? (
        <ListCard><Empty icon={<FileStack className="size-7" />} title="No jobs yet" /></ListCard>
      ) : (
        <ListCard>{jobs.data.map((j) => <JobListItem key={j.jobId} j={j} />)}</ListCard>
      )}

      <SectionTitle>Shipment tracking</SectionTitle>
      <Card>
        <p className="mb-3 text-sm text-on-surface-variant">The customer opens the tracking page and enters {main?.phone ? <span className="font-medium text-on-surface">{main.phone}</span> : 'their mobile number'} to see every shipment. No money or documents are shown there.</p>
        <ShareTracking phone={main?.phone} />
      </Card>

      <SectionTitle>Customer portal</SectionTitle>
      <PortalLink customerId={cust.id} url={cust.portalUrl} />

      <SectionTitle action={<Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>}>Details</SectionTitle>
      <Card>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Detail label="Updates by" value={<Badge tone="brand">{CHANNEL[cust.preferredChannel] ?? cust.preferredChannel}</Badge>} />
          <Detail label="Language" value={cust.language === 'ar' ? 'Arabic' : 'English'} />
          <Detail label="Customs code" value={cust.customsCode ?? '—'} />
          <Detail label="Trade licence" value={cust.tradeLicenceNo ?? '—'} />
          <Detail label="Credit" value={`${cust.creditLimit ? fmtMoney(cust.creditLimit) : 'No limit'} · ${cust.creditDays} days`} />
          <Detail label="Tariff" value={cust.tariff ? `${fmtMoney(cust.tariff.perBl, cust.tariff.currency)} / B/L + ${fmtMoney(cust.tariff.perContainer, cust.tariff.currency)} / ctr` : 'Not set'} />
          <Detail label="Address" value={cust.address ?? '—'} wide />
        </dl>
        {cust.contacts.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-outline-variant/50 pt-3">
            <p className="text-xs font-medium text-on-surface-variant">Contacts</p>
            {cust.contacts.map((ct, i) => (
              <p key={ct.id ?? i} className="text-sm"><span className="font-medium">{ct.name}</span>{ct.role && ` · ${ct.role}`}<br /><span className="text-on-surface-variant">{[ct.phone, ct.email].filter(Boolean).join(' · ')}{ct.whatsappOptIn && ' · WhatsApp ✓'}</span></p>
            ))}
          </div>
        )}
      </Card>
      {editing && <CustomerModal id={cust.id} onClose={() => setEditing(false)} />}
    </>
  );
}

function ContactAction({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="flex flex-col items-center gap-1 rounded-2xl bg-secondary-container py-3 text-sm font-medium text-on-secondary-container active:scale-[0.98]">
      {icon}
      {label}
    </a>
  );
}

function Detail({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : 'min-w-0'}>
      <dt className="text-xs text-on-surface-variant">{label}</dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}
