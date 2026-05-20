import { Bell, CheckCircle2, Sparkles, Wrench } from "lucide-react";

import fetchrLockup from "@/assets/fetchr-lockup.png";
import { useUI } from "@/stores/ui";
import { cn } from "@/lib/utils";

const updates = [
  {
    icon: Sparkles,
    title: "Ребрендинг Fetchr",
    text: "Новое название, компактный знак, темная палитра #0C1A2E и основной акцент #378ADD.",
  },
  {
    icon: Wrench,
    title: "Конструктор пресетов",
    text: "Пользователь собирает свой сценарий: добавляет функции, удаляет лишнее и сохраняет пресет.",
  },
  {
    icon: CheckCircle2,
    title: "Быстрый выбор профиля",
    text: "Активный пресет теперь виден рядом с логотипом в верхней панели приложения.",
  },
];

export function NewsMenu() {
  const open = useUI((s) => s.newsOpen);
  const close = useUI((s) => s.closeNews);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Закрыть новости"
        className="fixed inset-0 z-40 cursor-default"
        onClick={close}
      />
      <section className="no-drag absolute right-24 top-8 z-50 w-[360px] overflow-hidden rounded-lg border border-border-default bg-surface shadow-overlay animate-slide-up">
        <div className="border-b border-border-default bg-[#0C1A2E] px-4 py-3">
          <div className="mb-3 overflow-hidden rounded-md border border-white/10 bg-white">
            <img src={fetchrLockup} alt="Fetchr" className="h-20 w-full object-cover object-left" />
          </div>
          <div className="flex items-center gap-2 text-fg-primary">
            <Bell className="h-4 w-4 text-[#85B7EB]" />
            <h2 className="text-[13px] font-semibold">Новости Fetchr</h2>
          </div>
          <p className="mt-1 text-[11.5px] text-fg-secondary">
            Обновления, которые меняют внешний вид и рабочую концепцию приложения.
          </p>
        </div>
        <div className="grid gap-1.5 p-2">
          {updates.map((item, index) => (
            <article
              key={item.title}
              className={cn(
                "rounded-md border border-border-subtle bg-elevated px-3 py-2.5",
                index === 0 && "border-accent/35 bg-accent/10",
              )}
            >
              <div className="flex items-start gap-2">
                <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div className="min-w-0">
                  <h3 className="text-[12.5px] font-semibold text-fg-primary">{item.title}</h3>
                  <p className="mt-1 text-[11.5px] leading-4 text-fg-secondary">{item.text}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
