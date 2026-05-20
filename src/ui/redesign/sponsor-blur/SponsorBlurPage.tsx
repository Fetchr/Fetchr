import { useEffect, useMemo, useState } from "react";

import { usePersistedState } from "@/hooks/usePersistedState";
import { ipc } from "@/lib/ipc";
import { useSettings } from "@/stores/settings";
import { useWorkflowPresets } from "@/stores/workflowPresets";
import type { BlurZone } from "@/types/job";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";
import { fetchrThemeClassName } from "@/ui/redesign/theme";

import styles from "./SponsorBlurPage.module.css";
import { SponsorBlurToolbar } from "./SponsorBlurToolbar";
import { SponsorVideoPreview, type SponsorPreviewSource } from "./SponsorVideoPreview";
import { SponsorZoneList } from "./SponsorZoneList";
import { clampSponsorZone } from "./SponsorZoneOverlay";
import {
  SponsorZoneProperties,
  type SponsorZoneUiSettings,
} from "./SponsorZoneProperties";

const DEFAULT_FRAME_TIME = 0;

export function SponsorBlurPage() {
  const settings = useSettings();
  const sponsorPresets = useWorkflowPresets((state) => state.sponsorPresets);
  const activeSponsorPresetId = useWorkflowPresets((state) => state.activeSponsorPresetId);
  const setActiveSponsorPreset = useWorkflowPresets((state) => state.setActiveSponsorPreset);
  const createSponsorPreset = useWorkflowPresets((state) => state.createSponsorPreset);
  const saveSponsorPreset = useWorkflowPresets((state) => state.saveSponsorPreset);
  const renameSponsorPreset = useWorkflowPresets((state) => state.renameSponsorPreset);
  const activeSponsorPreset = sponsorPresets.find((preset) => preset.id === activeSponsorPresetId) ?? sponsorPresets[0] ?? null;
  const effectiveSponsorPresetId = activeSponsorPreset?.id ?? "";
  const [draftPresetId, setDraftPresetId] = usePersistedState("fetchr-draft:sponsorBlur:presetId", "");
  const [videoUrl, setVideoUrl] = usePersistedState("fetchr-draft:sponsorBlur:videoUrl", "");
  const [frameTimeInput, setFrameTimeInput] = usePersistedState("fetchr-draft:sponsorBlur:frameTimeInput", "00:00:00");
  const [frameTime, setFrameTime] = usePersistedState<number | null>("fetchr-draft:sponsorBlur:frameTime", null);
  const [draftZones, setDraftZones] = usePersistedState<BlurZone[]>("fetchr-draft:sponsorBlur:draftZones", () => settings.blurZones.map(clampSponsorZone));
  const [selectedId, setSelectedId] = usePersistedState<string | null>("fetchr-draft:sponsorBlur:selectedId", () => settings.blurZones[0]?.id ?? null);
  const [zoneUi, setZoneUi] = usePersistedState<Record<string, SponsorZoneUiSettings>>("fetchr-draft:sponsorBlur:zoneUi", () =>
    buildZoneUi(settings.blurZones),
  );
  const [showZones, setShowZones] = usePersistedState("fetchr-draft:sponsorBlur:showZones", true);
  const [showGrid, setShowGrid] = usePersistedState("fetchr-draft:sponsorBlur:showGrid", true);
  const [saved, setSaved] = usePersistedState("fetchr-draft:sponsorBlur:saved", true);
  const [loadingFrame, setLoadingFrame] = useState(false);
  const [frameError, setFrameError] = useState<string | null>(null);

  useEffect(() => {
    if (draftPresetId || draftZones.length > 0 || settings.blurZones.length === 0) return;
    const zones = settings.blurZones.map(clampSponsorZone);
    setDraftZones(zones);
    setSelectedId((current) => current ?? zones[0]?.id ?? null);
    setZoneUi((current) => ({ ...buildZoneUi(zones), ...current }));
  }, [draftPresetId, draftZones.length, settings.blurZones, setDraftZones, setSelectedId, setZoneUi]);

  useEffect(() => {
    if (!activeSponsorPreset) return;
    if (draftPresetId === effectiveSponsorPresetId) return;
    setDraftPresetId(effectiveSponsorPresetId);
    const zones = activeSponsorPreset.zones.map(clampSponsorZone);
    setDraftZones(zones);
    setSelectedId(zones[0]?.id ?? null);
    setZoneUi(buildZoneUi(zones));
    if (settings.sponsorBlurEnabled !== activeSponsorPreset.enabled) {
      settings.setSponsorBlurEnabled(activeSponsorPreset.enabled);
    }
    if (activeSponsorPreset.referencePath !== settings.sponsorBlurReferencePath) {
      settings.setSponsorBlurReferencePath(activeSponsorPreset.referencePath);
    }
    setSaved(true);
  }, [activeSponsorPreset, draftPresetId, effectiveSponsorPresetId, setDraftPresetId, settings]);

  const selectedZone = useMemo(
    () => draftZones.find((zone) => zone.id === selectedId) ?? draftZones[0] ?? null,
    [draftZones, selectedId],
  );
  const selectedUi = selectedZone ? zoneUi[selectedZone.id] ?? defaultZoneUi(draftZones.indexOf(selectedZone)) : null;
  const reference = useMemo<SponsorPreviewSource | null>(() => {
    if (settings.sponsorBlurReferencePath) return { kind: "local", src: settings.sponsorBlurReferencePath };
    return null;
  }, [settings.sponsorBlurReferencePath]);

  const changeZone = (id: string, patch: Partial<BlurZone>) => {
    setDraftZones((zones) =>
      zones.map((zone) => (zone.id === id ? clampSponsorZone({ ...zone, ...patch }) : zone)),
    );
    setSaved(false);
  };

  const changeZoneUi = (id: string, patch: Partial<SponsorZoneUiSettings>) => {
    setZoneUi((current) => ({
      ...current,
      [id]: { ...(current[id] ?? defaultZoneUiByName("Zone")), ...patch },
    }));
    setSaved(false);
  };

  const addZone = () => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    const zone = clampSponsorZone({
      id,
      enabled: true,
      x: 120 + draftZones.length * 36,
      y: 120 + draftZones.length * 28,
      width: 420,
      height: 140,
      effect: "mosaic",
      intensity: 12,
      image_path: null,
      image_fit: "contain",
    });
    setDraftZones((zones) => [...zones, zone]);
    setZoneUi((current) => ({ ...current, [id]: defaultZoneUi(draftZones.length) }));
    setSelectedId(id);
    setSaved(false);
  };

  const deleteZone = (id: string) => {
    setDraftZones((zones) => zones.filter((zone) => zone.id !== id));
    setSelectedId((current) => (current === id ? null : current));
    setSaved(false);
  };

  const duplicateZone = () => {
    if (!selectedZone) return;
    const id = crypto.randomUUID?.() ?? String(Date.now());
    const zone = clampSponsorZone({
      ...selectedZone,
      id,
      x: selectedZone.x + 32,
      y: selectedZone.y + 32,
    });
    setDraftZones((zones) => [...zones, zone]);
    setZoneUi((current) => ({
      ...current,
      [id]: {
        ...(selectedUi ?? defaultZoneUi(draftZones.length)),
        name: `${selectedUi?.name ?? getZoneName(selectedZone, 0)} copy`,
      },
    }));
    setSelectedId(id);
    setSaved(false);
  };

  const clearZones = () => {
    setDraftZones([]);
    setSelectedId(null);
    setSaved(false);
  };

  const savePreset = () => {
    const zones = draftZones.map(clampSponsorZone);
    settings.setBlurZones(zones);
    if (activeSponsorPreset) {
      saveSponsorPreset(activeSponsorPreset.id, zones, settings.sponsorBlurEnabled, settings.sponsorBlurReferencePath);
    }
    setSaved(true);
  };

  const duplicateSponsorPreset = () => {
    createSponsorPreset(activeSponsorPreset?.id ?? null);
  };

  const renameSponsor = () => {
    if (!activeSponsorPreset) return;
    const name = window.prompt("Новое имя пресета блюра", activeSponsorPreset.name)?.trim();
    if (name) renameSponsorPreset(activeSponsorPreset.id, name);
  };

  const chooseZoneImage = async (id: string) => {
    const path = await ipc.chooseImageFile();
    if (path) changeZone(id, { image_path: path, effect: "image_overlay" });
  };

  const chooseReferenceFile = async () => {
    const path = await ipc.chooseImageFile();
    if (!path) return;
    settings.setSponsorBlurReferencePath(path);
    setFrameTime(null);
    setFrameError(null);
  };

  const clearReference = () => {
    settings.setSponsorBlurReferencePath(null);
    setFrameTime(null);
  };

  const captureFrame = async (random = false) => {
    const inputUrl = videoUrl.trim();
    if (!inputUrl) {
      setFrameError("Укажите URL или путь к видео.");
      return;
    }

    setLoadingFrame(true);
    setFrameError(null);
    try {
      let timeSec = parseTime(frameTimeInput) ?? DEFAULT_FRAME_TIME;
      if (random) {
        const resolved = await ipc.resolveStream(inputUrl, settings.proxy, settings.binariesDir);
        const max = resolved.is_live ? 0 : Math.max(1, resolved.duration ?? 120);
        timeSec = resolved.is_live ? 0 : Math.random() * max;
      }
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
      setFrameTime(frame.time_sec);
      setFrameTimeInput(formatTime(frame.time_sec));
      void ipc.chatRenderLogAction("sponsor_blur_reference_frame_selected", {
        source: inputUrl,
        time_sec: frame.time_sec,
        path: frame.path,
      }).catch(() => {});
    } catch (err) {
      const message = String(err);
      setFrameError(message);
      void ipc.chatRenderLogAction("sponsor_blur_reference_frame_failed", {
        source: inputUrl,
        error: message,
      }).catch(() => {});
    } finally {
      setLoadingFrame(false);
    }
  };

  const applyDuringRender = settings.sponsorBlurEnabled;

  return (
    <div className={`${fetchrThemeClassName} ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Блюр спонсоров</h1>
          <div className={styles.subtitle}>Отметьте зоны спонсоров на видео. Сохранённые зоны будут автоматически применяться при рендере.</div>
        </div>
      </header>

      <div className={styles.body}>
        <main className={styles.mainColumn}>
          <section className={styles.presetPanel}>
            <div className={styles.presetPanelMain}>
              <label className={styles.field}>
                <span className={styles.label}>Пресет блюра</span>
                <select
                  className={styles.input}
                  value={activeSponsorPreset?.id ?? ""}
                  onChange={(event) => setActiveSponsorPreset(event.currentTarget.value)}
                >
                  {sponsorPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.presetActions}>
                <button className={styles.button} type="button" onClick={duplicateSponsorPreset}>
                  <RedesignIcon name="copy" />
                  Копия
                </button>
                <button className={styles.button} type="button" onClick={renameSponsor} disabled={!activeSponsorPreset}>
                  <RedesignIcon name="preset" />
                  Переименовать
                </button>
                <button className={`${styles.button} ${styles.primaryButton}`} type="button" onClick={savePreset}>
                  <RedesignIcon name="save" />
                  Сохранить пресет
                </button>
              </div>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelBody}>
              <div className={styles.videoSelector}>
                <label className={styles.field}>
                  <span className={styles.label}>Видео</span>
                  <input
                    className={`${styles.input} ${styles.mono}`}
                    value={videoUrl}
                    placeholder="https://www.twitch.tv/videos/... или путь к файлу"
                    onChange={(event) => setVideoUrl(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Кадр</span>
                  <input
                    className={`${styles.input} ${styles.mono}`}
                    value={frameTimeInput}
                    placeholder="00:00:00"
                    onChange={(event) => setFrameTimeInput(event.target.value)}
                  />
                </label>
                <div className={styles.toolbarGroup}>
                  <button
                    className={`${styles.button} ${styles.iconButton}`}
                    type="button"
                    onClick={() => void captureFrame(false)}
                    disabled={loadingFrame}
                    title="Извлечь кадр"
                    aria-label="Извлечь кадр"
                  >
                    <RedesignIcon name={loadingFrame ? "loading" : "preview"} className={loadingFrame ? "animate-spin" : undefined} />
                  </button>
                  <button className={`${styles.button} ${styles.iconButton}`} type="button" onClick={() => void captureFrame(true)} disabled={loadingFrame} title="Рандомный кадр">
                    <RedesignIcon name="reset" />
                  </button>
                </div>
              </div>
              <div className={styles.referenceInline}>
                <span className={styles.referenceLabel}>Референс фото</span>
                <button className={styles.button} type="button" onClick={() => void chooseReferenceFile()}>
                  <RedesignIcon name="image" />
                  Загрузить фото
                </button>
                <button className={styles.button} type="button" onClick={clearReference} disabled={!reference}>
                  <RedesignIcon name="trash" />
                  Очистить
                </button>
                <span className={styles.referencePath}>{reference?.src ?? "Фото не выбрано"}</span>
              </div>
            </div>
          </section>

          <SponsorVideoPreview
            preview={reference}
            zones={draftZones}
            selectedId={selectedZone?.id ?? null}
            showZones={showZones}
            showGrid={showGrid}
            frameTime={frameTime}
            loading={loadingFrame}
            error={frameError}
            getZoneName={getZoneName}
            onSelectZone={setSelectedId}
            onChangeZone={changeZone}
          />

          <SponsorBlurToolbar
            showZones={showZones}
            showGrid={showGrid}
            applyDuringRender={applyDuringRender}
            saved={saved}
            onAddZone={addZone}
            onToggleZones={setShowZones}
            onToggleGrid={setShowGrid}
            onSavePreset={savePreset}
            onApplyDuringRenderChange={settings.setSponsorBlurEnabled}
          />
        </main>

        <aside className={styles.sideColumn}>
          <SponsorZoneList
            zones={draftZones}
            selectedId={selectedZone?.id ?? null}
            getZoneName={getZoneName}
            onSelectZone={setSelectedId}
            onChangeZone={changeZone}
          />
          <SponsorZoneProperties
            zone={selectedZone}
            ui={selectedUi}
            onChangeZone={changeZone}
            onChangeUi={changeZoneUi}
            onDeleteZone={deleteZone}
            onChooseZoneImage={(id) => void chooseZoneImage(id)}
          />
        </aside>
      </div>

      <footer className={styles.footer}>
        <span>
          Пресет: {activeSponsorPreset?.name ?? "Default Blur"} · Зон: {draftZones.length} · {saved ? "Сохранено" : "Есть несохранённые изменения"}
        </span>
        <span className={styles.footerActions}>
          <button className={styles.button} type="button" onClick={duplicateZone} disabled={!selectedZone}>
            <RedesignIcon name="copy" />
            Дублировать
          </button>
          <button className={styles.button} type="button" onClick={clearZones} disabled={draftZones.length === 0}>
            <RedesignIcon name="trash" />
            Очистить
          </button>
          <button className={`${styles.button} ${styles.primaryButton}`} type="button" onClick={savePreset}>
            <RedesignIcon name="save" />
            Сохранить
          </button>
        </span>
      </footer>
    </div>
  );

  function getZoneName(zone: BlurZone, index: number) {
    return zoneUi[zone.id]?.name?.trim() || `Zone ${index + 1}`;
  }
}

function buildZoneUi(zones: BlurZone[]): Record<string, SponsorZoneUiSettings> {
  return Object.fromEntries(zones.map((zone, index) => [zone.id, defaultZoneUi(index)]));
}

function defaultZoneUi(index: number): SponsorZoneUiSettings {
  return defaultZoneUiByName(`Zone ${index + 1}`);
}

function defaultZoneUiByName(name: string): SponsorZoneUiSettings {
  return {
    name,
    shape: "rectangle",
    edgeSoftness: 32,
    padding: 8,
    adaptiveSize: true,
  };
}

function parseTime(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const parts = raw.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

function formatTime(value: number) {
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
