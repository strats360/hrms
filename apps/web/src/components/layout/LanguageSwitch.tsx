import { Languages } from "lucide-react";
import { useSession } from "@/lib/session";
import { getLocale, LOCALES, setLocale, t, useLocale } from "@/lib/i18n";

/** Countries whose people usually want Arabic. */
const ARABIC = new Set(["AE", "SA", "QA", "KW", "OM"]);

/**
 * English or Arabic. Shown for companies in the Gulf, or once someone has picked Arabic,
 * so Indian companies see nothing new.
 */
export function LanguageSwitch() {
  const { tenant } = useSession();
  const locale = useLocale();
  if (!ARABIC.has(tenant?.country ?? "") && getLocale() === "en") return null;
  return (
    <label className="btn btn-ghost !gap-1.5 !px-2 !text-[13px]" title={t("Language")}>
      <Languages size={16} aria-hidden />
      <select className="cursor-pointer bg-transparent outline-none" value={locale} aria-label={t("Language")} onChange={(e) => setLocale(e.target.value as (typeof LOCALES)[number]["code"])}>
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>
    </label>
  );
}
