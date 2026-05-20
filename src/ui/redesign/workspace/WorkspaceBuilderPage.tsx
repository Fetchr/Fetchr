import { useWorkflowPresets } from "@/stores/workflowPresets";
import { RedesignIcon } from "@/ui/redesign/icons/iconMap";
import { fetchrThemeClassName } from "@/ui/redesign/theme";

import styles from "./WorkspaceBuilderPage.module.css";

export function WorkspaceBuilderPage() {
  const m3u8Presets = useWorkflowPresets((state) => state.m3u8Presets);
  const chatPresets = useWorkflowPresets((state) => state.chatPresets);
  const sponsorPresets = useWorkflowPresets((state) => state.sponsorPresets);
  const createM3u8Preset = useWorkflowPresets((state) => state.createM3u8Preset);
  const renameM3u8Preset = useWorkflowPresets((state) => state.renameM3u8Preset);
  const updateM3u8Preset = useWorkflowPresets((state) => state.updateM3u8Preset);
  const createChatPreset = useWorkflowPresets((state) => state.createChatPreset);
  const renameChatPreset = useWorkflowPresets((state) => state.renameChatPreset);
  const createSponsorPreset = useWorkflowPresets((state) => state.createSponsorPreset);
  const renameSponsorPreset = useWorkflowPresets((state) => state.renameSponsorPreset);

  return (
    <div className={`${fetchrThemeClassName} ${styles.page}`}>
      <header className={styles.workspaceToolbar}>
        <div>
          <h1>Пресеты быстрого скачивания</h1>
          <p>Workspace больше не является конструктором блоков. Здесь хранятся быстрые пресеты для повторяющихся стримеров, чата и блюра.</p>
        </div>
      </header>

      <main className={styles.presetManagerGrid}>
        <section className={styles.presetManagerCard}>
          <div className={styles.presetManagerHeader}>
            <div>
              <h2>M3U8 Finder</h2>
              <p>Эти пресеты отображаются под M3U8 Finder в левой панели.</p>
            </div>
            <button className={styles.presetManagerButton} type="button" onClick={() => createM3u8Preset(null)}>
              <RedesignIcon name="add" />
              Создать
            </button>
          </div>
          <div className={styles.presetManagerList}>
            {m3u8Presets.length === 0 ? <div className={styles.presetManagerEmpty}>Создайте пресет через плюс у M3U8 Finder.</div> : null}
            {m3u8Presets.map((preset) => (
              <div className={styles.presetManagerRow} key={preset.id}>
                <input value={preset.name} onChange={(event) => renameM3u8Preset(preset.id, event.currentTarget.value)} />
                <input value={preset.streamer} placeholder="ник стримера" onChange={(event) => updateM3u8Preset(preset.id, { streamer: event.currentTarget.value })} />
              </div>
            ))}
          </div>
        </section>

        <section className={styles.presetManagerCard}>
          <div className={styles.presetManagerHeader}>
            <div>
              <h2>Рендер чата</h2>
              <p>Пресеты выбираются внутри раздела рендера чата и не добавляются в левую панель.</p>
            </div>
            <button className={styles.presetManagerButton} type="button" onClick={() => createChatPreset(chatPresets[0]?.id ?? null)}>
              <RedesignIcon name="copy" />
              Копия
            </button>
          </div>
          <div className={styles.presetManagerList}>
            {chatPresets.map((preset) => (
              <div className={styles.presetManagerRow} key={preset.id}>
                <input value={preset.name} onChange={(event) => renameChatPreset(preset.id, event.currentTarget.value)} />
                <span>{preset.overlay.font_family ?? "system"} · {preset.overlay.font_size ?? 24}px</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.presetManagerCard}>
          <div className={styles.presetManagerHeader}>
            <div>
              <h2>Блюр спонсоров</h2>
              <p>Пресеты выбираются над экраном блюра и при добавлении задачи.</p>
            </div>
            <button className={styles.presetManagerButton} type="button" onClick={() => createSponsorPreset(sponsorPresets[0]?.id ?? null)}>
              <RedesignIcon name="copy" />
              Копия
            </button>
          </div>
          <div className={styles.presetManagerList}>
            {sponsorPresets.map((preset) => (
              <div className={styles.presetManagerRow} key={preset.id}>
                <input value={preset.name} onChange={(event) => renameSponsorPreset(preset.id, event.currentTarget.value)} />
                <span>{preset.zones.length} зон</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
