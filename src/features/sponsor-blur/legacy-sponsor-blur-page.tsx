import { useState } from "react";
import { Image as ImageIcon, Loader2, ScanSearch, Shuffle, Trash2 } from "lucide-react";

import { LocalImage } from "@/components/local-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PresetInlineAction } from "@/components/preset-inline-action";
import { BlurZoneConstructor } from "@/features/settings/blur-zone-constructor";
import { ipc } from "@/lib/ipc";
import { useSettings } from "@/stores/settings";

export function LegacySponsorBlurPage() {
  const settings = useSettings();
  const [streamUrl, setStreamUrl] = useState("");
  const [randomLoading, setRandomLoading] = useState(false);
  const [randomError, setRandomError] = useState<string | null>(null);
  const [randomTime, setRandomTime] = useState<number | null>(null);

  const chooseReference = async () => {
    const path = await ipc.chooseImageFile();
    if (path) {
      settings.setSponsorBlurReferencePath(path);
      setRandomTime(null);
      setRandomError(null);
    }
  };

  const captureRandomReference = async () => {
    const inputUrl = streamUrl.trim();
    if (!inputUrl) {
      const message = "Вставьте ссылку на Twitch-стрим или VOD.";
      setRandomError(message);
      void ipc.chatRenderLogAction("sponsor_blur_random_screenshot_failed", { error: message }).catch(() => {});
      return;
    }

    setRandomLoading(true);
    setRandomError(null);
    try {
      const resolved = await ipc.resolveStream(inputUrl, settings.proxy, settings.binariesDir);
      const duration = resolved.duration ?? null;
      const max = duration && duration > 3 ? duration : 120;
      const timeSec = resolved.is_live ? 0 : Math.random() * Math.max(1, max);
      const frame = await ipc.capturePreviewFrame({
        url: inputUrl,
        timeSec,
        outputWidth: 1920,
        outputHeight: 1080,
        quality: null,
        proxy: settings.proxy,
        binariesDir: settings.binariesDir,
      });
      settings.setSponsorBlurReferencePath(frame.path);
      setRandomTime(frame.time_sec);
    } catch (error) {
      setRandomError(String(error));
    } finally {
      setRandomLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-auto bg-canvas">
      <div className="border-b border-border-default px-6 py-4">
        <div className="flex items-center gap-2">
          <ScanSearch className="h-5 w-5 text-accent" />
          <h1 className="text-[18px] font-semibold">Блюр спонсоров</h1>
        </div>
        <p className="mt-1 text-[12px] text-fg-tertiary">
          Сохрани зоны один раз, затем включай их тумблером в диалоге добавления стрима.
        </p>
      </div>

      <div className="grid gap-4 p-6 xl:grid-cols-[minmax(620px,1fr)_360px]">
        <section className="min-h-64 overflow-auto rounded border border-border-default bg-elevated p-4 resize">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-fg-secondary">Зоны блюра</span>
            <PresetInlineAction featureId="sponsorBlur" />
          </div>
          <BlurZoneConstructor
            value={settings.blurZones}
            onSave={settings.setBlurZones}
            referenceImageSrc={settings.sponsorBlurReferencePath}
          />
        </section>

        <aside className="flex flex-col gap-4">
          <section className="flex min-h-36 flex-col gap-3 overflow-auto rounded border border-border-default bg-elevated p-4 resize">
            <div className="flex items-center gap-2">
              <Switch checked={settings.sponsorBlurEnabled} onCheckedChange={settings.setSponsorBlurEnabled} />
              <PresetInlineAction featureId="sponsorBlur" />
              <span className="text-[13px] font-semibold">Включать блюр по умолчанию</span>
            </div>
            <p className="text-[12px] leading-5 text-fg-tertiary">
              Обычная кнопка “Добавить в очередь” применит сохранённые зоны только если тумблер блюра включён.
            </p>
          </section>

          <section className="flex min-h-64 flex-col gap-3 overflow-auto rounded border border-border-default bg-elevated p-4 resize">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-accent" />
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-fg-secondary">Reference-фото</h2>
              <PresetInlineAction featureId="preview" className="ml-auto" />
            </div>
            <div className="flex flex-col gap-2 rounded border border-border-subtle bg-surface p-3">
              <label className="text-[11px] uppercase tracking-wider text-fg-tertiary">Twitch stream / VOD URL</label>
              <Input value={streamUrl} onChange={(event) => setStreamUrl(event.target.value)} placeholder="https://www.twitch.tv/videos/..." />
              <Button variant="secondary" size="md" onClick={captureRandomReference} disabled={randomLoading}>
                {randomLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shuffle className="h-3.5 w-3.5" />}
                Рандомный кадр
              </Button>
              {randomTime != null && <div className="text-[11px] text-fg-tertiary">Кадр: {Math.floor(randomTime / 60)}:{String(Math.floor(randomTime % 60)).padStart(2, "0")}</div>}
              {randomError && <div className="rounded border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] text-danger">{randomError}</div>}
            </div>
            {settings.sponsorBlurReferencePath ? (
              <>
                <LocalImage path={settings.sponsorBlurReferencePath} className="aspect-video w-full rounded border border-border-default bg-black object-contain" />
                <div className="break-all rounded border border-border-subtle bg-surface px-2 py-1.5 font-mono text-[11px] text-fg-tertiary">
                  {settings.sponsorBlurReferencePath}
                </div>
              </>
            ) : (
              <div className="flex aspect-video items-center justify-center rounded border border-dashed border-border-default bg-surface text-[12px] text-fg-tertiary">
                Фото не выбрано
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" size="md" onClick={chooseReference}>
                <ImageIcon className="h-3.5 w-3.5" />
                Загрузить фото
              </Button>
              {settings.sponsorBlurReferencePath && (
                <Button variant="ghost" size="md" onClick={() => settings.setSponsorBlurReferencePath(null)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Убрать
                </Button>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
