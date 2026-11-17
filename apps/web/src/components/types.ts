export type I18n = { en: string; ar: string };
export type NextStep = { to: string; label: I18n; primary: boolean; requiredFields: string[]; requiresDocument: string | null; gateOpen: boolean; waitingFor: string[] };
export type StageField = { key: string; label: I18n; type: 'text' | 'date' | 'datetime' | 'textarea' | 'containers' | 'signature' };
export type StageView = {
  id: string; key: string; level: 'JOB' | 'CONTAINER'; order: number; phase: string; label: I18n; ownerRole: string;
  status: string; statusLabel: I18n; done: boolean; fields: StageField[]; statuses: { key: string; label: I18n; done?: boolean }[];
  assignee: { id: string; name: string; role: string } | null; referenceNo: string | null; data: Record<string, unknown>;
  startedAt: string | null; completedAt: string | null; slaDueAt: string | null; overdue: boolean; nextSteps: NextStep[];
};
export type StagesResponse = { workflowVersion: number; jobStages: StageView[]; containerStages: Record<string, StageView[]> };
export type Container = {
  id: string; containerNo: string; sizeType: string; sealNo: string | null; grossWeightKg: string | null; packages: number | null; packageKind: string | null;
  volumeCbm: string | null; reeferTempC: string | null; ventilation: string | null; freeTimeExpiresAt: string | null; freeTimeManual: boolean; active: boolean;
};
/** One goods line on the B/L. */
export type CargoLine = {
  id: string; lineNo: number; containerId: string | null; description: string; hsCode: string | null; packages: number | null; packageKind: string | null;
  netWeightKg: string | null; grossWeightKg: string | null; volumeCbm: string | null; originCountry: string | null;
};
export type CargoTotals = { lines: number; packages: number; netWeightKg: number; grossWeightKg: number; volumeCbm: number; warnings: string[] };
export type Disbursement = { id: string; feeType: string; description: string | null; amount: string; currency: string; paymentMethod: string; paidOn: string; paidByName: string; paidByStaffId: string | null; reversesId: string | null; billable: boolean; status: string; stageKey: string | null; receiptDocumentId: string | null; invoiceId: string | null; createdAt: string; jobNo?: string; blNo?: string; customerName?: string; jobId: string };
export type Trip = { id: string; tripNo: string; status: string; driverName: string; driverPhone: string | null; plateNo: string; hasLink: boolean; deliveryAddress: string; deliveryWindow: string | null; containerIds?: string[]; containers?: string[]; createdAt: string; cost: string | null; currency: string | null; jobNo?: string; blNo?: string; customerName?: string; jobId: string };
export type DocumentItem = { id: string; docType: string; covers: string[]; referenceNo: string | null; issueDate: string | null; fileName: string; contentType: string; sizeBytes: number; customerVisible: boolean; createdAt: string; uploadedByName: string | null; containerId: string | null };
/** Everything the job screen shows. */
export type JobDetail = {
  id: string; jobNo: string; blNo: string; status: string; priority: string; eta: string; ata: string | null; vessel: string | null; voyage: string | null; shippingLineCode: string | null;
  portOfLoading: string | null; portOfDischarge: string | null; terminal: string | null; commodity: string; hsCodes: string[]; shippingDetails: string | null; createdAt: string; closedAt: string | null;
  customerId: string; coordinator: { id: string; name: string } | null; customer: { id: string; name: string; address: string | null; preferredChannel: string; creditDays: number } | null;
  // As printed on the carrier's B/L
  bookingNo: string | null; serviceContract: string | null; shipper: string | null; notifyParty: string | null; placeOfReceipt: string | null; placeOfDelivery: string | null;
  placeOfIssue: string | null; blIssueDate: string | null; shippedOnBoardDate: string | null; originalsCount: number | null; freightTerms: string | null; serviceType: string | null;
  freeTimeDays: number | null; freeTimeBasis: string; invoiceNo: string | null; invoiceDate: string | null; invoiceValue: string | null; invoiceCurrency: string | null;
  incoterm: string | null; countryOfOrigin: string | null; cargoLines: CargoLine[]; cargoTotals: CargoTotals;
  containers: Container[]; documents: DocumentItem[]; stages: StagesResponse; trips: Trip[];
  finance: { totals: { currency: string; paid: string; billable: string; unreconciled: number; uninvoiced: number }[]; payments: Disbursement[] };
  invoices: { id: string; invoiceNo: string; status: string; total: string; currency: string; issueDate: string }[];
};
/** One row per job in lists (and later the board). */
export type JobSummary = {
  jobId: string; jobNo: string; blNo: string; customerId: string; customerName: string; phase: string; eta: string | null; priority: string;
  coordinatorId: string | null; coordinatorName: string | null; containersTotal: number; containersDelivered: number; stages: Record<string, string>;
  nextSlaDueAt: string | null; overdue: boolean; freeTimeNext: string | null; updatedAt: string;
};
