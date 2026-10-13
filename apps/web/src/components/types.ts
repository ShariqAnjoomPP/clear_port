export type I18n = { en: string; ar: string };
export type NextStep = { to: string; label: I18n; primary: boolean; requiredFields: string[]; requiresDocument: string | null; gateOpen: boolean; waitingFor: string[] };
export type StageField = { key: string; label: I18n; type: 'text' | 'date' | 'datetime' | 'textarea' | 'containers' | 'signature' };
export type StageView = {
  id: string; key: string; level: 'JOB' | 'CONTAINER'; order: number; phase: string; label: I18n; ownerRole: string;
  status: string; statusLabel: I18n; done: boolean; fields: StageField[];
  assignee: { id: string; name: string } | null; referenceNo: string | null; data: Record<string, unknown>;
  startedAt: string | null; completedAt: string | null; slaDueAt: string | null; overdue: boolean; version: number; nextSteps: NextStep[];
};
export type StagesResponse = { workflowVersion: number; jobStages: StageView[]; containerStages: Record<string, StageView[]> };
export type Container = { id: string; containerNo: string; sizeType: string; sealNo: string | null; grossWeightKg: string | null; packages: number | null; freeTimeExpiresAt: string | null; active: boolean };
export type Disbursement = { id: string; feeType: string; description: string | null; amount: string; currency: string; paymentMethod: string; paidOn: string; paidByName: string; billable: boolean; status: string; stageKey: string | null; receiptDocumentId: string | null; invoiceId: string | null; createdAt: string; jobNo?: string; blNo?: string; customerName?: string; jobId: string };
export type Trip = { id: string; tripNo: string; status: string; driverName: string; driverPhone: string; plateNo: string; deliveryAddress: string; deliveryWindow: string | null; containerIds?: string[]; containers?: string[]; createdAt: string; cost: string | null; currency: string | null; jobNo?: string; blNo?: string; customerName?: string; jobId: string };
export type JobDetail = {
  id: string; jobNo: string; blNo: string; status: string; priority: string; eta: string; ata: string | null; vessel: string | null; voyage: string | null; shippingLineCode: string | null;
  portOfLoading: string | null; portOfDischarge: string | null; terminal: string | null; commodity: string; hsCodes: string[]; shippingDetails: string | null; createdAt: string; closedAt: string | null; version: number;
  coordinator: { id: string; name: string } | null; customer: { id: string; name: string; preferredChannel: string; creditDays: number } | null;
  containers: Container[]; documents: { id: string; docType: string; fileName: string; contentType: string; sizeBytes: number; customerVisible: boolean; createdAt: string; uploadedByName: string | null; containerId: string | null }[];
  stages: StagesResponse; finance: { totals: { currency: string; paid: string; billable: string; unreconciled: number; uninvoiced: number }[]; payments: Disbursement[] };
  trips: Trip[]; invoices: { id: string; invoiceNo: string; status: string; total: string; currency: string; issueDate: string }[];
  permissions: Record<'update' | 'close' | 'reopen' | 'assign' | 'upload' | 'pay' | 'reconcile' | 'invoice' | 'trips', boolean>;
};
