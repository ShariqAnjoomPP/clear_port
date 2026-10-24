import { useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Check, Circle, Mail, MessageCircle, Package, Phone, Ship, Snowflake } from 'lucide-react';
import { api, ApiProblem } from '../lib/api';
import { daysUntil, fmtDate, fmtDateTime } from '../lib/format';
import i18n, { setLanguage } from '../lib/i18n';
import { Badge, Button, Card, Empty, Field, Input, ProblemAlert, Skeleton } from '../components/ui';

/**
 * Public tracking page: one link the agency shares with every customer. The customer types the mobile number the
 * agent has on file and sees their shipments. No login, no money, no documents (those stay in the token portal).
 */

type Agency = { name: string; phone: string | null; whatsapp: string | null; email: string | null };
type Shipment = {
  jobId: string; blNo: string; customerName: string; commodity: string; eta: string | null; ata: string | null; phase: string; status: string; progress: number;
  containersTotal: number; containersDelivered: number; updatedAt: string;
};
type Lookup = { trackToken: string; expiresAt: string; maskedPhone: string; customer: { name: string }; shipments: Shipment[] };
type ShipmentDetail = {
  jobId: string; blNo: string; commodity: string; vessel: string | null; voyage: string | null; portOfLoading: string | null; portOfDischarge: string | null;
  eta: string; ata: string | null; status: string | null;
  milestones: { key: string; label: string; done: boolean; current: boolean; at: string | null }[];
  containers: { containerNo: string; sizeType: string; status: string; delivered: boolean; deliveredAt: string | null; receiverName: string | null; freeTimeExpiresAt: string | null }[];
  goods: { description: string; packages: number | null; packageKind: string | null; container: string | null }[];
  updates: { at: string; text: string; container: string | null }[];
};

// ── the session lives in this tab only (sessionStorage), so a shared phone does not stay signed in ──
const KEY = 'clearport.track';
type Saved = { token: string; expiresAt: string; name: string; maskedPhone: string };
function loadSession(): Saved | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Saved | null;
    return s && new Date(s.expiresAt).getTime() > Date.now() ? s : null;
  } catch {
    return null;
  }
}
function saveSession(s: Saved | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the customer just enters the number again */
  }
}

const T = {
  en: {
    title: 'Track your shipment', intro: 'Enter the mobile number your clearing agent has on file.', phone: 'Mobile number', show: 'Show my shipments',
    hello: 'Hello', notYou: 'Not you?', open: 'In progress', done: 'Completed recently', none: 'No shipments right now.', eta: 'ETA', arrived: 'Arrived',
    delivered: 'delivered', of: 'of', containers: 'containers', back: 'All shipments', progress: 'Progress', boxes: 'Containers', goods: 'Goods', updates: 'Latest updates',
    freeEnds: 'Free time ends', receivedBy: 'received by', help: 'Questions about this shipment?', helpHome: 'Need help?', whatsapp: 'WhatsApp', call: 'Call', email: 'Email',
    query: 'Raise a query', ended: 'Your session has ended. Enter your mobile number again.',
  },
  ar: {
    title: 'تتبع شحنتك', intro: 'أدخل رقم الجوال المسجل لدى وكيل التخليص.', phone: 'رقم الجوال', show: 'عرض شحناتي',
    hello: 'مرحباً', notYou: 'لست أنت؟', open: 'قيد التنفيذ', done: 'مكتملة مؤخراً', none: 'لا توجد شحنات حالياً.', eta: 'الوصول المتوقع', arrived: 'وصلت',
    delivered: 'تم تسليمها', of: 'من', containers: 'حاويات', back: 'كل الشحنات', progress: 'التقدم', boxes: 'الحاويات', goods: 'البضائع', updates: 'آخر التحديثات',
    freeEnds: 'تنتهي المهلة المجانية', receivedBy: 'استلمها', help: 'لديك سؤال عن هذه الشحنة؟', helpHome: 'تحتاج مساعدة؟', whatsapp: 'واتساب', call: 'اتصال', email: 'بريد',
    query: 'إرسال استفسار', ended: 'انتهت الجلسة. أدخل رقم الجوال مرة أخرى.',
  },
};
const useT = () => T[i18n.language === 'ar' ? 'ar' : 'en'];

const useAgency = () => useQuery({ queryKey: ['track-agency'], queryFn: () => api.get<Agency>('/public/track/agency'), staleTime: Infinity });

function TrackFrame({ children, blNo }: { children: React.ReactNode; blNo?: string }) {
  const agency = useAgency();
  const [, rerender] = useState(0);
  return (
    <div className="min-h-dvh bg-surface pb-[calc(env(safe-area-inset-bottom)+96px)]">
      <header className="bg-secondary text-on-secondary">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Ship className="size-6 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{agency.data?.name ?? ' '}</p>
              <p className="text-xs opacity-80">{useT().title}</p>
            </div>
          </div>
          <button className="min-h-10 shrink-0 rounded-full px-3 text-sm font-medium ring-1 ring-white/40" onClick={() => { setLanguage(i18n.language === 'ar' ? 'en' : 'ar'); rerender((n) => n + 1); }}>
            {i18n.language === 'ar' ? 'English' : 'العربية'}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 pt-4">{children}</main>
      <ContactBar agency={agency.data} blNo={blNo} />
    </div>
  );
}

/** WhatsApp, call and email the agency; with a B/L, the message is already about that shipment. */
function ContactBar({ agency, blNo }: { agency: Agency | undefined; blNo?: string }) {
  const t = useT();
  if (!agency || (!agency.whatsapp && !agency.phone && !agency.email)) return null;
  const wa = (text: string) => `https://wa.me/${agency.whatsapp!.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
  const queryText = blNo ? `Hello, I have a query about my shipment B/L ${blNo}: ` : 'Hello, I have a question about my shipment: ';
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-outline-variant/60 bg-surface-container-low/95 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)] backdrop-blur">
      <div className="mx-auto max-w-xl">
        <p className="mb-1.5 text-xs text-on-surface-variant">{blNo ? t.help : t.helpHome}</p>
        <div className="flex gap-2">
          {agency.whatsapp && (
            <a href={wa(queryText)} target="_blank" rel="noreferrer" className="flex h-12 min-w-0 flex-[2] items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-on-primary">
              <MessageCircle className="size-5 shrink-0" /> <span className="truncate">{blNo ? t.query : t.whatsapp}</span>
            </a>
          )}
          {agency.phone && (
            <a href={`tel:${agency.phone.replace(/[^\d+]/g, '')}`} aria-label={t.call} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full border border-outline px-3 text-sm font-medium text-primary">
              <Phone className="size-5 shrink-0" /> <span className="hidden min-[400px]:inline">{t.call}</span>
            </a>
          )}
          {agency.email && (
            <a href={`mailto:${agency.email}?subject=${encodeURIComponent(blNo ? `B/L ${blNo}` : 'Shipment query')}`} aria-label={t.email} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full border border-outline px-3 text-sm font-medium text-primary">
              <Mail className="size-5 shrink-0" /> <span className="hidden min-[400px]:inline">{t.email}</span>
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}

/** /track: the number screen, then the customer's shipments. */
export function TrackPage() {
  const t = useT();
  const [session, setSession] = useState<Saved | null>(loadSession);
  const [phone, setPhone] = useState('+968 ');
  const lookup = useMutation({
    mutationFn: () => api.post<Lookup>('/public/track/lookup', { phone }),
    onSuccess: (r) => {
      const s = { token: r.trackToken, expiresAt: r.expiresAt, name: r.customer.name, maskedPhone: r.maskedPhone };
      saveSession(s);
      setSession(s);
    },
  });
  const signOut = () => { saveSession(null); setSession(null); lookup.reset(); };

  return (
    <TrackFrame>
      {!session ? (
        <Card>
          <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 text-sm text-on-surface-variant">{t.intro}</p>
          <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); lookup.mutate(); }}>
            <Field label={t.phone}><Input id="track-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+968 9xxx xxxx" /></Field>
            <Button type="submit" size="lg" variant="primary" className="w-full" loading={lookup.isPending}>{t.show}</Button>
          </form>
          <div className="mt-3"><ProblemAlert error={lookup.error} /></div>
        </Card>
      ) : (
        <ShipmentList session={session} onSignOut={signOut} />
      )}
    </TrackFrame>
  );
}

const useShipments = (session: Saved) =>
  useQuery({ queryKey: ['track', session.token], queryFn: () => api.get<{ items: Shipment[] }>('/public/track/shipments', { headers: { 'x-track-token': session.token } }).then((r) => r.items), retry: false });

function ShipmentList({ session, onSignOut }: { session: Saved; onSignOut: () => void }) {
  const t = useT();
  const list = useShipments(session);
  if (list.error instanceof ApiProblem && list.error.status === 401) {
    onSignOut();
    return null;
  }
  const open = (list.data ?? []).filter((s) => s.phase !== 'CLOSED');
  const closed = (list.data ?? []).filter((s) => s.phase === 'CLOSED');
  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-on-surface-variant">{t.hello},</p>
          <h1 className="text-xl font-semibold tracking-tight">{session.name}</h1>
          <p className="text-xs text-on-surface-variant tabular-nums">{session.maskedPhone}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onSignOut}>{t.notYou}</Button>
      </div>
      {list.isLoading ? <Skeleton className="h-40" /> : !list.data?.length ? (
        <Card><Empty icon={<Package className="size-7" />} title={t.none} /></Card>
      ) : (
        <div className="space-y-5">
          {open.length > 0 && <Section title={t.open} items={open} />}
          {closed.length > 0 && <Section title={t.done} items={closed} />}
        </div>
      )}
    </>
  );
}

function Section({ title, items }: { title: string; items: Shipment[] }) {
  const t = useT();
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-on-surface-variant">{title}</h2>
      <div className="space-y-3">
        {items.map((s) => (
          <Link key={s.jobId} to="/track/$jobId" params={{ jobId: s.jobId }} className="block rounded-[var(--radius-card)] border border-outline-variant/60 bg-surface-container-lowest p-4 active:bg-surface-container">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-lg font-semibold">{s.blNo}</p>
                <p className="line-clamp-2 text-sm text-on-surface-variant">{s.commodity}</p>
              </div>
              <Badge tone={s.phase === 'CLOSED' || s.phase === 'READY_TO_CLOSE' ? 'ok' : 'info'}>{s.status}</Badge>
            </div>
            <Bar value={s.progress} />
            <p className="mt-2 text-sm text-on-surface-variant">
              {s.ata ? `${t.arrived} ${fmtDate(s.ata)}` : s.eta ? `${t.eta} ${fmtDate(s.eta)}` : ''} · {s.containersDelivered} {t.of} {s.containersTotal} {t.containers} {t.delivered}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

const Bar = ({ value }: { value: number }) => (
  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-container-high" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
    <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
  </div>
);

/** /track/$jobId: one shipment. */
export function TrackShipmentPage() {
  const t = useT();
  const navigate = useNavigate();
  const { jobId } = useParams({ strict: false }) as { jobId: string };
  const session = loadSession();
  const detail = useQuery({
    queryKey: ['track', session?.token, jobId],
    queryFn: () => api.get<ShipmentDetail>(`/public/track/shipments/${jobId}`, { headers: { 'x-track-token': session!.token } }),
    enabled: !!session, retry: false,
  });
  if (!session || (detail.error instanceof ApiProblem && detail.error.status === 401)) {
    saveSession(null);
    void navigate({ to: '/track', replace: true });
    return null;
  }
  const d = detail.data;
  return (
    <TrackFrame blNo={d?.blNo}>
      <Link to="/track" className="mb-3 inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary"><ArrowLeft className="size-4 rtl:rotate-180" /> {t.back}</Link>
      {detail.isLoading ? <Skeleton className="h-64" /> : !d ? <ProblemAlert error={detail.error} /> : (
        <div className="space-y-4">
          <section className="rounded-[var(--radius-card)] bg-secondary-container p-4 text-on-secondary-container">
            <p className="font-mono text-2xl font-semibold">{d.blNo}</p>
            <p className="text-sm">{d.commodity}</p>
            {d.status && <p className="mt-2 inline-block rounded-lg bg-white/60 px-2 py-0.5 text-sm font-medium">{d.status}</p>}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {d.vessel && <Info label="Vessel" value={[d.vessel, d.voyage].filter(Boolean).join(' / ')} />}
              <Info label={d.ata ? t.arrived : t.eta} value={fmtDate(d.ata ?? d.eta)} />
              {(d.portOfLoading || d.portOfDischarge) && <Info label="Route" value={`${d.portOfLoading ?? '—'} → ${d.portOfDischarge ?? '—'}`} />}
            </dl>
          </section>

          <Card title={t.progress}>
            <ol className="space-y-3">
              {d.milestones.map((m) => (
                <li key={m.key} className="flex items-start gap-3">
                  <span className={clsx('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full', m.done ? 'bg-primary text-on-primary' : m.current ? 'ring-2 ring-primary text-primary' : 'text-outline')}>
                    {m.done ? <Check className="size-4" /> : <Circle className={clsx('size-3', m.current && 'fill-current')} />}
                  </span>
                  <div className="min-w-0">
                    <p className={clsx('text-sm', m.done || m.current ? 'font-medium' : 'text-on-surface-variant')}>{m.label}</p>
                    {m.at && <p className="text-xs text-on-surface-variant">{fmtDateTime(m.at)}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card title={`${t.boxes} · ${d.containers.length}`}>
            <ul className="divide-y divide-outline-variant/50">
              {d.containers.map((c) => {
                const left = daysUntil(c.freeTimeExpiresAt);
                return (
                  <li key={c.containerNo} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 font-mono font-medium">{c.containerNo}{/R[FH]$/.test(c.sizeType) && <Snowflake className="size-4 text-info-role" aria-label="Reefer" />}</p>
                      <Badge tone={c.delivered ? 'ok' : 'info'}>{c.status}</Badge>
                    </div>
                    <p className="text-sm text-on-surface-variant">
                      {c.sizeType}
                      {c.delivered && c.deliveredAt && ` · ${fmtDate(c.deliveredAt)}${c.receiverName ? `, ${t.receivedBy} ${c.receiverName}` : ''}`}
                      {!c.delivered && c.freeTimeExpiresAt && <span className={clsx(left !== null && left <= 2 && 'font-medium text-warning')}> · {t.freeEnds} {fmtDate(c.freeTimeExpiresAt)}</span>}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>

          {d.goods.length > 0 && (
            <Card title={t.goods}>
              <ul className="space-y-1.5 text-sm">
                {d.goods.map((g, i) => (
                  <li key={i}><span className="font-medium">{g.description}</span>{g.packages ? <span className="text-on-surface-variant"> · {g.packages.toLocaleString('en')} {(g.packageKind ?? 'piece').toLowerCase()}s</span> : null}</li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={t.updates}>
            <ol className="relative space-y-3 border-s border-outline-variant ps-4">
              {d.updates.map((u, i) => (
                <li key={i} className="relative">
                  <span className={clsx('absolute -start-[21px] top-1.5 size-2.5 rounded-full', i === 0 ? 'bg-primary' : 'bg-outline-variant')} />
                  <p className="text-sm">{u.text}{u.container && <span className="ms-1 font-mono text-xs text-on-surface-variant">{u.container}</span>}</p>
                  <p className="text-xs text-on-surface-variant">{fmtDateTime(u.at)}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
    </TrackFrame>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs opacity-75">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
