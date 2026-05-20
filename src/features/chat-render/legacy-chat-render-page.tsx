import { useState } from "react";
import { FolderOpen, Loader2, MessageSquareText, Play, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ipc } from "@/lib/ipc";
import { StreamDownloader } from "@/lib/stream-downloader";
import { detectPlatform } from "@/lib/url";
import { renderKickNormalizedChatJson } from "@/services/chat";
import { exportKickChatJson, KICK_CHAT_REPLAY_UNAVAILABLE } from "@/services/kick";
import { useSettings } from "@/stores/settings";

type Platform = "twitch" | "kick";

export function LegacyChatRenderPage() {
  const settings = useSettings();
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("stream_chat");
  const [directory, setDirectory] = useState(settings.directory);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState<"json" | "render" | "queue" | null>(null);
  const [status, setStatus] = useState("");
  const [messages, setMessages] = useState<number | null>(null);

  const chooseDirectory = async () => {
    const path = await ipc.chooseDirectory();
    if (path) setDirectory(path);
  };

  const enqueue = async () => {
    if (!url.trim() || !name.trim() || !directory.trim()) return;
    setBusy("queue");
    setStatus("");
    try {
      await StreamDownloader.enqueueChatOnly(
        {
          url: url.trim(),
          name: name.trim(),
          directory: directory.trim(),
          job_kind: "chat",
          mode: "vod",
          download_kind: "video",
          start: start.trim() || null,
          end: end.trim() || null,
          fragments: [],
          split: false,
          split_interval_minutes: null,
          quality: null,
          quality_has_audio: null,
          quality_has_video: null,
          proxy: settings.proxy,
          chat_overlay: settings.chatOverlay,
          performance: settings.performance,
          blur_zones: [],
          binaries_dir: settings.binariesDir,
          meta: { platform: platform === "kick" ? "kick" : detectPlatform(url) },
        },
        settings.chatOverlay,
      );
      setStatus("Экспорт чата добавлен в очередь.");
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(null);
    }
  };

  const downloadKick = async (render: boolean) => {
    if (!url.trim() || !name.trim() || !directory.trim()) return;
    setBusy(render ? "render" : "json");
    setStatus("");
    try {
      const exported = await exportKickChatJson({
        input: {
          source: url.trim(),
          existingTask: {
            url: url.trim(),
            name: name.trim(),
            directory: directory.trim(),
            meta: { platform: "kick", title: name.trim() },
          },
        },
        outputDirectory: directory.trim(),
        baseFileName: name.trim(),
      });
      setMessages(exported.messages.length);
      if (render) {
        const rendered = await renderKickNormalizedChatJson(exported.messages, {
          outputDirectory: directory.trim(),
          outputName: name.trim(),
          chatOverlay: settings.chatOverlay,
          performance: settings.performance,
          binariesDir: settings.binariesDir,
        });
        setStatus(`JSON сохранён. Рендер: ${rendered.outputPath}`);
      } else {
        setStatus(`JSON сохранён: ${exported.normalizedPath}`);
      }
    } catch (error) {
      const message = String(error);
      setStatus(message.includes(KICK_CHAT_REPLAY_UNAVAILABLE) ? KICK_CHAT_REPLAY_UNAVAILABLE : message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-auto bg-canvas">
      <div className="border-b border-border-default px-6 py-4">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-5 w-5 text-accent" />
          <h1 className="text-[18px] font-semibold">Рендер чата</h1>
        </div>
        <p className="mt-1 text-[12px] text-fg-tertiary">Экспорт Twitch/Kick чата отдельным файлом или задачей очереди.</p>
      </div>

      <div className="mx-auto grid w-full max-w-3xl gap-4 p-6">
        <section className="grid gap-3 rounded border border-border-default bg-elevated p-4">
          <div className="grid gap-3 md:grid-cols-[180px_1fr]">
            <Select value={platform} onValueChange={(value) => setPlatform(value as Platform)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="twitch">Twitch</SelectItem>
                <SelectItem value="kick">Kick</SelectItem>
              </SelectContent>
            </Select>
            <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={platform === "kick" ? "https://kick.com/.../videos/..." : "https://www.twitch.tv/videos/..."} />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Имя файла" />
            <Input value={start} onChange={(event) => setStart(event.target.value)} placeholder="Начало 00:00:00" />
            <Input value={end} onChange={(event) => setEnd(event.target.value)} placeholder="Конец 00:00:00" />
          </div>

          <div className="flex gap-2">
            <Input className="font-mono text-[12px]" value={directory} onChange={(event) => setDirectory(event.target.value)} placeholder="Папка" />
            <Button variant="secondary" size="md" onClick={chooseDirectory}>
              <FolderOpen className="h-3.5 w-3.5" />
              Обзор
            </Button>
          </div>

          {platform === "kick" && (
            <div className="rounded border border-border-subtle bg-surface p-3 text-[12px] text-fg-secondary">
              Kick JSON: {messages == null ? "не скачан" : `скачан, сообщений ${messages}`}
            </div>
          )}

          {status && <div className="rounded border border-border-subtle bg-surface p-3 text-[12px] text-fg-secondary">{status}</div>}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="md" onClick={() => platform === "kick" ? void downloadKick(false) : void enqueue()} disabled={Boolean(busy)}>
              {busy === "json" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Скачать JSON чата
            </Button>
            <Button variant="primary" size="md" onClick={() => platform === "kick" ? void downloadKick(true) : void enqueue()} disabled={Boolean(busy)}>
              {busy === "render" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Рендерить только чат
            </Button>
            <Button variant="secondary" size="md" onClick={() => void enqueue()} disabled={Boolean(busy)}>
              <Plus className="h-3.5 w-3.5" />
              Добавить экспорт в очередь
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
