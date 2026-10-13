import { uuidv7 } from '@clearport/kernel';

export type EventType =
  | 'JobCreated' | 'JobUpdated' | 'ContainerAdded' | 'JobClosed' | 'JobReopened'
  | 'StageStatusChanged' | 'StageAssigned' | 'ContainerStagesSpawned'
  | 'DocumentUploaded' | 'CommentAdded'
  | 'DisbursementRecorded' | 'DisbursementReconciled' | 'InvoiceIssued'
  | 'CustomerApprovalRequested' | 'CustomerApprovalDecided'
  | 'TripAssigned' | 'FreeTimeExpiring' | 'SlaBreached';

export interface DomainEvent<P extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  type: EventType;
  tenantId: string;
  aggregateType: 'job' | 'trip' | 'invoice' | 'container' | 'customer';
  aggregateId: string;
  payload: P;
  occurredAt: string;
}

export const makeEvent = (tenantId: string, type: EventType, aggregateType: DomainEvent['aggregateType'], aggregateId: string, payload: Record<string, unknown>): DomainEvent => ({
  id: uuidv7(),
  type,
  tenantId,
  aggregateType,
  aggregateId,
  payload,
  occurredAt: new Date().toISOString(),
});
