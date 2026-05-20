import { useEffect, useState } from "react";
import { Copy, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ipc } from "@/lib/ipc";
import { StreamDownloader } from "@/lib/stream-downloader";
import { useSettings } from "@/stores/settings";

export function LegacyFinderPage() {
  const settings = useSettings();
  const [sourceUrl, setSourceUrl] = useState("");
  const [username, setUsername] = useState("");
  const [streamId, setStreamId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const value = sourceUrl.trim();
    if (!value) return;
    let cancelled = false;
    void ipc.twitchParseUrl(value).then((hint) => {
      if (cancelled) return;
      if (hint.username) setUsername((current) => current || hint.username || "");
      if (hint.stream_id) setStreamId((current) => current || hint.stream_id || "");
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sourceUrl]);

  const fetchTracker = async () => {
    if (!sourceUrl.trim()) return;
    setLoading(true);
    setStatus("");
    try {
      const meta = await ipc.twitchTrackerFetch(sourceUrl.trim());
      if (meta.username) setUsername(meta.username);
      if (meta.stream_id) setStreamId(meta.stream_id);
      if (meta.start_time) setStartTime(meta.start_time);
      setStatus("Метаданные подтянуты.");
    } catch (error) {
      setStatus(String(error));
    } finally {
      setLoading(false);
    }
  };

  const search = async () => {
    setLoading(true);
    setStatus("");
    try {
      const result = await ipc.twitchFindM3u8({
        username,
        stream_id: streamId,
        start_time: startTime,
        timezone: null,
        window: null,
      });
      setUrls(result.urls);
      setStatus(`Проверено ${result.tried}, найдено ${result.urls.length}`);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setLoading(false);
    }
  };

  const enqueue = async (url: string) => {
    await StreamDownloader.enqueue({
      url,
      name: `Recovered_${streamId || "m3u8"}`,
      directory: settings.directory,
      job_kind: "video",
      mode: "vod",
      download_kind: "video",
      start: null,
      end: null,
      fragments: [],
      split: false,
      split_interval_minutes: null,
      quality: null,
      quality_has_audio: null,
      quality_has_video: null,
      proxy: settings.proxy,
      chat_overlay: { ...settings.chatOverlay, enabled: false },
      performance: settings.performance,
      blur_zones: [],
      binaries_dir: settings.binariesDir,
      meta: { platform: "hls", title: `Recovered ${streamId || "m3u8"}` },
    });
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto bg-canvas p-5">
      <header>
        <h1 className="text-[16px] font-semibold">M3U8 Finder</h1>
        <p className="mt-1 text-[12px] text-fg-tertiary">Поиск recovered m3u8 по TwitchTracker / StreamCharts / SullyGnome.</p>
      </header>

      <section className="grid gap-3 rounded border border-border-default bg-elevated p-4">
        <label className="grid gap-1 text-[12px] text-fg-secondary">
          Ссылка на tracker
          <Input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://twitchtracker.com/..." />
        </label>
        <div className="grid gap-3 md:grid-cols-3">
          <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Никнейм" />
          <Input value={streamId} onChange={(event) => setStreamId(event.target.value)} placeholder="Stream ID" />
          <Input value={startTime} onChange={(event) => setStartTime(event.target.value)} placeholder="Время начала" />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="md" onClick={fetchTracker} disabled={loading}>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Подтянуть
          </Button>
          <Button variant="primary" size="md" onClick={search} disabled={loading || !username || !streamId || !startTime}>
            Найти m3u8
          </Button>
        </div>
        {status && <div className="text-[12px] text-fg-tertiary">{status}</div>}
      </section>

      <section className="grid gap-2 rounded border border-border-default bg-elevated p-4">
        <h2 className="text-[13px] font-semibold">Найденные плейлисты</h2>
        {urls.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-fg-tertiary">Ничего не найдено.</div>
        ) : (
          urls.map((url) => (
            <div key={url} className="flex items-center gap-2 rounded border border-border-subtle bg-surface p-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-secondary">{url}</span>
              <Button variant="ghost" size="icon-sm" onClick={() => navigator.clipboard.writeText(url)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void enqueue(url)}>
                <Plus className="h-3.5 w-3.5" />
                В очередь
              </Button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
