import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Camera, CheckCircle2, ChevronDown, FileStack, Package, Pencil, Plus, Snowflake, Trash2, UserPlus, Users, XCircle } from 'lucide-react';
import { CONTAINER_TYPES, FREE_TIME_BASES, INCOTERMS, PACKAGE_KINDS, REEFER_TYPES, SERVICE_TYPES } from '@clearport/contracts';
import { checkContainerLength, parseContainerList } from '@clearport/kernel';
import { api, uploadDocument } from '../lib/api';
import { useCustomers, useMaster, useStaff, type CustomerLite } from '../lib/hooks';
import { currencyCode, fmtDate, fmtMoney, humanize } from '../lib/format';
import { JobListItem } from '../components/JobListItem';
import { PackPicker } from '../components/DocPack';
import { Avatar, Badge, Button, Card, Empty, Fab, Field, FilterChips, Input, ListCard, ListItem, ProblemAlert, SearchBar, Segmented, Select, Skeleton, Stepper, Textarea, useSnackbar } from '../components/ui';
import type { JobSummary } from '../components/types';

// ───────────────────────── Jobs list ─────────────────────────

type JobFilter = 'OPEN' | 'OVERDUE' | 'DOCUMENTS' | 'CLEARANCE' | 'CCRO' | 'DELIVERY' | 'READY_TO_CLOSE' | 'CLOSED';
const FILTERS: { value: JobFilter; label: string }[] = [
  { value: 'OPEN', label: 'All open' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'DOCUMENTS', label: 'Documents' },
  { value: 'CLEARANCE', label: 'Customs & DO' },
  { value: 'CCRO', label: 'Port release' },
  { value: 'DELIVERY', label: 'Delivering' },
  { value: 'READY_TO_CLOSE', label: 'Ready to close' },
  { value: 'CLOSED', label: 'Closed' },
];

export function JobsPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { q?: string; filter?: JobFilter };
  const [q, setQ] = useState(search.q ?? '');
  const [filter, setFilter] = useState<JobFilter>(search.filter ?? 'OPEN');
  useEffect(() => setQ(search.q ?? ''), [search.q]);
  const status = filter === 'CLOSED' ? 'CLOSED' : 'OPEN';
  const jobs = useQuery({
    queryKey: ['jobs', status, q],
    queryFn: () => api.get<{ items: JobSummary[] }>(`/jobs?status=${status}&q=${encodeURIComponent(q.trim())}`).then((r) => r.items),
  });
  const list = useMemo(
    () => (jobs.data ?? []).filter((j) => filter === 'OPEN' || filter === 'CLOSED' || (filter === 'OVERDUE' ? j.overdue : j.phase === filter)),
    [jobs.data, filter],
  );
  return (
    <>
      <h1 className="mt-2 mb-3 text-2xl font-semibold tracking-tight">Jobs</h1>
      <SearchBar value={q} onChange={setQ} placeholder="Search B/L, customer, container…" />
      <div className="mt-3"><FilterChips value={filter} onChange={setFilter} items={FILTERS} /></div>
      <div className="mt-3">
        {jobs.isLoading ? <Skeleton className="h-64" /> : !list.length ? (
          <ListCard>
            <Empty icon={<FileStack className="size-7" />} title={q || filter !== 'OPEN' ? 'No jobs match' : 'No jobs yet'} action={!q && filter === 'OPEN' ? <Button variant="primary" onClick={() => void navigate({ to: '/jobs/new', search: {} })}><Plus className="size-4" /> Create job</Button> : undefined}>
              {!q && filter === 'OPEN' ? 'Create your first job. You can add the customer in the same step.' : 'Try another filter or search.'}
            </Empty>
          </ListCard>
        ) : (
          <ListCard>{list.map((j) => <JobListItem key={j.jobId} j={j} />)}</ListCard>
        )}
      </div>
      {/* Phones only: on wide screens the navigation rail has the create button */}
      <Fab className="lg:hidden" icon={<Plus className="size-6" />} label="Create job" onClick={() => void navigate({ to: '/jobs/new', search: {} })} />
    </>
  );
}

// ───────────────────────── Create job wizard ─────────────────────────

const STEPS = ['Customer', 'B/L', 'Goods', 'Review'];
type NewCustomer = {
  name: string; contactName: string; phone: string; email: string; whatsappOptIn: boolean; preferredChannel: string; language: string;
  customsCode: string; tradeLicenceNo: string; address: string; creditDays: string; perBl: string; perContainer: string;
};
const emptyCustomer: NewCustomer = { name: '', contactName: '', phone: '', email: '', whatsappOptIn: true, preferredChannel: 'WHATSAPP', language: 'en', customsCode: '', tradeLicenceNo: '', address: '', creditDays: '30', perBl: '', perContainer: '' };
/** Everything printed on the carrier's B/L, as typed (strings; empty = not given). */
const emptyBl = {
  blNo: '', eta: '', shippingLineCode: '', vessel: '', voyage: '', portOfLoading: '', portOfDischarge: 'OMSOH', terminal: '', priority: 'NORMAL', coordinatorId: '',
  freightTerms: 'PREPAID', freeTimeDays: '', freeTimeBasis: 'COMBINED',
  bookingNo: '', serviceContract: '', placeOfReceipt: '', placeOfDelivery: '', placeOfIssue: '', blIssueDate: '', shippedOnBoardDate: '', originalsCount: '', serviceType: '',
  invoiceNo: '', invoiceDate: '', invoiceValue: '', invoiceCurrency: 'USD', incoterm: '', countryOfOrigin: '', shippingDetails: '',
};
type Bl = typeof emptyBl;
const emptyParties = { shipper: '', notifySame: true, notifyParty: '' };
type Parties = typeof emptyParties;
/** Per-container details from the B/L's particulars, e.g. "MNBU0358657 ML-VN1780903 40 REEF 9'6 20 PALLETS 25344 KGS 50 CBM, 5.0 C". */
type BoxDetail = { sizeType: string; sealNo: string; packages: string; packageKind: string; grossWeightKg: string; volumeCbm: string; reeferTempC: string; ventilation: string };
const emptyBox = (sizeType: string): BoxDetail => ({ sizeType, sealNo: '', packages: '', packageKind: 'PALLET', grossWeightKg: '', volumeCbm: '', reeferTempC: '', ventilation: '' });
/** One goods line (B/L description / packing list row). */
type Goods = { key: number; description: string; hsCode: string; packages: string; packageKind: string; netWeightKg: string; grossWeightKg: string; containerNo: string };
let goodsKey = 0;
const emptyGoods = (): Goods => ({ key: ++goodsKey, description: '', hsCode: '', packages: '', packageKind: 'CARTON', netWeightKg: '', grossWeightKg: '', containerNo: '' });

const MONEY = /^\d+(\.\d{1,3})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUM = /^\d+(\.\d+)?$/;
const HS = /^\d{4,12}$/;
const n = (v: string) => (v.trim() === '' ? undefined : Number(v));
const isReefer = (t: string) => REEFER_TYPES.includes(t);
const kg = (v: number) => `${v.toLocaleString('en', { maximumFractionDigits: 2 })} kg`;

/**
 * Opening a job in four steps, in the order the B/L reads: customer (the consignee) and parties; the B/L and voyage;
 * containers and goods lines; review with the scanned pack. A new customer is created together with the job.
 */
export function NewJobPage() {
  const navigate = useNavigate();
  const snackbar = useSnackbar();
  const preset = (useSearch({ strict: false }) as { customerId?: string }).customerId;
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [picked, setPicked] = useState<CustomerLite | null>(null);
  const [nc, setNc] = useState<NewCustomer>(emptyCustomer);
  const [parties, setParties] = useState<Parties>(emptyParties);
  const [bl, setBl] = useState<Bl>(emptyBl);
  const [paste, setPaste] = useState('');
  const [defaultType, setDefaultType] = useState<string>('40HC');
  const [boxes, setBoxes] = useState<Record<string, BoxDetail>>({});
  const [goods, setGoods] = useState<Goods[]>(() => [emptyGoods()]);
  const [freeTime, setFreeTime] = useState('');
  const [blFile, setBlFile] = useState<File | null>(null);
  const [covers, setCovers] = useState<string[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  // On a fresh install there is nobody to pick yet: start on "New customer".
  const anyCustomers = useCustomers('');
  useEffect(() => {
    if (!preset && anyCustomers.data && anyCustomers.data.length === 0) setMode('new');
  }, [preset, anyCustomers.data]);

  // A customer chosen from their own page arrives pre-selected.
  const presetCustomer = useQuery({ queryKey: ['customer', preset], queryFn: () => api.get<CustomerLite>(`/customers/${preset}`), enabled: !!preset });
  useEffect(() => {
    if (presetCustomer.data && !picked) setPicked({ ...presetCustomer.data, openJobs: 0 });
  }, [presetCustomer.data, picked]);

  const parsed = useMemo(() => parseContainerList(paste).map((c) => ({ raw: c, ...checkContainerLength(c) })), [paste]);
  const valid = parsed.filter((p) => p.valid);
  const box = (no: string) => boxes[no] ?? emptyBox(defaultType);
  // With one container, every goods line is in it.
  const goodsOut = goods.map((g) => ({ ...g, containerNo: valid.length === 1 ? valid[0]!.value : g.containerNo }));

  const customerError = mode === 'existing'
    ? (!picked ? 'Choose a customer, or switch to “New customer”' : null)
    : nc.name.trim().length < 2 ? 'Enter the customer name'
      : nc.email && !EMAIL.test(nc.email) ? 'Check the email address'
        : (nc.perBl && !MONEY.test(nc.perBl)) || (nc.perContainer && !MONEY.test(nc.perContainer)) ? 'Tariff amounts must be numbers'
          : null;
  const blErrors: Partial<Record<keyof Bl, string>> = {
    blNo: bl.blNo.trim().length < 3 ? 'Required (3+ characters)' : undefined,
    eta: !bl.eta ? 'Required' : undefined,
    freeTimeDays: bl.freeTimeDays && !/^\d{1,3}$/.test(bl.freeTimeDays) ? 'Whole days, e.g. 9' : undefined,
    originalsCount: bl.originalsCount && !/^\d{1,2}$/.test(bl.originalsCount) ? 'A number, e.g. 3' : undefined,
    invoiceValue: bl.invoiceValue && !MONEY.test(bl.invoiceValue.replace(/,/g, '')) ? 'An amount, e.g. 20160.00' : undefined,
    invoiceCurrency: bl.invoiceCurrency && !/^[A-Za-z]{3}$/.test(bl.invoiceCurrency) ? '3 letters, e.g. USD' : undefined,
  };
  const boxErrors = (b: BoxDetail) => ({
    grossWeightKg: b.grossWeightKg && !NUM.test(b.grossWeightKg) ? 'Number' : undefined,
    volumeCbm: b.volumeCbm && !NUM.test(b.volumeCbm) ? 'Number' : undefined,
    packages: b.packages && !/^\d+$/.test(b.packages) ? 'Whole number' : undefined,
    reeferTempC: b.reeferTempC && !(/^-?\d+(\.\d)?$/.test(b.reeferTempC) && Math.abs(Number(b.reeferTempC)) <= 40) ? '−40 to 40' : undefined,
  });
  const goodsErrors = (g: Goods) => ({
    description: g.description.trim().length < 2 ? 'Required' : undefined,
    hsCode: g.hsCode && !HS.test(g.hsCode) ? '4–12 digits, e.g. 08055020' : undefined,
    packages: g.packages && !/^\d+$/.test(g.packages) ? 'Whole number' : undefined,
    netWeightKg: g.netWeightKg && !NUM.test(g.netWeightKg) ? 'Number' : undefined,
    grossWeightKg: g.grossWeightKg && !NUM.test(g.grossWeightKg) ? 'Number' : undefined,
  });
  const hasErr = (e: Record<string, string | undefined>) => Object.values(e).some(Boolean);
  const stepOk = [
    !customerError,
    !hasErr(blErrors),
    valid.length > 0 && valid.length === parsed.length && goods.length > 0 && !valid.some((v) => hasErr(boxErrors(box(v.value)))) && !goods.some((g) => hasErr(goodsErrors(g))),
  ];

  const next = () => {
    if (!stepOk[step]) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStep((s) => s + 1);
    window.scrollTo({ top: 0 });
  };

  const create = useMutation({
    mutationFn: async () => {
      const newCustomer = mode === 'new'
        ? {
            name: nc.name.trim(), contactName: nc.contactName || undefined, phone: nc.phone || undefined, email: nc.email || undefined,
            whatsappOptIn: nc.whatsappOptIn, preferredChannel: nc.preferredChannel, language: nc.language,
            customsCode: nc.customsCode || undefined, tradeLicenceNo: nc.tradeLicenceNo || undefined, address: nc.address || undefined,
            creditDays: Number(nc.creditDays || 30),
            tariff: nc.perBl || nc.perContainer ? { currency: currencyCode(), perBl: nc.perBl || '0', perContainer: nc.perContainer || '0', vatPct: 5, markupPct: 0 } : undefined,
          }
        : undefined;
      const job = await api.post<{ id: string; jobNo: string }>('/jobs', {
        ...Object.fromEntries(Object.entries(bl).filter(([, v]) => v !== '')),
        freeTimeDays: n(bl.freeTimeDays), originalsCount: n(bl.originalsCount), invoiceValue: bl.invoiceValue ? bl.invoiceValue.replace(/,/g, '') : undefined,
        invoiceCurrency: bl.invoiceValue ? bl.invoiceCurrency : undefined,
        shipper: parties.shipper || undefined,
        notifyParty: parties.notifySame ? 'Same as consignee' : parties.notifyParty || undefined,
        containers: valid.map((p) => {
          const b = box(p.value);
          return {
            containerNo: p.value, sizeType: b.sizeType, sealNo: b.sealNo || undefined, packages: n(b.packages), packageKind: b.packages ? b.packageKind : undefined,
            grossWeightKg: n(b.grossWeightKg), volumeCbm: n(b.volumeCbm), reeferTempC: isReefer(b.sizeType) ? n(b.reeferTempC) : undefined,
            ventilation: isReefer(b.sizeType) ? b.ventilation || undefined : undefined,
            freeTimeExpiresAt: !bl.freeTimeDays && freeTime ? freeTime : undefined,
          };
        }),
        cargoLines: goodsOut.map((g) => ({
          description: g.description.trim(), hsCode: g.hsCode || undefined, packages: n(g.packages), packageKind: g.packages ? g.packageKind : undefined,
          netWeightKg: n(g.netWeightKg), grossWeightKg: n(g.grossWeightKg), containerNo: g.containerNo || undefined,
        })),
        ...(newCustomer ? { newCustomer } : { customerId: picked!.id }),
      });
      if (blFile) await uploadDocument(job.id, blFile, 'BILL_OF_LADING', { customerVisible: true, covers, referenceNo: bl.blNo, issueDate: bl.blIssueDate || undefined });
      return job;
    },
    onSuccess: (job) => {
      snackbar.show(`Job ${job.jobNo} created`);
      void navigate({ to: '/jobs/$jobId', params: { jobId: job.id }, replace: true });
    },
  });

  const consignee = mode === 'new'
    ? { name: nc.name, line: [nc.contactName, nc.phone, nc.email].filter(Boolean).join(' · '), isNew: true }
    : { name: picked?.name ?? '', line: [picked?.contacts[0]?.name, picked?.contacts[0]?.phone].filter(Boolean).join(' · '), isNew: false };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-2 mb-4 text-2xl font-semibold tracking-tight">Create job</h1>
      <Stepper steps={STEPS} current={step} />
      <div className="mt-5 space-y-4">
        {step === 0 && (
          <>
            <CustomerStep mode={mode} setMode={setMode} picked={picked} setPicked={setPicked} nc={nc} setNc={setNc} error={showErrors ? customerError : null} />
            <PartiesCard parties={parties} setParties={setParties} />
          </>
        )}
        {step === 1 && <BlStep bl={bl} setBl={setBl} errors={showErrors ? blErrors : {}} />}
        {step === 2 && (
          <>
            <ContainersStep
              paste={paste} setPaste={setPaste} parsed={parsed} defaultType={defaultType} setDefaultType={setDefaultType}
              box={box} setBox={(no, b) => setBoxes({ ...boxes, [no]: b })} boxErrors={boxErrors}
              freeTimeDays={bl.freeTimeDays} freeTime={freeTime} setFreeTime={setFreeTime} showErrors={showErrors}
            />
            <GoodsStep goods={goods} setGoods={setGoods} containers={valid.map((v) => v.value)} errors={goodsErrors} showErrors={showErrors} boxGross={valid.reduce((t, v) => t + (n(box(v.value).grossWeightKg) ?? 0), 0)} />
          </>
        )}
        {step === 3 && (
          <ReviewStep
            customer={consignee} parties={parties} bl={bl} containers={valid.map((v) => ({ no: v.value, ...box(v.value) }))} goods={goodsOut}
            freeTime={freeTime} blFile={blFile} setBlFile={setBlFile} covers={covers} setCovers={setCovers} goTo={(s) => setStep(s)}
          />
        )}
        <ProblemAlert error={create.error} />
      </div>

      {/* Sticky actions above the bottom navigation */}
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+88px)] z-10 -mx-4 mt-6 flex gap-3 bg-surface/95 px-4 py-3 backdrop-blur lg:bottom-0">
        {step > 0 && <Button size="lg" className="flex-1" onClick={() => setStep((s) => s - 1)}>Back</Button>}
        {step < STEPS.length - 1 ? (
          <Button size="lg" variant="primary" className="flex-[2]" onClick={next}>Next</Button>
        ) : (
          <Button size="lg" variant="primary" className="flex-[2]" loading={create.isPending} onClick={() => create.mutate()}>
            Create job · {valid.length} container{valid.length === 1 ? '' : 's'}
          </Button>
        )}
      </div>
    </div>
  );
}

function CustomerStep({ mode, setMode, picked, setPicked, nc, setNc, error }: {
  mode: 'existing' | 'new'; setMode: (m: 'existing' | 'new') => void; picked: CustomerLite | null; setPicked: (c: CustomerLite | null) => void;
  nc: NewCustomer; setNc: (c: NewCustomer) => void; error: string | null;
}) {
  const [q, setQ] = useState('');
  const [more, setMore] = useState(false);
  const customers = useCustomers(q);
  const credit = useQuery({
    queryKey: ['credit', picked?.id],
    queryFn: () => api.get<{ exposure: string; creditLimit: string | null; overLimit: boolean }>(`/customers/${picked!.id}/credit-check`),
    enabled: !!picked,
  });
  // Possible duplicates while a new customer is typed in.
  const similar = useQuery({
    queryKey: ['similar', nc.name.trim(), nc.phone.trim()],
    queryFn: () => api.get<{ items: { id: string; name: string; contacts: { phone?: string }[] }[] }>(`/customers/similar?name=${encodeURIComponent(nc.name)}&phone=${encodeURIComponent(nc.phone)}`).then((r) => r.items),
    enabled: mode === 'new' && (nc.name.trim().length >= 3 || nc.phone.replace(/\D/g, '').length >= 7),
  });
  const set = (k: keyof NewCustomer, v: string | boolean) => setNc({ ...nc, [k]: v });

  return (
    <Card title="Customer">
      <Segmented value={mode} onChange={setMode} items={[{ value: 'existing', label: <><Users className="size-4" /> Existing</> }, { value: 'new', label: <><UserPlus className="size-4" /> New customer</> }]} />
      <div className="mt-4">
        {mode === 'existing' ? (
          picked ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-2xl bg-primary-container/60 p-3">
                <Avatar name={picked.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{picked.name}</p>
                  <p className="truncate text-sm text-on-surface-variant">{[picked.contacts[0]?.name, picked.contacts[0]?.phone].filter(Boolean).join(' · ') || picked.customsCode || '—'}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>Change</Button>
              </div>
              {credit.data?.overLimit && (
                <p className="flex items-start gap-2 rounded-xl bg-warning-container px-3 py-2 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Over credit limit: exposure {fmtMoney(credit.data.exposure)} vs limit {fmtMoney(credit.data.creditLimit)}. You can still create the job.
                </p>
              )}
            </div>
          ) : (
            <>
              <SearchBar value={q} onChange={setQ} placeholder="Search name, phone, email…" />
              <div className="mt-2 max-h-72 overflow-y-auto rounded-2xl border border-outline-variant/60">
                {customers.isLoading ? <Skeleton className="h-24" /> : !customers.data?.length ? (
                  <Empty title={q ? 'No customer found' : 'No customers yet'}>
                    <Button variant="tonal" onClick={() => { setMode('new'); setNc({ ...nc, name: q }); }}><UserPlus className="size-4" /> Add {q ? `“${q}”` : 'a new customer'}</Button>
                  </Empty>
                ) : (
                  <div className="divide-y divide-outline-variant/50">
                    {customers.data.map((c) => (
                      <ListItem key={c.id} leading={<Avatar name={c.name} />} title={c.name} subtitle={[c.contacts[0]?.name, c.contacts[0]?.phone].filter(Boolean).join(' · ') || c.customsCode || '—'} onClick={() => setPicked(c)} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )
        ) : (
          <div className="space-y-3">
            <Field label="Customer (company) name" required><Input value={nc.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Sahara Furniture Trading" autoComplete="organization" /></Field>
            {!!similar.data?.length && (
              <div className="rounded-xl bg-info-container p-3 text-sm text-info-role">
                <p className="font-medium">Already a customer?</p>
                {similar.data.map((s) => (
                  <button key={s.id} className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-start hover:bg-white/40" onClick={() => { setPicked({ id: s.id, name: s.name, contacts: s.contacts, customsCode: null, preferredChannel: '', openJobs: 0, tariff: null, creditLimit: null, creditDays: 30 } as CustomerLite); setMode('existing'); }}>
                    <span className="truncate">{s.name}{s.contacts[0]?.phone ? ` · ${s.contacts[0].phone}` : ''}</span>
                    <span className="shrink-0 font-medium underline">Use this</span>
                  </button>
                ))}
              </div>
            )}
            <Field label="Contact person"><Input value={nc.contactName} onChange={(e) => set('contactName', e.target.value)} autoComplete="name" /></Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Mobile"><Input type="tel" inputMode="tel" value={nc.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+968 9xxx xxxx" autoComplete="tel" /></Field>
              <Field label="Email"><Input type="email" inputMode="email" value={nc.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" /></Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Send updates by">
                <Select value={nc.preferredChannel} onChange={(e) => set('preferredChannel', e.target.value)}><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option><option value="SMS">SMS</option></Select>
              </Field>
              <Field label="Language"><Select value={nc.language} onChange={(e) => set('language', e.target.value)}><option value="en">English</option><option value="ar">العربية</option></Select></Field>
            </div>
            <label className="flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" className="size-5 accent-[var(--color-primary)]" checked={nc.whatsappOptIn} onChange={(e) => set('whatsappOptIn', e.target.checked)} /> Customer agrees to WhatsApp updates</label>
            <button type="button" onClick={() => setMore(!more)} className="flex items-center gap-1 text-sm font-medium text-primary">
              <ChevronDown className={clsx('size-4 transition', more && 'rotate-180')} /> {more ? 'Fewer details' : 'More details (customs code, address, tariff)'}
            </button>
            {more && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Customs / importer code"><Input value={nc.customsCode} onChange={(e) => set('customsCode', e.target.value)} /></Field>
                  <Field label="Trade licence no."><Input value={nc.tradeLicenceNo} onChange={(e) => set('tradeLicenceNo', e.target.value)} /></Field>
                </div>
                <Field label="Address"><Input value={nc.address} onChange={(e) => set('address', e.target.value)} autoComplete="street-address" /></Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Fee per B/L"><Input inputMode="decimal" value={nc.perBl} onChange={(e) => set('perBl', e.target.value)} placeholder={currencyCode()} /></Field>
                  <Field label="Per container"><Input inputMode="decimal" value={nc.perContainer} onChange={(e) => set('perContainer', e.target.value)} placeholder={currencyCode()} /></Field>
                  <Field label="Credit days"><Input inputMode="numeric" value={nc.creditDays} onChange={(e) => set('creditDays', e.target.value)} /></Field>
                </div>
              </div>
            )}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
      </div>
    </Card>
  );
}

/** Shipper and notify party, as printed at the top of the B/L. The consignee is the customer above. */
function PartiesCard({ parties, setParties }: { parties: Parties; setParties: (p: Parties) => void }) {
  return (
    <Card title="Shipper & notify party">
      <div className="space-y-3">
        <Field label="Shipper" hint="Name and address as on the B/L"><Textarea rows={3} value={parties.shipper} onChange={(e) => setParties({ ...parties, shipper: e.target.value })} placeholder={'KDN Agricultural Products Import Export Co., Ltd\nHo Chi Minh City, Vietnam'} /></Field>
        <label className="flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" className="size-5 accent-[var(--color-primary)]" checked={parties.notifySame} onChange={(e) => setParties({ ...parties, notifySame: e.target.checked })} /> Notify party is the same as the consignee</label>
        {!parties.notifySame && <Field label="Notify party"><Textarea rows={3} value={parties.notifyParty} onChange={(e) => setParties({ ...parties, notifyParty: e.target.value })} /></Field>}
      </div>
    </Card>
  );
}

function BlStep({ bl, setBl, errors }: { bl: Bl; setBl: (b: Bl) => void; errors: Partial<Record<keyof Bl, string>> }) {
  const lines = useMaster('SHIPPING_LINE');
  const ports = useMaster('PORT');
  const terminals = useMaster('TERMINAL');
  const coordinators = useStaff('COORDINATOR');
  const [more, setMore] = useState(false);
  const set = (k: keyof Bl, v: string) => setBl({ ...bl, [k]: v });
  const portOptions = (ports.data ?? []).map((m) => <option key={m.code} value={m.code}>{m.name} ({m.code})</option>);
  return (
    <>
      <Card title="Bill of lading">
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="B/L number" required error={errors.blNo}><Input value={bl.blNo} onChange={(e) => set('blNo', e.target.value.toUpperCase())} className="font-mono" autoCapitalize="characters" /></Field>
            <Field label="Shipping line"><Select value={bl.shippingLineCode} onChange={(e) => set('shippingLineCode', e.target.value)}><option value="">—</option>{(lines.data ?? []).map((m) => <option key={m.code} value={m.code}>{m.name} ({m.code})</option>)}</Select></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vessel"><Input value={bl.vessel} onChange={(e) => set('vessel', e.target.value.toUpperCase())} /></Field>
            <Field label="Voyage"><Input value={bl.voyage} onChange={(e) => set('voyage', e.target.value.toUpperCase())} /></Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Port of loading"><Select value={bl.portOfLoading} onChange={(e) => set('portOfLoading', e.target.value)}><option value="">—</option>{portOptions}</Select></Field>
            <Field label="Port of discharge"><Select value={bl.portOfDischarge} onChange={(e) => set('portOfDischarge', e.target.value)}>{portOptions}</Select></Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="ETA" required error={errors.eta}><Input type="date" value={bl.eta} onChange={(e) => set('eta', e.target.value)} /></Field>
            <Field label="Terminal"><Select value={bl.terminal} onChange={(e) => set('terminal', e.target.value)}><option value="">—</option>{(terminals.data ?? []).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</Select></Field>
          </div>
          <Field label="Freight">
            <Segmented value={bl.freightTerms} onChange={(v) => set('freightTerms', v)} items={[{ value: 'PREPAID', label: 'Prepaid' }, { value: 'COLLECT', label: 'Collect' }]} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Free days" hint="e.g. 9 days at destination" error={errors.freeTimeDays}><Input inputMode="numeric" value={bl.freeTimeDays} onChange={(e) => set('freeTimeDays', e.target.value)} /></Field>
            <Field label="Free time covers"><Select value={bl.freeTimeBasis} onChange={(e) => set('freeTimeBasis', e.target.value)}>{FREE_TIME_BASES.map((b) => <option key={b} value={b}>{b === 'COMBINED' ? 'Detention + demurrage' : humanize(b)}</option>)}</Select></Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Priority"><Select value={bl.priority} onChange={(e) => set('priority', e.target.value)}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></Select></Field>
            <Field label="Coordinator"><Select value={bl.coordinatorId} onChange={(e) => set('coordinatorId', e.target.value)}><option value="">—</option>{(coordinators.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          </div>
          <button type="button" onClick={() => setMore(!more)} className="flex min-h-10 items-center gap-1 text-sm font-medium text-primary">
            <ChevronDown className={clsx('size-4 transition', more && 'rotate-180')} /> {more ? 'Fewer B/L details' : 'More from the B/L (booking, dates, places, originals)'}
          </button>
          {more && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Booking no."><Input value={bl.bookingNo} onChange={(e) => set('bookingNo', e.target.value.toUpperCase())} className="font-mono" /></Field>
                <Field label="Service contract"><Input value={bl.serviceContract} onChange={(e) => set('serviceContract', e.target.value)} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="B/L issue date"><Input type="date" value={bl.blIssueDate} onChange={(e) => set('blIssueDate', e.target.value)} /></Field>
                <Field label="Shipped on board"><Input type="date" value={bl.shippedOnBoardDate} onChange={(e) => set('shippedOnBoardDate', e.target.value)} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Place of issue"><Input value={bl.placeOfIssue} onChange={(e) => set('placeOfIssue', e.target.value)} /></Field>
                <Field label="Original B/Ls" hint="e.g. 3 for THREE/3" error={errors.originalsCount}><Input inputMode="numeric" value={bl.originalsCount} onChange={(e) => set('originalsCount', e.target.value)} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Place of receipt"><Input value={bl.placeOfReceipt} onChange={(e) => set('placeOfReceipt', e.target.value)} /></Field>
                <Field label="Place of delivery"><Input value={bl.placeOfDelivery} onChange={(e) => set('placeOfDelivery', e.target.value)} /></Field>
              </div>
              <Field label="Service"><Select value={bl.serviceType} onChange={(e) => set('serviceType', e.target.value)}><option value="">—</option>{SERVICE_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
              <Field label="Notes (optional)"><Textarea value={bl.shippingDetails} onChange={(e) => set('shippingDetails', e.target.value)} /></Field>
            </div>
          )}
        </div>
      </Card>
      <Card title="Commercial invoice (optional)">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Invoice no."><Input value={bl.invoiceNo} onChange={(e) => set('invoiceNo', e.target.value.toUpperCase())} className="font-mono" /></Field>
            <Field label="Invoice date"><Input type="date" value={bl.invoiceDate} onChange={(e) => set('invoiceDate', e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <Field label="Invoice value" error={errors.invoiceValue}><Input inputMode="decimal" value={bl.invoiceValue} onChange={(e) => set('invoiceValue', e.target.value)} /></Field>
            <Field label="Currency" error={errors.invoiceCurrency}><Input value={bl.invoiceCurrency} maxLength={3} onChange={(e) => set('invoiceCurrency', e.target.value.toUpperCase())} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Incoterm"><Select value={bl.incoterm} onChange={(e) => set('incoterm', e.target.value)}><option value="">—</option>{INCOTERMS.map((t) => <option key={t}>{t}</option>)}</Select></Field>
            <Field label="Country of origin"><Input value={bl.countryOfOrigin} onChange={(e) => set('countryOfOrigin', e.target.value)} placeholder="e.g. Vietnam" /></Field>
          </div>
        </div>
      </Card>
    </>
  );
}

function ContainersStep({ paste, setPaste, parsed, defaultType, setDefaultType, box, setBox, boxErrors, freeTimeDays, freeTime, setFreeTime, showErrors }: {
  paste: string; setPaste: (v: string) => void; parsed: { raw: string; valid: boolean; value: string; error?: string }[];
  defaultType: string; setDefaultType: (v: string) => void; box: (no: string) => BoxDetail; setBox: (no: string, b: BoxDetail) => void;
  boxErrors: (b: BoxDetail) => Partial<Record<keyof BoxDetail, string>>; freeTimeDays: string; freeTime: string; setFreeTime: (v: string) => void; showErrors: boolean;
}) {
  const invalid = parsed.filter((p) => !p.valid).length;
  const valid = parsed.filter((p) => p.valid);
  return (
    <Card title={`Containers${parsed.length ? ` · ${parsed.length - invalid} valid` : ''}`}>
      <div className="space-y-3">
        <Field label="Container numbers" hint="One per line, or separated by commas or spaces. Each must be 11 letters/digits, e.g. MNBU0358657.">
          <Textarea rows={3} value={paste} onChange={(e) => setPaste(e.target.value.toUpperCase())} className="font-mono" placeholder={'MNBU0358657\nMNBU4571402'} autoCapitalize="characters" />
        </Field>
        {parsed.some((p) => !p.valid) && (
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {parsed.filter((p) => !p.valid).map((p) => (
              <li key={p.raw} className="flex items-center gap-2 rounded-xl bg-error-container px-3 py-2 font-mono text-sm text-error">
                <XCircle className="size-4 shrink-0" /> {p.value}<span className="ms-auto font-sans text-xs">must be 11 characters</span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type (for new rows)"><Select value={defaultType} onChange={(e) => setDefaultType(e.target.value)}>{CONTAINER_TYPES.map((c) => <option key={c} value={c}>{typeLabel(c)}</option>)}</Select></Field>
          {!freeTimeDays && <Field label="Free time ends" hint="Or enter free days on the B/L step"><Input type="date" value={freeTime} onChange={(e) => setFreeTime(e.target.value)} /></Field>}
        </div>
        {valid.map((p) => {
          const b = box(p.value);
          const e = showErrors ? boxErrors(b) : {};
          const set = (k: keyof BoxDetail, v: string) => setBox(p.value, { ...b, [k]: v });
          return (
            <div key={p.value} className="space-y-3 rounded-2xl border border-outline-variant/70 p-3">
              <p className="flex items-center gap-2 font-mono text-sm font-semibold"><CheckCircle2 className="size-4 text-success" /> {p.value}{isReefer(b.sizeType) && <Snowflake className="size-4 text-info-role" aria-label="Reefer" />}</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type"><Select value={b.sizeType} onChange={(ev) => set('sizeType', ev.target.value)}>{CONTAINER_TYPES.map((c) => <option key={c} value={c}>{typeLabel(c)}</option>)}</Select></Field>
                <Field label="Seal no."><Input value={b.sealNo} onChange={(ev) => set('sealNo', ev.target.value.toUpperCase())} className="font-mono" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Packages" error={e.packages}><Input inputMode="numeric" value={b.packages} onChange={(ev) => set('packages', ev.target.value)} /></Field>
                <Field label="Kind"><Select value={b.packageKind} onChange={(ev) => set('packageKind', ev.target.value)}>{PACKAGE_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</Select></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Gross weight (kg)" error={e.grossWeightKg}><Input inputMode="decimal" value={b.grossWeightKg} onChange={(ev) => set('grossWeightKg', ev.target.value)} /></Field>
                <Field label="Volume (CBM)" error={e.volumeCbm}><Input inputMode="decimal" value={b.volumeCbm} onChange={(ev) => set('volumeCbm', ev.target.value)} /></Field>
              </div>
              {isReefer(b.sizeType) && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Set temperature (°C)" error={e.reeferTempC}><Input inputMode="decimal" value={b.reeferTempC} onChange={(ev) => set('reeferTempC', ev.target.value)} placeholder="e.g. 5.0" /></Field>
                  <Field label="Ventilation"><Input value={b.ventilation} onChange={(ev) => set('ventilation', ev.target.value.toUpperCase())} placeholder="e.g. 25 CBM/H" /></Field>
                </div>
              )}
            </div>
          );
        })}
        {showErrors && (!parsed.length ? <p className="text-sm text-error">Add at least one container.</p> : invalid ? <p className="text-sm text-error">Fix or remove the {invalid} invalid container number{invalid === 1 ? '' : 's'}.</p> : null)}
      </div>
    </Card>
  );
}

/** "40RH" → "40RH · 40' reefer high cube": how the B/L describes it ("40 REEF 9'6"). Code first, so a narrow select still shows it. */
export function typeLabel(t: string) {
  const names: Record<string, string> = { GP: 'general', HC: 'high cube', RF: 'reefer', RH: 'reefer high cube', OT: 'open top', FR: 'flat rack' };
  return `${t} · ${t.slice(0, 2)}' ${names[t.slice(2)] ?? ''}`;
}

function GoodsStep({ goods, setGoods, containers, errors, showErrors, boxGross }: {
  goods: Goods[]; setGoods: (g: Goods[]) => void; containers: string[]; errors: (g: Goods) => Partial<Record<keyof Goods, string>>; showErrors: boolean; boxGross: number;
}) {
  const update = (key: number, k: keyof Goods, v: string) => setGoods(goods.map((g) => (g.key === key ? { ...g, [k]: v } : g)));
  const total = (k: 'packages' | 'netWeightKg' | 'grossWeightKg') => goods.reduce((t, g) => t + (n(g[k]) ?? 0), 0);
  const gross = total('grossWeightKg');
  return (
    <Card title={`Goods · ${goods.length} line${goods.length === 1 ? '' : 's'}`}>
      <div className="space-y-3">
        <p className="text-sm text-on-surface-variant">One line per item on the B/L or packing list, e.g. “Fresh seedless lime, HS 08055020, 4,608 cartons”.</p>
        {goods.map((g, i) => {
          const e = showErrors ? errors(g) : {};
          return (
            <div key={g.key} className="space-y-3 rounded-2xl border border-outline-variant/70 p-3">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm font-semibold"><Package className="size-4 text-on-surface-variant" /> Line {i + 1}</p>
                {goods.length > 1 && <Button size="sm" variant="ghost" onClick={() => setGoods(goods.filter((x) => x.key !== g.key))} aria-label={`Remove line ${i + 1}`}><Trash2 className="size-4" /> Remove</Button>}
              </div>
              <Field label="Description" required error={e.description}><Input value={g.description} onChange={(ev) => update(g.key, 'description', ev.target.value)} placeholder="e.g. Fresh seedless lime" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="HS code" error={e.hsCode}><Input inputMode="numeric" value={g.hsCode} onChange={(ev) => update(g.key, 'hsCode', ev.target.value.replace(/[^\d]/g, ''))} placeholder="08055020" className="font-mono" /></Field>
                {containers.length > 1 ? (
                  <Field label="Container"><Select value={g.containerNo} onChange={(ev) => update(g.key, 'containerNo', ev.target.value)}><option value="">—</option>{containers.map((c) => <option key={c}>{c}</option>)}</Select></Field>
                ) : <div />}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Packages" error={e.packages}><Input inputMode="numeric" value={g.packages} onChange={(ev) => update(g.key, 'packages', ev.target.value)} /></Field>
                <Field label="Kind"><Select value={g.packageKind} onChange={(ev) => update(g.key, 'packageKind', ev.target.value)}>{PACKAGE_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</Select></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Net weight (kg)" error={e.netWeightKg}><Input inputMode="decimal" value={g.netWeightKg} onChange={(ev) => update(g.key, 'netWeightKg', ev.target.value)} /></Field>
                <Field label="Gross weight (kg)" error={e.grossWeightKg}><Input inputMode="decimal" value={g.grossWeightKg} onChange={(ev) => update(g.key, 'grossWeightKg', ev.target.value)} /></Field>
              </div>
            </div>
          );
        })}
        <Button variant="tonal" onClick={() => setGoods([...goods, emptyGoods()])}><Plus className="size-4" /> Add goods line</Button>
        <div className="rounded-xl bg-surface-container px-3 py-2 text-sm tabular-nums">
          Total: {total('packages').toLocaleString('en')} packages · {kg(total('netWeightKg'))} net · {kg(gross)} gross
        </div>
        {gross > 0 && boxGross > 0 && Math.abs(gross - boxGross) > 1 && (
          <p className="flex items-start gap-2 rounded-xl bg-warning-container px-3 py-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Goods add up to {kg(gross)} gross, the containers to {kg(boxGross)}. Check against the B/L.
          </p>
        )}
      </div>
    </Card>
  );
}

function ReviewStep({ customer, parties, bl, containers, goods, freeTime, blFile, setBlFile, covers, setCovers, goTo }: {
  customer: { name: string; line: string; isNew: boolean }; parties: Parties; bl: Bl; containers: ({ no: string } & BoxDetail)[]; goods: Goods[]; freeTime: string;
  blFile: File | null; setBlFile: (f: File | null) => void; covers: string[]; setCovers: (v: string[]) => void; goTo: (step: number) => void;
}) {
  const edit = (s: number) => <Button size="sm" variant="ghost" onClick={() => goTo(s)}><Pencil className="size-4" /> Edit</Button>;
  return (
    <>
      <Card title="Consignee (customer)" actions={edit(0)}>
        <div className="flex items-center gap-3">
          <Avatar name={customer.name} />
          <div className="min-w-0">
            <p className="truncate font-medium">{customer.name} {customer.isNew && <Badge tone="brand">New</Badge>}</p>
            <p className="truncate text-sm text-on-surface-variant">{customer.line || '—'}</p>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-y-3 text-sm sm:grid-cols-2 sm:gap-x-4">
          <Item label="Shipper" value={parties.shipper.split('\n')[0] || '—'} />
          <Item label="Notify party" value={parties.notifySame ? 'Same as consignee' : parties.notifyParty.split('\n')[0] || '—'} />
        </dl>
      </Card>
      <Card title="Bill of lading" actions={edit(1)}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Item label="B/L" value={<span className="font-mono">{bl.blNo}</span>} />
          <Item label="Line" value={bl.shippingLineCode || '—'} />
          <Item label="Vessel / voyage" value={[bl.vessel, bl.voyage].filter(Boolean).join(' / ') || '—'} />
          <Item label="ETA" value={fmtDate(bl.eta)} />
          <Item label="Route" value={`${bl.portOfLoading || '—'} → ${bl.portOfDischarge || '—'}`} />
          <Item label="Freight" value={humanize(bl.freightTerms)} />
          <Item label="Free time" value={bl.freeTimeDays ? `${bl.freeTimeDays} days ${bl.freeTimeBasis === 'COMBINED' ? 'combined' : humanize(bl.freeTimeBasis).toLowerCase()}` : freeTime ? `ends ${fmtDate(freeTime)}` : '—'} />
          <Item label="Invoice" value={bl.invoiceValue ? `${bl.invoiceNo || '—'} · ${bl.invoiceCurrency} ${bl.invoiceValue}${bl.incoterm ? ` ${bl.incoterm}` : ''}` : bl.invoiceNo || '—'} />
        </dl>
      </Card>
      <Card title={`Containers · ${containers.length}`} actions={edit(2)}>
        <ul className="space-y-1.5 text-sm">
          {containers.map((c) => (
            <li key={c.no} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono font-medium">{c.no}</span>
              <span className="text-on-surface-variant">{[c.sizeType, c.sealNo && `seal ${c.sealNo}`, c.grossWeightKg && `${c.grossWeightKg} kg`, isReefer(c.sizeType) && c.reeferTempC && `${c.reeferTempC} °C`].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={`Goods · ${goods.length}`} actions={edit(2)}>
        <ul className="space-y-1.5 text-sm">
          {goods.map((g) => (
            <li key={g.key}>
              <span className="font-medium">{g.description}</span>
              <span className="text-on-surface-variant">{[g.hsCode && ` · HS ${g.hsCode}`, g.packages && ` · ${Number(g.packages).toLocaleString('en')} ${humanize(g.packageKind).toLowerCase()}s`, g.grossWeightKg && ` · ${g.grossWeightKg} kg`].filter(Boolean).join('')}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="B/L copy or document pack (optional)">
        <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-outline-variant px-4 py-3 text-sm text-on-surface-variant hover:border-primary">
          <Camera className="size-5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{blFile ? blFile.name : 'Take a photo or choose a PDF'}</span>
          {blFile && <button type="button" onClick={(e) => { e.preventDefault(); setBlFile(null); }} className="text-primary">Remove</button>}
          <input type="file" accept="application/pdf,image/*" capture="environment" className="hidden" onChange={(e) => setBlFile(e.target.files?.[0] ?? null)} />
        </label>
        {blFile && <div className="mt-3"><PackPicker main="BILL_OF_LADING" value={covers} onChange={setCovers} /></div>}
        <p className="mt-2 text-xs text-on-surface-variant">Shared with the customer in their portal. Needed before documents can be verified. A scanned pack can hold the invoice, packing list and certificates too.</p>
      </Card>
    </>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-on-surface-variant">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
