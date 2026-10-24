import { z } from 'zod';
import { ApprovalDecisionInput, TrackLookupInput } from '@clearport/contracts';
import { db, transaction } from '../../lib/db';
import { fileStore } from '../../lib/files';
import { createFunction, parseBody } from '../../lib/http';
import { decideApproval } from '../engagement/approvals';
import { approvalByToken, approvalForCustomer, customerByPortalToken, pendingApprovals, portalDocument, portalJob } from '../engagement/service';
import { driverTransition, driverView, tripView } from '../fieldops/service';
import { jobSummaries } from '../jobs/service';
import { ApiError } from '../../lib/errors';
import { signTrackToken, verifyTrackToken } from '../../lib/tokens';
import { clientAddress } from '../../lib/throttle';
import { agencyContact, customersByPhone, maskPhone, throttleLookup, trackShipment, trackShipments } from './tracking';

/**
 * No-login pages reached by link: the driver's trip, the customer's charge approval, and the customer portal.
 * The unguessable token in the URL is the only credential, and it opens only that trip, approval or customer.
 */
const app = createFunction({ public: true });

// ── Driver trip ──
app.get('/trips/:token', async (c) => c.json(await driverView(db, c.req.param('token'))));

app.post('/trips/:token/stages/:stageId/transitions', async (c) => {
  const input = await parseBody(c, z.object({ to: z.string().min(2).max(40), fields: z.record(z.string(), z.unknown()).default({}), remarks: z.string().trim().max(500).optional() }));
  const tripId = await transaction((tx) => driverTransition(tx, c.req.param('token'), c.req.param('stageId'), input));
  return c.json(await tripView(db, tripId));
});

// ── Charge approval (one tap from WhatsApp / email) ──
app.get('/approvals/:token', async (c) => {
  const a = await approvalByToken(db, c.req.param('token'));
  return c.json({ status: a.status, summary: a.summary, expiresAt: a.expiresAt, decidedAt: a.decidedAt });
});

app.post('/approvals/:token/decision', async (c) => {
  const { decision, note } = await parseBody(c, ApprovalDecisionInput);
  await transaction(async (tx) => decideApproval(tx, await approvalByToken(tx, c.req.param('token')), decision, 'Customer (link)', note));
  return c.json({ ok: true });
});

// ── Customer portal ──
const PHASE_FOR_CUSTOMER: Record<string, string> = {
  DOCUMENTS: 'Documents received', CLEARANCE: 'Customs clearance in progress', CCRO: 'Awaiting release', DELIVERY: 'Delivering', READY_TO_CLOSE: 'Delivered', CLOSED: 'Completed',
};

app.get('/portal/:token', async (c) => {
  const cust = await customerByPortalToken(db, c.req.param('token'));
  const jobs = await jobSummaries(db, { customerId: cust.id });
  return c.json({
    customer: { name: cust.name, language: cust.language },
    jobs: jobs.map((j) => ({ jobId: j.jobId, jobNo: j.jobNo, blNo: j.blNo, eta: j.eta, phase: j.phase, phaseLabel: PHASE_FOR_CUSTOMER[j.phase], containersTotal: j.containersTotal, containersDelivered: j.containersDelivered, updatedAt: j.updatedAt })),
    approvals: await pendingApprovals(db, { customerId: cust.id }),
  });
});

app.get('/portal/:token/jobs/:jobId', async (c) => {
  const cust = await customerByPortalToken(db, c.req.param('token'));
  const detail = await portalJob(db, cust.id, c.req.param('jobId'));
  const [summary] = (await jobSummaries(db, { customerId: cust.id })).filter((j) => j.jobId === detail.jobId);
  return c.json({ ...detail, phase: summary?.phase, phaseLabel: summary ? PHASE_FOR_CUSTOMER[summary.phase] : undefined });
});

app.get('/portal/:token/documents/:id', async (c) => {
  const cust = await customerByPortalToken(db, c.req.param('token'));
  const doc = await portalDocument(db, cust.id, c.req.param('id'));
  return c.body(new Uint8Array(await fileStore.get(doc.storageKey)), 200, {
    'content-type': doc.contentType,
    'content-disposition': `inline; filename="${encodeURIComponent(doc.fileName)}"`,
    'cache-control': 'private, max-age=60',
  });
});

app.post('/portal/:token/approvals/:id/decision', async (c) => {
  const cust = await customerByPortalToken(db, c.req.param('token'));
  const { decision, note } = await parseBody(c, ApprovalDecisionInput);
  const by = cust.contacts[0]?.name ?? cust.name;
  await transaction(async (tx) => decideApproval(tx, await approvalForCustomer(tx, cust.id, c.req.param('id')), decision, by, note));
  return c.json({ ok: true });
});

// ── Tracking page (/track): one public page, the customer's mobile number opens their shipments ──
app.get('/track/agency', async (c) => c.json(await agencyContact(db)));

app.post('/track/lookup', async (c) => {
  throttleLookup(clientAddress(c.req.header('x-forwarded-for')));
  const { phone } = await parseBody(c, TrackLookupInput);
  const customers = await customersByPhone(db, phone);
  // Same answer whether the number is unknown or has nothing to show.
  if (!customers.length) throw new ApiError(404, 'Not found', "We couldn't find shipments for this number. Check the number, or contact your agent.");
  const { token, expiresAt } = signTrackToken(customers.map((x) => x.id));
  return c.json({
    trackToken: token, expiresAt, maskedPhone: maskPhone(phone),
    customer: { name: customers.map((x) => x.name).join(', ') },
    shipments: await trackShipments(db, customers.map((x) => x.id)),
  });
});

const trackCustomers = (token: string | undefined) => {
  const ids = verifyTrackToken(token);
  if (!ids) throw new ApiError(401, 'Unauthorized', 'Your session has ended. Enter your mobile number again.');
  return ids;
};
app.get('/track/shipments', async (c) => c.json({ items: await trackShipments(db, trackCustomers(c.req.header('x-track-token'))) }));
app.get('/track/shipments/:jobId', async (c) => c.json(await trackShipment(db, trackCustomers(c.req.header('x-track-token')), c.req.param('jobId'))));

export default app;
