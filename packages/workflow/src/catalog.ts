import type { StageDef, WorkflowDefinition } from './types';

const t = (en: string, ar: string) => ({ en, ar });

/**
 * Default catalogue v1 — mirrors the client's "Delivery Clearance Process" sketches (BRD section 4 and 7):
 * two parallel tracks per BL (customs: Bayan → customer → inspection; shipping line: DO) that meet at the
 * CCRO gate, then container-level execution (truck → physical inspection → release → delivery).
 */
export const DEFAULT_STAGES: StageDef[] = [
  {
    key: 'DOCUMENTS', level: 'JOB', order: 1, phase: 'DOCUMENTS', ownerRole: 'COORDINATOR',
    label: t('Documents received', 'استلام المستندات'),
    statuses: [
      { key: 'DRAFT', label: t('Draft', 'مسودة') },
      { key: 'RECEIVED', label: t('Received', 'مستلم') },
      { key: 'VERIFIED', label: t('Verified', 'تم التحقق'), done: true },
    ],
    initial: 'DRAFT', slaHours: 24,
    transitions: [
      { from: ['DRAFT'], to: 'RECEIVED', label: t('Mark received', 'تأكيد الاستلام'), primary: true },
      { from: ['RECEIVED'], to: 'VERIFIED', label: t('Verify documents', 'التحقق من المستندات'), requiresDocument: 'BILL_OF_LADING', primary: true },
    ],
  },
  {
    key: 'BAYAN', level: 'JOB', order: 2, phase: 'CUSTOMS', ownerRole: 'PRO',
    label: t('Bayan (customs declaration)', 'البيان الجمركي'),
    statuses: [
      { key: 'NOT_STARTED', label: t('Not started', 'لم يبدأ') },
      { key: 'FILED', label: t('Filed', 'تم التقديم') },
      { key: 'QUERY_RAISED', label: t('Query raised', 'استفسار') },
      { key: 'APPROVED', label: t('Approved', 'معتمد') },
      { key: 'DUTIES_PAID', label: t('Duties paid', 'تم دفع الرسوم'), done: true },
    ],
    initial: 'NOT_STARTED', slaHours: 48,
    fields: [{ key: 'referenceNo', label: t('Bayan no.', 'رقم البيان'), type: 'text' }],
    transitions: [
      {
        from: ['NOT_STARTED'], to: 'FILED', label: t('File Bayan', 'تقديم البيان'), primary: true, requiredFields: ['referenceNo'],
        guard: { all: [{ stage: 'DOCUMENTS', statusIn: ['VERIFIED'] }, { assigned: true }] },
      },
      { from: ['FILED'], to: 'QUERY_RAISED', label: t('Query raised', 'استفسار من الجمارك') },
      { from: ['QUERY_RAISED'], to: 'FILED', label: t('Query answered', 'تم الرد على الاستفسار'), primary: true },
      { from: ['FILED'], to: 'APPROVED', label: t('Approved / duty assessed', 'معتمد / تم تقدير الرسوم'), primary: true },
      { from: ['APPROVED'], to: 'DUTIES_PAID', label: t('Duties paid', 'تم دفع الرسوم'), primary: true },
    ],
  },
  {
    key: 'CUSTOMER_COMM', level: 'JOB', order: 3, phase: 'CUSTOMS', ownerRole: 'COORDINATOR',
    label: t('Customer confirmation', 'تأكيد العميل'),
    statuses: [
      { key: 'PENDING', label: t('Pending', 'قيد الانتظار') },
      { key: 'SENT', label: t('Sent to customer', 'أرسل للعميل') },
      { key: 'CONFIRMED', label: t('Confirmed', 'مؤكد'), done: true },
    ],
    initial: 'PENDING', slaHours: 24,
    transitions: [
      {
        from: ['PENDING'], to: 'SENT', label: t('Send charges to customer', 'إرسال الرسوم للعميل'), primary: true,
        guard: { stage: 'BAYAN', statusIn: ['APPROVED', 'DUTIES_PAID'] },
      },
      { from: ['SENT'], to: 'CONFIRMED', label: t('Customer confirmed', 'أكد العميل'), primary: true },
      { from: ['SENT'], to: 'PENDING', label: t('Customer disputed charges', 'اعترض العميل على الرسوم') },
    ],
    onEnter: { SENT: ['REQUEST_CUSTOMER_APPROVAL'] },
  },
  {
    key: 'INSPECTION', level: 'JOB', order: 4, phase: 'CUSTOMS', ownerRole: 'PRO',
    label: t('Customs inspection', 'التفتيش الجمركي'),
    statuses: [
      { key: 'AWAITING', label: t('Awaiting result', 'بانتظار النتيجة') },
      { key: 'CLEARED', label: t('Cleared — no inspection', 'مفسوح بدون تفتيش'), done: true },
      { key: 'REQUIRED', label: t('Inspection required', 'مطلوب تفتيش') },
      { key: 'COMPLETED', label: t('Completed', 'مكتمل'), done: true },
    ],
    initial: 'AWAITING', slaHours: 48,
    fields: [
      { key: 'selectedContainerIds', label: t('Containers selected for physical inspection', 'الحاويات المختارة للتفتيش'), type: 'containers' },
      { key: 'remarks', label: t('Comments', 'ملاحظات'), type: 'textarea' },
    ],
    transitions: [
      {
        from: ['AWAITING'], to: 'CLEARED', label: t('Cleared, no inspection', 'مفسوح بدون تفتيش'), primary: true,
        guard: { all: [{ stage: 'BAYAN', statusIn: ['DUTIES_PAID'] }, { stage: 'CUSTOMER_COMM', statusIn: ['CONFIRMED'] }] },
      },
      {
        from: ['AWAITING'], to: 'REQUIRED', label: t('Inspection required', 'مطلوب تفتيش'), requiredFields: ['selectedContainerIds'],
        guard: { all: [{ stage: 'BAYAN', statusIn: ['DUTIES_PAID'] }, { stage: 'CUSTOMER_COMM', statusIn: ['CONFIRMED'] }] },
      },
      { from: ['REQUIRED'], to: 'COMPLETED', label: t('Customs formalities completed', 'اكتملت الإجراءات'), primary: true },
    ],
  },
  {
    key: 'DO', level: 'JOB', order: 5, phase: 'DO', ownerRole: 'PRO',
    label: t('Delivery order (DO)', 'إذن التسليم'),
    statuses: [
      { key: 'NOT_STARTED', label: t('Not started', 'لم يبدأ') },
      { key: 'APPLIED', label: t('Applied', 'تم التقديم') },
      { key: 'CHARGES_PAID', label: t('Line charges paid', 'تم دفع رسوم الخط') },
      { key: 'DO_RECEIVED', label: t('DO received', 'تم استلام الإذن'), done: true },
    ],
    initial: 'NOT_STARTED', slaHours: 72,
    fields: [
      { key: 'referenceNo', label: t('DO no.', 'رقم الإذن'), type: 'text' },
      { key: 'validUntil', label: t('DO valid until', 'صالح حتى'), type: 'date' },
    ],
    transitions: [
      {
        from: ['NOT_STARTED'], to: 'APPLIED', label: t('Apply for DO', 'تقديم طلب الإذن'), primary: true,
        guard: { all: [{ stage: 'DOCUMENTS', statusIn: ['VERIFIED'] }, { assigned: true }] },
      },
      { from: ['APPLIED'], to: 'CHARGES_PAID', label: t('Line charges paid', 'تم دفع رسوم الخط'), primary: true },
      { from: ['CHARGES_PAID'], to: 'DO_RECEIVED', label: t('DO received', 'تم استلام الإذن'), primary: true, requiredFields: ['referenceNo', 'validUntil'] },
    ],
  },
  {
    key: 'CCRO', level: 'JOB', order: 6, phase: 'CCRO', ownerRole: 'PRO',
    label: t('CCRO (release order)', 'أمر الإفراج'),
    statuses: [
      { key: 'NOT_STARTED', label: t('Not started', 'لم يبدأ') },
      { key: 'APPLIED', label: t('Applied', 'تم التقديم') },
      { key: 'ISSUED', label: t('Issued', 'صدر'), done: true },
    ],
    initial: 'NOT_STARTED', slaHours: 24,
    fields: [{ key: 'referenceNo', label: t('CCRO no.', 'رقم الأمر'), type: 'text' }],
    transitions: [
      {
        from: ['NOT_STARTED'], to: 'APPLIED', label: t('Apply for CCRO', 'تقديم طلب الإفراج'), primary: true,
        guard: {
          all: [
            { stage: 'DO', statusIn: ['DO_RECEIVED'] },
            { stage: 'INSPECTION', statusIn: ['CLEARED', 'COMPLETED'] },
            { assigned: true },
          ],
        },
      },
      { from: ['APPLIED'], to: 'ISSUED', label: t('CCRO issued', 'صدر أمر الإفراج'), primary: true, requiredFields: ['referenceNo'] },
    ],
    onEnter: { ISSUED: ['SPAWN_CONTAINER_STAGES', 'NOTIFY_CUSTOMER:CLEARED'] },
  },
  {
    key: 'TRUCK', level: 'CONTAINER', order: 7, phase: 'DELIVERY', ownerRole: 'DRIVER',
    label: t('Truck assignment', 'تعيين الشاحنة'),
    statuses: [
      { key: 'UNASSIGNED', label: t('Unassigned', 'غير معين') },
      { key: 'ASSIGNED', label: t('Assigned', 'معين') },
      { key: 'AT_PORT', label: t('At port', 'في الميناء'), done: true },
    ],
    initial: 'UNASSIGNED', slaHours: 24,
    transitions: [
      // Set by trip assignment (Field operations), which records driver, vehicle and delivery details.
      { from: ['UNASSIGNED'], to: 'ASSIGNED', label: t('Assign truck', 'تعيين شاحنة'), primary: true },
      { from: ['ASSIGNED'], to: 'AT_PORT', label: t('Truck at port', 'الشاحنة في الميناء'), primary: true },
    ],
  },
  {
    key: 'PHYSICAL_INSPECTION', level: 'CONTAINER', order: 8, phase: 'DELIVERY', ownerRole: 'INSPECTOR',
    label: t('Physical inspection', 'الفحص الفعلي'),
    statuses: [
      { key: 'PENDING', label: t('Pending', 'قيد الانتظار') },
      { key: 'NOT_REQUIRED', label: t('Not required', 'غير مطلوب'), done: true },
      { key: 'SCHEDULED', label: t('Scheduled', 'مجدول') },
      { key: 'PASSED', label: t('Passed', 'ناجح'), done: true },
      { key: 'HELD', label: t('Held', 'محتجز') },
    ],
    initial: 'PENDING', slaHours: 24,
    fields: [{ key: 'remarks', label: t('Remarks', 'ملاحظات'), type: 'textarea' }],
    transitions: [
      { from: ['PENDING'], to: 'SCHEDULED', label: t('Schedule inspection', 'جدولة التفتيش'), primary: true },
      { from: ['SCHEDULED', 'HELD'], to: 'PASSED', label: t('Passed', 'ناجح'), primary: true, guard: { containerStage: 'TRUCK', statusIn: ['AT_PORT'] } },
      { from: ['SCHEDULED'], to: 'HELD', label: t('Held', 'محتجز'), requiredFields: ['remarks'], guard: { containerStage: 'TRUCK', statusIn: ['AT_PORT'] } },
    ],
  },
  {
    key: 'RELEASE', level: 'CONTAINER', order: 9, phase: 'DELIVERY', ownerRole: 'DRIVER',
    label: t('Container release', 'الإفراج عن الحاوية'),
    statuses: [
      { key: 'PENDING', label: t('Pending', 'قيد الانتظار') },
      { key: 'RELEASED', label: t('Released', 'مفرج عنها') },
      { key: 'GATED_OUT', label: t('Gated out', 'خرجت من البوابة'), done: true },
    ],
    initial: 'PENDING', slaHours: 12,
    transitions: [
      {
        from: ['PENDING'], to: 'RELEASED', label: t('Released', 'تم الإفراج'), primary: true,
        guard: { all: [{ containerStage: 'TRUCK', statusIn: ['AT_PORT'] }, { containerStage: 'PHYSICAL_INSPECTION', statusIn: ['NOT_REQUIRED', 'PASSED'] }] },
      },
      { from: ['RELEASED'], to: 'GATED_OUT', label: t('Gated out', 'خرجت من البوابة'), primary: true },
    ],
  },
  {
    key: 'DELIVERY', level: 'CONTAINER', order: 10, phase: 'DELIVERY', ownerRole: 'DRIVER',
    label: t('Delivery', 'التسليم'),
    statuses: [
      { key: 'PENDING', label: t('Pending', 'قيد الانتظار') },
      { key: 'IN_TRANSIT', label: t('In transit', 'في الطريق') },
      { key: 'DELIVERED', label: t('Delivered', 'تم التسليم'), done: true },
      { key: 'EMPTY_RETURNED', label: t('Empty returned', 'أعيدت فارغة'), done: true },
    ],
    initial: 'PENDING', slaHours: 24,
    fields: [
      { key: 'receiverName', label: t('Received by', 'المستلم'), type: 'text' },
      { key: 'podSignature', label: t('Receiver signature', 'توقيع المستلم'), type: 'signature' },
    ],
    transitions: [
      { from: ['PENDING'], to: 'IN_TRANSIT', label: t('Out for delivery', 'خرجت للتسليم'), primary: true, guard: { containerStage: 'RELEASE', statusIn: ['GATED_OUT'] } },
      { from: ['IN_TRANSIT'], to: 'DELIVERED', label: t('Delivered (POD)', 'تم التسليم'), primary: true, requiredFields: ['receiverName', 'podSignature'] },
      { from: ['DELIVERED'], to: 'EMPTY_RETURNED', label: t('Empty returned', 'أعيدت الحاوية فارغة') },
    ],
    onEnter: { DELIVERED: ['CHECK_JOB_COMPLETE', 'NOTIFY_CUSTOMER:DELIVERED'] },
  },
];

export const DEFAULT_WORKFLOW: WorkflowDefinition = { version: 1, stages: DEFAULT_STAGES };

export const stageDef = (wf: WorkflowDefinition, key: string): StageDef | undefined => wf.stages.find((s) => s.key === key);
export const jobStages = (wf: WorkflowDefinition) => wf.stages.filter((s) => s.level === 'JOB').sort((a, b) => a.order - b.order);
export const containerStages = (wf: WorkflowDefinition) => wf.stages.filter((s) => s.level === 'CONTAINER').sort((a, b) => a.order - b.order);
export const isDone = (def: StageDef, status: string): boolean => !!def.statuses.find((s) => s.key === status)?.done;
