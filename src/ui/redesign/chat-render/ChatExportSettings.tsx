import type {
  AlphaOutputFormat,
  ChatComposeMode,
  ChatFontStyle,
  ChatOverlayMode,
  ChatRenderCodec,
  SystemFont,
} from "@/types/job";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";

import styles from "./ChatRenderPage.module.css";

export type ChatOutputFormat = "mov" | "webm" | "png";

interface ChatExportSettingsProps {
  codec: ChatRenderCodec;
  overlayMode: ChatOverlayMode;
  composeMode: ChatComposeMode;
  alphaOutputFormat: AlphaOutputFormat;
  solidBackgroundColor: string;
  alphaBackground: boolean;
  fontFamily: string;
  fontStyle: ChatFontStyle;
  fontSize: number;
  fontWeight: number;
  usernameFontWeight: number;
  backgroundEnabled: boolean;
  backgroundOpacity: number;
  showBadges: boolean;
  showTimestamps: boolean;
  showAvatars: boolean;
  showBttv: boolean;
  showFfz: boolean;
  show7tv: boolean;
  saveCleanVideo: boolean;
  cacheRemoteEmotes: boolean;
  systemFonts: SystemFont[];
  onCodecChange: (value: ChatRenderCodec) => void;
  onOverlayModeChange: (value: ChatOverlayMode) => void;
  onComposeModeChange: (value: ChatComposeMode) => void;
  onAlphaOutputFormatChange: (value: AlphaOutputFormat) => void;
  onSolidBackgroundColorChange: (value: string) => void;
  onAlphaBackgroundChange: (value: boolean) => void;
  onFontFamilyChange: (value: string) => void;
  onFontStyleChange: (value: ChatFontStyle) => void;
  onFontSizeChange: (value: number) => void;
  onFontWeightChange: (value: number) => void;
  onUsernameFontWeightChange: (value: number) => void;
  onBackgroundEnabledChange: (value: boolean) => void;
  onBackgroundOpacityChange: (value: number) => void;
  onShowBadgesChange: (value: boolean) => void;
  onShowTimestampsChange: (value: boolean) => void;
  onShowAvatarsChange: (value: boolean) => void;
  onShowBttvChange: (value: boolean) => void;
  onShowFfzChange: (value: boolean) => void;
  onShow7tvChange: (value: boolean) => void;
  onSaveCleanVideoChange: (value: boolean) => void;
  onCacheRemoteEmotesChange: (value: boolean) => void;
}

export function ChatExportSettings({
  codec,
  overlayMode,
  composeMode,
  alphaOutputFormat,
  solidBackgroundColor,
  alphaBackground,
  fontFamily,
  fontStyle,
  fontSize,
  fontWeight,
  usernameFontWeight,
  backgroundEnabled,
  backgroundOpacity,
  showBadges,
  showTimestamps,
  showAvatars,
  showBttv,
  showFfz,
  show7tv,
  saveCleanVideo,
  cacheRemoteEmotes,
  systemFonts,
  onCodecChange,
  onOverlayModeChange,
  onComposeModeChange,
  onAlphaOutputFormatChange,
  onSolidBackgroundColorChange,
  onAlphaBackgroundChange,
  onFontFamilyChange,
  onFontStyleChange,
  onFontSizeChange,
  onFontWeightChange,
  onUsernameFontWeightChange,
  onBackgroundEnabledChange,
  onBackgroundOpacityChange,
  onShowBadgesChange,
  onShowTimestampsChange,
  onShowAvatarsChange,
  onShowBttvChange,
  onShowFfzChange,
  onShow7tvChange,
  onSaveCleanVideoChange,
  onCacheRemoteEmotesChange,
}: ChatExportSettingsProps) {
  const selectedFont = systemFonts.find((font) => font.family === fontFamily);
  const fontOptions = buildFontOptions(systemFonts, fontFamily);
  const weightOptions = buildWeightOptions(selectedFont?.weights);
  const styleOptions = buildStyleOptions(selectedFont?.styles);

  return (
    <section className={`${styles.panel} ${styles.renderSettingsPanel}`}>
      <div className={styles.renderSettingsHeader}>
        <RedesignIcon name="settings" />
        <span>РЕНДЕР</span>
      </div>

      <div className={styles.renderSettingsBody}>
        <div className={styles.renderGrid}>
          <SelectField
            className={styles.span3}
            label="Кодек чата"
            value={codec}
            hint="самый быстрый / lossless / alpha"
            onChange={(value) => onCodecChange(value as ChatRenderCodec)}
            options={[
              ["raw_rgba_pipe", "RAW RGBA"],
              ["qtrle_mov_rle", "MOV qtrle"],
              ["vp9_webm_alpha", "WebM VP9 Alpha"],
              ["ffv1_mkv_alpha", "FFV1 MKV Alpha"],
              ["prores_4444", "ProRes 4444"],
            ]}
          />

          <SelectField
            label="Режим overlay"
            value={overlayMode}
            hint="Transparent - отдельный слой. Direct - быстрее."
            onChange={(value) => onOverlayModeChange(value as ChatOverlayMode)}
            options={[
              ["direct_render", "Direct render"],
              ["transparent_overlay", "Transparent overlay"],
            ]}
          />
          <SelectField
            label="Compose"
            value={composeMode}
            hint="Direct быстрее. Intermediate сохраняет отдельный слой."
            onChange={(value) => onComposeModeChange(value as ChatComposeMode)}
            options={[
              ["direct", "Direct"],
              ["intermediate", "Intermediate"],
            ]}
          />
          <SelectField
            label="Alpha файл"
            value={alphaOutputFormat}
            hint="Формат отдельного прозрачного файла."
            onChange={(value) => onAlphaOutputFormatChange(value as AlphaOutputFormat)}
            options={[
              ["mov_qtrle", "MOV qtrle"],
              ["webm_vp9", "WebM VP9"],
              ["ffv1_mkv", "FFV1 MKV"],
              ["prores_4444", "ProRes 4444"],
              ["lagarith_avi", "Lagarith AVI"],
            ]}
          />

          <ColorField label="Цвет Fast-BG" value={solidBackgroundColor} hint="Фон режима без alpha." onChange={onSolidBackgroundColorChange} />
          <SelectField label="Шрифт" value={fontFamily} onChange={onFontFamilyChange} options={fontOptions} />
          <SelectField label="Вес текста" value={String(fontWeight)} onChange={(value) => onFontWeightChange(Number(value))} options={weightOptions} />
          <SelectField label="Стиль" value={fontStyle} onChange={(value) => onFontStyleChange(value as ChatFontStyle)} options={styleOptions} />
          <SelectField label="Вес ника" value={String(usernameFontWeight)} onChange={(value) => onUsernameFontWeightChange(Number(value))} options={weightOptions} />

          <NumberField label="Размер" value={fontSize} min={10} max={72} onChange={onFontSizeChange} />
          <label className={`${styles.field} ${styles.compactToggleField}`}>
            <span className={styles.label}>Фон сообщений</span>
            <span className={styles.inlineToggle}>
              <span>Фон сообщений</span>
              <input type="checkbox" checked={backgroundEnabled} onChange={(event) => onBackgroundEnabledChange(event.target.checked)} />
            </span>
          </label>
          <NumberField
            label="Прозрачность фона"
            value={Number(backgroundOpacity.toFixed(2))}
            min={0}
            max={1}
            step={0.01}
            onChange={onBackgroundOpacityChange}
          />
        </div>

        <div className={styles.renderCheckboxGrid}>
          <CheckBox label="Badges" checked={showBadges} onChange={onShowBadgesChange} />
          <CheckBox label="Timestamps" checked={showTimestamps} onChange={onShowTimestampsChange} />
          <CheckBox label="Avatars" checked={showAvatars} onChange={onShowAvatarsChange} />
          <CheckBox label="BTTV" checked={showBttv} onChange={onShowBttvChange} />
          <CheckBox label="FFZ" checked={showFfz} onChange={onShowFfzChange} />
          <CheckBox label="7TV" checked={show7tv} onChange={onShow7tvChange} />
          <CheckBox label="Clean video" checked={saveCleanVideo} onChange={onSaveCleanVideoChange} />
          <CheckBox label="Alpha file" checked={alphaBackground} onChange={onAlphaBackgroundChange} />
          <CheckBox label="Cache GIF/WebP" checked={cacheRemoteEmotes} onChange={onCacheRemoteEmotesChange} />
        </div>
      </div>
    </section>
  );
}

function buildFontOptions(systemFonts: SystemFont[], activeFamily: string): Array<[string, string]> {
  const names = new Set(systemFonts.map((font) => font.family).filter(Boolean));
  if (activeFamily) names.add(activeFamily);
  if (names.size === 0) {
    ["Inter", "Segoe UI", "Arial"].forEach((name) => names.add(name));
  }
  return [...names].sort((a, b) => a.localeCompare(b)).map((name) => [name, name]);
}

function buildWeightOptions(weights?: number[]): Array<[string, string]> {
  const normalized = [...new Set((weights?.length ? weights : [400, 700]).map((weight) => normalizeWeight(weight)))].sort((a, b) => a - b);
  return normalized.map((weight) => [String(weight), weightLabel(weight)]);
}

function buildStyleOptions(styles?: ChatFontStyle[]): Array<[string, string]> {
  const normalized = [...new Set(styles?.length ? styles : ["normal"])];
  return normalized.map((style) => [style, style === "normal" ? "Normal" : style === "italic" ? "Italic" : "Oblique"]);
}

function normalizeWeight(weight: number) {
  return Math.max(100, Math.min(900, Math.round(weight / 100) * 100));
}

function weightLabel(weight: number) {
  if (weight >= 900) return `${weight} Black`;
  if (weight >= 800) return `${weight} ExtraBold`;
  if (weight >= 700) return `${weight} Bold`;
  if (weight >= 600) return `${weight} SemiBold`;
  if (weight >= 500) return `${weight} Medium`;
  if (weight <= 300) return `${weight} Light`;
  return `${weight} Regular`;
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={`${styles.input} ${styles.mono}`}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
      />
      {hint && <span className={styles.fieldHint}>{hint}</span>}
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  hint,
  className,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  hint?: string;
  className?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={`${styles.field} ${className ?? ""}`}>
      <span className={styles.label}>{label}</span>
      <select className={styles.select} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option value={optionValue} key={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
      {hint && <span className={styles.fieldHint}>{hint}</span>}
    </label>
  );
}

function ColorField({ label, value, hint, onChange }: { label: string; value: string; hint?: string; onChange: (value: string) => void }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <span className={styles.colorControl}>
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
        <span className={styles.mono}>{value}</span>
      </span>
      {hint && <span className={styles.fieldHint}>{hint}</span>}
    </label>
  );
}

function CheckBox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={styles.renderCheckbox}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
