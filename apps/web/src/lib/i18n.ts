import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const en = {
  nav: { board: 'Board', jobs: 'Jobs', tasks: 'Tasks', containers: 'Containers', customers: 'Customers', trips: 'Trucks & trips', finance: 'Finance', reports: 'Reports', settings: 'Settings', notifications: 'Notifications', field: 'Field', portal: 'My shipments' },
  common: {
    search: 'Search BL, container, Bayan or DO number', save: 'Save', cancel: 'Cancel', create: 'Create', close: 'Close', loading: 'Loading…', empty: 'Nothing here yet',
    signOut: 'Sign out', language: 'العربية', offline: 'Offline — changes will sync', pending: '{{count}} update(s) waiting to sync', synced: 'All changes synced',
    retry: 'Retry', add: 'Add', remove: 'Remove', edit: 'Edit', view: 'View', status: 'Status', actions: 'Actions', customer: 'Customer', eta: 'ETA', containers: 'Containers',
    assignee: 'Assignee', unassigned: 'Unassigned', due: 'Due', overdue: 'Overdue', waitingFor: 'Waiting for', remarks: 'Remarks', required: 'required', yes: 'Yes', no: 'No',
  },
  phase: { DOCUMENTS: 'Documents', CLEARANCE: 'Customs & DO', CCRO: 'Port release', DELIVERY: 'Delivering', READY_TO_CLOSE: 'Ready to close', CLOSED: 'Closed' },
  board: { title: 'Operations board', subtitle: 'Every open BL by stage. Overdue first.', newJob: 'New job', onlyMine: 'Only my jobs' },
  job: {
    overview: 'Workflow', containers: 'Containers', documents: 'Documents', payments: 'Payments', trips: 'Trips', timeline: 'Timeline',
    customsTrack: 'Customs track', doTrack: 'Shipping line track', gate: 'Release gate', perContainer: 'Per container', closeJob: 'Close job', reopen: 'Reopen', invoice: 'Generate invoice',
  },
  login: { title: 'Sign in to ClearPort', subtitle: 'Demo environment — choose a user to see the app through their role.', or: 'or enter an email', signIn: 'Sign in' },
  field: { title: 'My tasks', empty: 'No tasks right now. New assignments appear here.', queued: 'Saved offline — will sync' },
  portal: { title: 'My shipments', approvals: 'Charges waiting for your approval', approve: 'Approve charges', dispute: 'Dispute' },
};

const ar: typeof en = {
  nav: { board: 'اللوحة', jobs: 'الملفات', tasks: 'المهام', containers: 'الحاويات', customers: 'العملاء', trips: 'الشاحنات والرحلات', finance: 'المالية', reports: 'التقارير', settings: 'الإعدادات', notifications: 'الإشعارات', field: 'الميدان', portal: 'شحناتي' },
  common: {
    search: 'ابحث برقم البوليصة أو الحاوية أو البيان أو الإذن', save: 'حفظ', cancel: 'إلغاء', create: 'إنشاء', close: 'إغلاق', loading: 'جارٍ التحميل…', empty: 'لا توجد بيانات بعد',
    signOut: 'تسجيل الخروج', language: 'English', offline: 'غير متصل — سيتم المزامنة لاحقاً', pending: '{{count}} تحديث بانتظار المزامنة', synced: 'تمت مزامنة كل التغييرات',
    retry: 'إعادة المحاولة', add: 'إضافة', remove: 'حذف', edit: 'تعديل', view: 'عرض', status: 'الحالة', actions: 'إجراءات', customer: 'العميل', eta: 'الوصول المتوقع', containers: 'الحاويات',
    assignee: 'المسؤول', unassigned: 'غير معين', due: 'الموعد', overdue: 'متأخر', waitingFor: 'بانتظار', remarks: 'ملاحظات', required: 'مطلوب', yes: 'نعم', no: 'لا',
  },
  phase: { DOCUMENTS: 'المستندات', CLEARANCE: 'الجمارك وإذن التسليم', CCRO: 'الإفراج من الميناء', DELIVERY: 'قيد التسليم', READY_TO_CLOSE: 'جاهز للإغلاق', CLOSED: 'مغلق' },
  board: { title: 'لوحة العمليات', subtitle: 'كل البوالص المفتوحة حسب المرحلة. المتأخر أولاً.', newJob: 'ملف جديد', onlyMine: 'ملفاتي فقط' },
  job: {
    overview: 'سير العمل', containers: 'الحاويات', documents: 'المستندات', payments: 'المدفوعات', trips: 'الرحلات', timeline: 'السجل',
    customsTrack: 'مسار الجمارك', doTrack: 'مسار خط الشحن', gate: 'بوابة الإفراج', perContainer: 'لكل حاوية', closeJob: 'إغلاق الملف', reopen: 'إعادة فتح', invoice: 'إصدار فاتورة',
  },
  login: { title: 'تسجيل الدخول إلى كليربورت', subtitle: 'بيئة تجريبية — اختر مستخدماً لرؤية التطبيق حسب دوره.', or: 'أو أدخل البريد الإلكتروني', signIn: 'دخول' },
  field: { title: 'مهامي', empty: 'لا توجد مهام حالياً.', queued: 'حُفظ دون اتصال — ستتم المزامنة' },
  portal: { title: 'شحناتي', approvals: 'رسوم بانتظار موافقتك', approve: 'اعتماد الرسوم', dispute: 'اعتراض' },
};

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: localStorage.getItem('cp.lang') ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: string) {
  const l = lang === 'ar' ? 'ar' : 'en';
  void i18n.changeLanguage(l);
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  localStorage.setItem('cp.lang', l);
}
setLanguage(localStorage.getItem('cp.lang') ?? 'en');

/** Picks the right side of a bilingual label from the API. */
export const L = (label: { en: string; ar: string } | undefined | null) => (label ? (i18n.language === 'ar' ? label.ar : label.en) : '');

export default i18n;
