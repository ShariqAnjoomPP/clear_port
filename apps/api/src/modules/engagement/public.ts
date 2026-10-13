import { eq } from 'drizzle-orm';
import { formatMoney, uuidv7 } from '@clearport/kernel';
import { config } from '../../config';
import { hashToken, newLinkToken } from '../../shared/auth';
import type { Actor } from '../../shared/context';
import type { Tx, UnitOfWork } from '../../shared/db';
import { makeEvent } from '../../shared/events';
import { customerApproval, notification } from '../../shared/schema';
import { getCustomer, getCustomerContacts } from '../customer/public';
import { jobFinanceSummary, listJobDisbursements } from '../finance/public';
import { render } from './templates';

/** Engagement context — public facade. */
export interface QueueInput {
  tenantId: string;
  channel: 'IN_APP' | 'WHATSAPP' | 'EMAIL' | 'SMS';
  recipient: string;
  userId?: string | null;
  jobId?: string | null;
  template: string;
  lang?: string;
  vars: Record<string, string | number | undefined>;
  link?: string;
  dedupeKey: string;
}

/** Queues a message; the dispatcher sends it (in-app messages are delivered immediately). Deduplicated per key. */
export async function queueNotification(tx: Tx, n: QueueInput) {
  const { title, body } = render(n.template, n.lang ?? 'en', n.vars);
  await tx
    .insert(notification)
    .values({
      id: uuidv7(), tenantId: n.tenantId, channel: n.channel, recipient: n.recipient, userId: n.userId ?? null, jobId: n.jobId ?? null,
      template: n.template, title, body, payload: { vars: n.vars, link: n.link }, status: n.channel === 'IN_APP' ? 'SENT' : 'QUEUED',
      sentAt: n.channel === 'IN_APP' ? new Date() : null, dedupeKey: n.dedupeKey,
    })
    .onConflictDoNothing();
}

/** Notifies the customer's contacts on their preferred channel, honouring WhatsApp opt-in (consent). */
export async function notifyCustomer(tx: Tx, tenantId: string, customerId: string, jobId: string, template: string, vars: QueueInput['vars'], dedupeKey: string, link?: string) {
  const cust = await getCustomer(tx, customerId);
  if (!cust) return;
  for (const ct of await getCustomerContacts(tx, customerId)) {
    const useWhatsApp = cust.preferredChannel === 'WHATSAPP' && ct.whatsappOptIn && ct.phone;
    const channel = useWhatsApp ? 'WHATSAPP' : ct.email ? 'EMAIL' : ct.phone ? 'SMS' : null;
    if (!channel) continue;
    await queueNotification(tx, {
      tenantId, channel, recipient: (channel === 'EMAIL' ? ct.email : ct.phone)!, jobId, template, lang: cust.language, vars, link, dedupeKey: `${dedupeKey}:${ct.id}`,
    });
  }
}

/** BAY-005: when charges are sent, the customer gets a one-tap approval link (token hash stored, 7-day expiry). */
export async function requestCustomerApproval(tx: Tx, uow: UnitOfWork, actor: Actor, job: { id: string; tenantId: string; jobNo: string; blNo: string; customerId: string }, stageInstanceId: string) {
  const summary = await jobFinanceSummary(tx, job.id);
  const lines = (await listJobDisbursements(tx, job.id)).filter((d) => d.billable && d.status !== 'REVERSED').map((d) => ({ feeType: d.feeType, stageKey: d.stageKey, amount: d.amount, currency: d.currency, description: d.description }));
  const token = newLinkToken();
  const id = uuidv7();
  await tx.insert(customerApproval).values({
    id, tenantId: job.tenantId, jobId: job.id, stageInstanceId, tokenHash: await hashToken(token), status: 'PENDING',
    summary: { blNo: job.blNo, jobNo: job.jobNo, lines, totals: summary.map((s) => ({ currency: s.currency, amount: s.billable })) },
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  });
  const total = summary.map((s) => formatMoney({ amount: s.billable, currency: s.currency })).join(' + ') || '—';
  const link = `${config.PUBLIC_APP_URL}/approve/${token}`;
  await notifyCustomer(tx, job.tenantId, job.customerId, job.id, 'APPROVAL_REQUEST', { blNo: job.blNo, jobNo: job.jobNo, total }, `approval:${id}`, link);
  uow.emit(makeEvent(job.tenantId, 'CustomerApprovalRequested', 'job', job.id, { jobId: job.id, approvalId: id, requestedBy: actor.name }));
  return id;
}

export async function getApproval(tx: Tx, id: string) {
  const [a] = await tx.select().from(customerApproval).where(eq(customerApproval.id, id));
  return a;
}
