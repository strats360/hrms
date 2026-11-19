/**
 * Translation and text direction. English is the source language; any text without a
 * translation shows in English, so screens can move over one at a time.
 *
 *   t("Leave")                         -> "الإجازات" in Arabic
 *   t("{n} pending", { n: 3 })         -> placeholders are filled in every language
 *
 * Arabic switches the page to right to left. Layout uses logical classes (ms-, pe-, text-start)
 * so it mirrors on its own. Translations need a review by a native speaker before launch.
 * See docs/MULTI_COUNTRY.md.
 */
import { useSyncExternalStore } from "react";

export const LOCALES = [
  { code: "en", label: "English", dir: "ltr" },
  { code: "ar", label: "العربية", dir: "rtl" },
] as const;
export type Locale = (typeof LOCALES)[number]["code"];

const AR: Record<string, string> = {
  // navigation groups
  Overview: "نظرة عامة",
  People: "الموظفون",
  Pay: "الرواتب",
  Operations: "العمليات",
  Company: "الشركة",
  Platform: "المنصة",
  Revenue: "الإيرادات",
  Governance: "الحوكمة",
  // navigation items
  Dashboard: "لوحة التحكم",
  Employees: "الموظفون",
  Attendance: "الحضور",
  Leave: "الإجازات",
  Payroll: "الرواتب",
  Reimbursements: "المصروفات",
  Payments: "المدفوعات",
  "Statutory compliance": "الامتثال القانوني",
  "TDS & tax": "الضرائب",
  Reports: "التقارير",
  Performance: "الأداء",
  Recruitment: "التوظيف",
  Assets: "الأصول",
  Helpdesk: "مكتب المساعدة",
  Announcements: "الإعلانات",
  "Product support": "دعم المنتج",
  Settings: "الإعدادات",
  Tenants: "الشركات",
  "Customer tickets": "تذاكر العملاء",
  "Billing & invoices": "الفواتير",
  "Plans & pricing": "الخطط والأسعار",
  "Feature flags": "الميزات",
  "Statutory master": "القواعد القانونية",
  "Platform staff": "فريق المنصة",
  "Platform settings": "إعدادات المنصة",
  "Audit log": "سجل التدقيق",
  // app frame
  "Employee self-service": "الخدمة الذاتية للموظف",
  "Admin console": "لوحة الإدارة",
  "Sign out": "تسجيل الخروج",
  Language: "اللغة",
  Notifications: "الإشعارات",
  "Search employees, pages…": "ابحث عن موظفين أو صفحات…",
  Home: "الرئيسية",
  Payslips: "قسائم الرواتب",
  Claims: "المطالبات",
  Tax: "الضريبة",
  Profile: "الملف الشخصي",
  Timesheets: "سجلات الدوام",
  Reviews: "التقييمات",
  Interviews: "المقابلات",
  "IDs & visas": "الهويات والتأشيرات",
  "Legal entities": "الكيانات القانونية",
};
const DICTS: Record<Locale, Record<string, string>> = { en: {}, ar: AR };

const KEY = "saralix.locale";
function initial(): Locale {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "ar" || v === "en") return v;
  } catch {
    /* storage off */
  }
  return "en";
}
let current: Locale = initial();
const listeners = new Set<() => void>();

function applyToDocument() {
  if (typeof document === "undefined") return;
  const l = LOCALES.find((x) => x.code === current)!;
  document.documentElement.lang = current;
  document.documentElement.dir = l.dir;
}
applyToDocument();

export function setLocale(l: Locale) {
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* storage off */
  }
  applyToDocument();
  listeners.forEach((f) => f());
}
export const getLocale = () => current;
export const isRtl = () => current === "ar";

/** Translate an English string, filling {placeholders}. Untranslated text stays in English. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const s = DICTS[current][text] ?? text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Re-render when the language changes. Returns the current locale. */
export function useLocale(): Locale {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => current,
    () => "en",
  );
}
