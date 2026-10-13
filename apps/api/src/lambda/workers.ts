import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { boot, CONSUMERS } from '../composition';
import { deliver, relayOutbox } from '../shared/bus';
import type { DomainEvent } from '../shared/events';
import { dispatchAllTenants } from '../modules/engagement/dispatcher';
import { scanFreeTime, scanSlaBreaches } from '../workers/timers';

boot();

/** SQS consumer: one queue per consumer, partial batch failures so one bad message never blocks the rest. */
const sqsConsumer = (consumer: (typeof CONSUMERS)[keyof typeof CONSUMERS]) => async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    try {
      const envelope = JSON.parse(record.body) as { detail: DomainEvent };
      await deliver(consumer, envelope.detail);
    } catch (e) {
      console.error(JSON.stringify({ level: 'error', consumer: consumer.name, messageId: record.messageId, message: (e as Error).message }));
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
};

export const projector = sqsConsumer(CONSUMERS.jobBoardProjector);
export const notifier = sqsConsumer(CONSUMERS.notifier);
export const approvals = sqsConsumer(CONSUMERS.approvalToWorkflow);
export const tripProgress = sqsConsumer(CONSUMERS.tripProgress);

/** Scheduled (EventBridge Scheduler). */
export const outboxRelay = async () => ({ relayed: await relayOutbox() });
export const timers = async () => ({ sla: await scanSlaBreaches(), freeTime: await scanFreeTime() });
export const dispatcher = async () => {
  await dispatchAllTenants();
  return { ok: true };
};
