/**
 * Message templates in English and Arabic. The prototype only logs these; production WhatsApp sends use
 * Meta-approved templates with the same variables.
 */
type Vars = Record<string, string | number | undefined>;
type Tpl = { en: (v: Vars) => { title: string; body: string }; ar: (v: Vars) => { title: string; body: string } };

export const TEMPLATES: Record<string, Tpl> = {
  DOCS_RECEIVED: {
    en: (v) => ({ title: `Documents received — BL ${v.blNo}`, body: `We have received the documents for BL ${v.blNo} (job ${v.jobNo}) and started clearance.` }),
    ar: (v) => ({ title: `تم استلام المستندات — بوليصة ${v.blNo}`, body: `استلمنا مستندات البوليصة ${v.blNo} (ملف ${v.jobNo}) وبدأنا إجراءات التخليص.` }),
  },
  APPROVAL_REQUEST: {
    en: (v) => ({ title: `Please approve charges — BL ${v.blNo}`, body: `Duty and charges for BL ${v.blNo} total ${v.total}. Tap the link to review and approve.` }),
    ar: (v) => ({ title: `يرجى اعتماد الرسوم — بوليصة ${v.blNo}`, body: `إجمالي الرسوم للبوليصة ${v.blNo} هو ${v.total}. اضغط الرابط للمراجعة والاعتماد.` }),
  },
  CLEARED: {
    en: (v) => ({ title: `Cargo cleared — BL ${v.blNo}`, body: `Port release is issued for BL ${v.blNo}. We are arranging trucks for ${v.containers} container(s).` }),
    ar: (v) => ({ title: `تم الإفراج — بوليصة ${v.blNo}`, body: `صدر أمر الإفراج للبوليصة ${v.blNo}. نقوم بترتيب الشاحنات لعدد ${v.containers} حاوية.` }),
  },
  OUT_FOR_DELIVERY: {
    en: (v) => ({ title: `Out for delivery — ${v.containerNo}`, body: `Container ${v.containerNo} (BL ${v.blNo}) has left the port and is on its way.` }),
    ar: (v) => ({ title: `في الطريق — ${v.containerNo}`, body: `غادرت الحاوية ${v.containerNo} (بوليصة ${v.blNo}) الميناء وهي في الطريق إليكم.` }),
  },
  DELIVERED: {
    en: (v) => ({ title: `Delivered — ${v.containerNo}`, body: `Container ${v.containerNo} (BL ${v.blNo}) was delivered and signed for by ${v.receiver}.` }),
    ar: (v) => ({ title: `تم التسليم — ${v.containerNo}`, body: `تم تسليم الحاوية ${v.containerNo} (بوليصة ${v.blNo}) ووقع بالاستلام ${v.receiver}.` }),
  },
  INVOICE_ISSUED: {
    en: (v) => ({ title: `Invoice ${v.invoiceNo}`, body: `Invoice ${v.invoiceNo} for BL ${v.blNo} is ready: ${v.total}.` }),
    ar: (v) => ({ title: `فاتورة ${v.invoiceNo}`, body: `الفاتورة ${v.invoiceNo} للبوليصة ${v.blNo} جاهزة: ${v.total}.` }),
  },
  TRIP_ASSIGNED: {
    en: (v) => ({ title: `New trip ${v.tripNo}`, body: `Pick up ${v.containers} at ${v.port}. Deliver to: ${v.address}. Open the link to update status.` }),
    ar: (v) => ({ title: `رحلة جديدة ${v.tripNo}`, body: `استلم ${v.containers} من ${v.port}. التسليم إلى: ${v.address}. افتح الرابط لتحديث الحالة.` }),
  },
  STAGE_ASSIGNED: {
    en: (v) => ({ title: `Assigned: ${v.stage} — ${v.person}`, body: `${v.person} was assigned ${v.stage} for BL ${v.blNo} (job ${v.jobNo}).` }),
    ar: (v) => ({ title: `مهمة جديدة: ${v.stage} — ${v.person}`, body: `تم تعيين ${v.person} على ${v.stage} للبوليصة ${v.blNo}.` }),
  },
  READY_TO_CLOSE: {
    en: (v) => ({ title: `Ready to close — BL ${v.blNo}`, body: `Every container on BL ${v.blNo} (job ${v.jobNo}) is delivered. Reconcile payments, invoice and close the job.` }),
    ar: (v) => ({ title: `جاهز للإغلاق — بوليصة ${v.blNo}`, body: `تم تسليم جميع حاويات البوليصة ${v.blNo}. يرجى مطابقة المدفوعات وإصدار الفاتورة وإغلاق الملف.` }),
  },
  SLA_BREACHED: {
    en: (v) => ({ title: `Overdue: ${v.stage}`, body: `${v.stage} on BL ${v.blNo} is past its target time.` }),
    ar: (v) => ({ title: `متأخر: ${v.stage}`, body: `${v.stage} للبوليصة ${v.blNo} تجاوز الوقت المحدد.` }),
  },
  FREE_TIME_EXPIRING: {
    en: (v) => ({ title: `Free time ends ${v.when} — ${v.containerNo}`, body: `Port free time for ${v.containerNo} (BL ${v.blNo}) ends on ${v.date}. Move it to avoid demurrage.` }),
    ar: (v) => ({ title: `انتهاء المهلة ${v.when} — ${v.containerNo}`, body: `تنتهي المهلة المجانية للحاوية ${v.containerNo} في ${v.date}. يرجى نقلها لتجنب غرامات التأخير.` }),
  },
  CUSTOMER_DECISION: {
    en: (v) => ({ title: `Customer ${v.decision} charges — BL ${v.blNo}`, body: `${v.by} ${v.decision} the charges for BL ${v.blNo}. ${v.note ?? ''}` }),
    ar: (v) => ({ title: `قرار العميل — بوليصة ${v.blNo}`, body: `${v.by}: ${v.decision}. ${v.note ?? ''}` }),
  },
};

export function render(template: string, lang: string, vars: Vars) {
  const t = TEMPLATES[template];
  if (!t) return { title: template, body: JSON.stringify(vars) };
  return (lang === 'ar' ? t.ar : t.en)(vars);
}
