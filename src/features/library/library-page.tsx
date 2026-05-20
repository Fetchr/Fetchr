import { useTranslation } from "react-i18next";

export function LibraryPage() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-border-default px-4">
        <h1 className="text-[14px] font-semibold">{t("nav.library")}</h1>
      </header>
      <div className="flex flex-1 items-center justify-center text-[12px] text-fg-tertiary">
        {t("library.empty")}
      </div>
    </div>
  );
}
