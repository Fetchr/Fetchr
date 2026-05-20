#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, join, resolve } from "node:path";

const port = Number(process.env.PORT || 8787);
const dataDir = resolve(process.env.FETCHR_VPS_DATA_DIR || "vps-data");
const downloadsDir = resolve(process.env.FETCHR_VPS_DOWNLOADS_DIR || join(dataDir, "downloads"));
const telemetryPath = join(dataDir, "telemetry.jsonl");
const licensesPath = resolve(process.env.FETCHR_BETA_BOT_LOG || join(dataDir, "beta-bot-licenses.jsonl"));
const updatePath = resolve(process.env.FETCHR_UPDATE_JSON || join(dataDir, "latest-update.json"));
const reviewsPath = resolve(process.env.FETCHR_REVIEWS_JSONL || join(dataDir, "reviews.jsonl"));
const reviewFilesDir = resolve(process.env.FETCHR_REVIEW_FILES_DIR || join(dataDir, "review-files"));
const reviewImageLimitBytes = 10 * 1024 * 1024;
const reviewVideoLimitBytes = 100 * 1024 * 1024;
const reviewUploadJsonLimitBytes = 140 * 1024 * 1024;
const telegramToken = process.env.TELEGRAM_BOT_TOKEN || "";
const requiredChannel = normalizeChannel(process.env.FETCHR_BETA_REQUIRED_CHANNEL);

mkdirSync(dataDir, { recursive: true });
mkdirSync(downloadsDir, { recursive: true });
mkdirSync(reviewFilesDir, { recursive: true });

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

    if (req.method === "POST" && url.pathname === "/telemetry/events") {
      const event = await readJson(req);
      validateTelemetryEvent(event);
      await appendFile(telemetryPath, `${JSON.stringify({ ...event, received_at: new Date().toISOString() })}\n`, "utf8");
      return json(res, 202, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/telemetry/summary") {
      return json(res, 200, await telemetrySummary());
    }

    if (req.method === "POST" && url.pathname === "/license/status") {
      const request = await readJson(req);
      validateLicenseStatusRequest(request);
      return json(res, 200, await licenseStatus(request));
    }

    if (req.method === "GET" && url.pathname === "/reviews") {
      const limit = clampNumber(url.searchParams.get("limit"), 1, 100, 10);
      return json(res, 200, { reviews: await publicReviews(limit) });
    }

    if (req.method === "POST" && url.pathname === "/reviews") {
      const request = await readJson(req);
      return json(res, 201, await submitReview(request));
    }

    if (req.method === "POST" && url.pathname === "/reviews/validate-id") {
      const request = await readJson(req);
      return json(res, 200, await validateReviewMachineId(request));
    }

    if (req.method === "POST" && url.pathname === "/review-files") {
      const requestType = String(req.headers["content-type"] || "").toLowerCase();
      if (requestType.startsWith("application/json")) {
        const request = await readJson(req, reviewUploadJsonLimitBytes);
        return json(res, 201, await uploadReviewFile(request));
      }
      const filename = decodeHeaderValue(req.headers["x-fetchr-filename"]) || url.searchParams.get("filename") || "review-file";
      const buffer = await readBuffer(req, reviewVideoLimitBytes + 1024);
      return json(res, 201, await uploadReviewFileBuffer(filename, requestType.split(";")[0], buffer));
    }

    if (req.method === "GET" && url.pathname === "/updates/latest") {
      const currentVersion = url.searchParams.get("current_version") || "0.0.0";
      return json(res, 200, latestUpdate(currentVersion));
    }

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/downloads/")) {
      return serveDownload(res, decodeURIComponent(url.pathname.slice("/downloads/".length)), req.method === "HEAD");
    }

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/review-files/")) {
      return serveReviewFile(res, decodeURIComponent(url.pathname.slice("/review-files/".length)), req.method === "HEAD");
    }

    json(res, 404, { error: "not_found" });
  } catch (err) {
    json(res, 500, { error: String(err instanceof Error ? err.message : err) });
  }
}).listen(port, () => {
  console.log(`Fetchr VPS API listening on http://127.0.0.1:${port}`);
});

async function telemetrySummary() {
  const events = await readJsonLines(telemetryPath);
  let appLaunches = 0;
  let downloadedStreams = 0;
  const streamers = new Map();

  for (const event of events) {
    if (event.event_type === "app_launch") {
      appLaunches += 1;
      continue;
    }
    if (event.event_type === "stream_downloaded") {
      downloadedStreams += 1;
      const payload = event.payload || {};
      const streamer = streamerFromTelemetryPayload(payload);
      if (streamer) {
        const existing = streamers.get(streamer) || {
          streamer,
          downloads: 0,
          platform: platformFromTelemetryPayload(payload),
          avatar_url: null,
          preview_url: null,
        };
        existing.downloads += 1;
        existing.platform ||= platformFromTelemetryPayload(payload);
        existing.avatar_url ||= avatarUrlForStreamer(existing.platform, streamer);
        existing.preview_url ||= previewUrlForStreamer(existing.platform, streamer, payload);
        streamers.set(streamer, existing);
      }
    }
  }

  return {
    app_launches: appLaunches,
    downloaded_streams: downloadedStreams,
    top_streamers: Array.from(streamers.values())
      .sort((a, b) => b.downloads - a.downloads || a.streamer.localeCompare(b.streamer))
      .slice(0, 20),
  };
}

async function licenseStatus(request) {
  const machineId = request.machine_id.toUpperCase();
  const key = normalizeLicenseKey(request.license_key);
  const issued = (await readJsonLines(licensesPath))
    .filter((record) => String(record.machine_id || "").toUpperCase() === machineId)
    .reverse()
    .find((record) => normalizeLicenseKey(record.license_key) === key);

  if (!issued) {
    return {
      active: false,
      reason: "not_issued",
      message: "Ключ не найден в списке выданных beta-доступов.",
    };
  }

  if (issued.revoked_at) {
    return {
      active: false,
      reason: "revoked",
      message: "Beta-доступ отозван.",
    };
  }

  if (!requiredChannel) {
    return {
      active: true,
      reason: "subscription_check_not_configured",
      message: "Проверка подписки на сервере еще не настроена.",
    };
  }

  if (!telegramToken) {
    return {
      active: false,
      reason: "telegram_not_configured",
      message: "Сервер не настроен для проверки Telegram-подписки.",
    };
  }

  const subscription = await checkTelegramSubscription(requiredChannel, issued.telegram_user_id);
  if (!subscription.ok) {
    return {
      active: false,
      reason: subscription.setupError ? "subscription_check_failed" : "subscription_required",
      message: subscription.setupError
        ? "Сервер временно не смог проверить подписку."
        : "Подписка на Telegram-канал обязательна для beta-доступа.",
    };
  }

  return {
    active: true,
    reason: "ok",
    message: null,
  };
}

async function publicReviews(limit = 10) {
  const reviews = await readJsonLines(reviewsPath);
  const selected = reviews
    .filter((review) => review && review.published !== false)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .slice(0, limit);
  return Promise.all(selected.map(publicReview));
}

async function validateReviewMachineId(request) {
  const machineId = normalizeMachineId(request.machine_id || request.id);
  if (!/^[A-F0-9]{32}$/.test(machineId)) {
    return { ok: false, valid: false, reason: "invalid_format", message: "ID должен состоять из 32 символов A-F и 0-9." };
  }

  const issued = await findReviewLicense({ machine_id: machineId });
  if (!issued) {
    return { ok: false, valid: false, reason: "not_found", message: "ID не найден среди выданных beta-доступов." };
  }

  const subscription = requiredChannel && telegramToken
    ? await checkTelegramSubscription(requiredChannel, issued.telegram_user_id)
    : { ok: true };

  if (!subscription.ok) {
    return {
      ok: false,
      valid: false,
      reason: "subscription_required",
      message: "ID найден, но beta-доступ сейчас не активен. Проверь подписку на Telegram-канал.",
    };
  }

  return {
    ok: true,
    valid: true,
    issued_at: issued.issued_at,
    message: "ID подтвержден.",
  };
}

async function submitReview(request) {
  validateReviewRequest(request);

  const issued = await findReviewLicense(request);

  if (!issued) {
    return {
      ok: false,
      error: "license_not_found",
      message: "Ключ подтверждения не найден среди выданных beta-ключей Fetchr.",
    };
  }

  const subscription = requiredChannel && telegramToken
    ? await checkTelegramSubscription(requiredChannel, issued.telegram_user_id)
    : { ok: true };

  if (!subscription.ok) {
    return {
      ok: false,
      error: "subscription_required",
      message: "Для публикации отзыва ключ должен быть активен, а Telegram-подписка должна быть действующей.",
    };
  }

  const createdAt = new Date().toISOString();
  const displayName = cleanText(request.display_name || request.project_username, 80);
  const nickname = cleanText(request.nickname || request.project_username, 80);
  const contactUrl = normalizeProfileUrl(request.contact_url || request.telegram || request.youtube || request.discord);
  const profileUrl = normalizeProfileUrl(request.profile_url || request.contact_url || request.telegram || request.youtube || request.discord);
  const telegramUrl = normalizeProfileUrl(request.telegram || request.contact_url);
  const avatarUrl = normalizeAvatarUrl(request.avatar_url) || await avatarFromProfiles({
    telegram: telegramUrl,
    profile: profileUrl,
  });
  const reviewSubject = normalizeLicenseKey(issued.license_key) || normalizeMachineId(issued.machine_id);
  const id = createHash("sha256")
    .update(`${issued.machine_id}:${reviewSubject}:${createdAt}`)
    .digest("hex")
    .slice(0, 16);

  const review = {
    id,
    published: true,
    created_at: createdAt,
    display_name: displayName,
    project_username: nickname || displayName,
    rating: Number(request.rating),
    contact_url: contactUrl,
    experience: cleanText(request.experience || request.text, 3000),
    text: cleanText(request.text || formatReviewText(request), 3000),
    profile_url: profileUrl,
    telegram_url: telegramUrl,
    youtube_url: normalizeProfileUrl(request.youtube),
    discord_url: cleanText(request.discord, 120),
    proof_url: normalizeProofUrl(request.proof_url),
    avatar_url: avatarUrl,
    allow_profile: Boolean(request.allow_profile),
    personal_experience: true,
    usage_started_at: issued.issued_at,
    machine_id: issued.machine_id,
    telegram_user_id: issued.telegram_user_id || null,
    license_hash: createHash("sha256").update(reviewSubject).digest("hex"),
  };

  await appendFile(reviewsPath, `${JSON.stringify(review)}\n`, "utf8");
  return { ok: true, review: await publicReview(review) };
}

async function publicReview(review) {
  const avatarUrl = review.avatar_url
    || telegramAvatarFromProfile(review.telegram_url || review.profile_url)
    || await publicProfileAvatar(review.profile_url || review.telegram_url);
  return {
    id: review.id,
    created_at: review.created_at,
    display_name: review.display_name,
    project_username: review.project_username,
    contact_url: review.contact_url,
    pros: review.pros,
    cons: review.cons,
    experience: review.experience,
    rating: review.rating,
    text: review.text,
    profile_url: review.profile_url,
    telegram_url: review.telegram_url,
    youtube_url: review.youtube_url,
    discord_url: review.discord_url,
    proof_url: review.proof_url,
    avatar_url: avatarUrl,
    allow_profile: Boolean(review.allow_profile),
    usage_started_at: review.usage_started_at,
    usage_label: usageLabel(review.usage_started_at),
  };
}

function latestUpdate(currentVersion) {
  const update = readUpdateConfig();
  if (!update.version || !update.installer_url) {
    return { available: false, version: currentVersion };
  }
  return {
    ...update,
    available: update.available ?? versionIsNewer(update.version, currentVersion),
  };
}

function readUpdateConfig() {
  if (existsSync(updatePath)) {
    return JSON.parse(readFileSync(updatePath, "utf8"));
  }

  const version = process.env.FETCHR_UPDATE_VERSION || "";
  const file = process.env.FETCHR_UPDATE_FILE || "";
  const installerUrl =
    process.env.FETCHR_UPDATE_INSTALLER_URL ||
    (file ? `/downloads/${encodeURIComponent(basename(file))}` : "");

  return {
    version,
    installer_url: installerUrl,
    installer_sha256: process.env.FETCHR_UPDATE_SHA256 || "",
    notes: process.env.FETCHR_UPDATE_NOTES || "",
    published_at: process.env.FETCHR_UPDATE_PUBLISHED_AT || new Date().toISOString(),
  };
}

function serveDownload(res, name, headOnly = false) {
  const safeName = basename(name);
  const path = resolve(downloadsDir, safeName);
  if (!path.startsWith(downloadsDir) || !existsSync(path)) {
    return json(res, 404, { error: "download_not_found" });
  }

  const meta = statSync(path);
  res.writeHead(200, {
    "Content-Type": contentType(path),
    "Content-Length": String(meta.size),
    "Content-Disposition": `attachment; filename="${safeName.replaceAll('"', "")}"`,
  });
  if (headOnly) return res.end();
  createReadStream(path).pipe(res);
}

function serveReviewFile(res, name, headOnly = false) {
  const safeName = basename(name);
  const path = resolve(reviewFilesDir, safeName);
  if (!path.startsWith(reviewFilesDir) || !existsSync(path)) {
    return json(res, 404, { error: "review_file_not_found" });
  }

  const meta = statSync(path);
  res.writeHead(200, {
    "Content-Type": contentType(path),
    "Content-Length": String(meta.size),
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  if (headOnly) return res.end();
  createReadStream(path).pipe(res);
}

async function uploadReviewFile(request) {
  if (!request || typeof request !== "object") throw new Error("request must be an object");
  const filename = cleanText(request.filename, 160);
  const content = cleanText(request.content_type, 80).toLowerCase();
  const base64 = String(request.data_base64 || "").replace(/^data:[^;]+;base64,/, "");

  if (!filename || !base64) throw new Error("file required");
  const buffer = Buffer.from(base64, "base64");
  return uploadReviewFileBuffer(filename, content, buffer);
}

async function uploadReviewFileBuffer(filename, contentTypeValue, buffer) {
  const filenameClean = cleanText(filename, 160);
  const content = cleanText(contentTypeValue, 80).toLowerCase();

  if (!filenameClean || !buffer) throw new Error("file required");
  if (!/^(image|video)\//.test(content)) throw new Error("unsupported file type");
  if (!buffer.length) throw new Error("empty file");
  if (content.startsWith("image/") && buffer.length > reviewImageLimitBytes) {
    throw new Error("Фото должно быть не больше 10 МБ.");
  }
  if (content.startsWith("video/") && buffer.length > reviewVideoLimitBytes) {
    throw new Error("Видео должно быть не больше 100 МБ.");
  }

  const extension = safeReviewFileExtension(filenameClean, content);
  const safeName = `${Date.now()}-${randomUUID()}${extension}`;
  await writeFile(resolve(reviewFilesDir, safeName), buffer);
  return { ok: true, url: `/api/review-files/${encodeURIComponent(safeName)}` };
}

function validateTelemetryEvent(event) {
  if (!event || typeof event !== "object") throw new Error("event must be an object");
  if (!["app_launch", "stream_downloaded"].includes(event.event_type)) {
    throw new Error("unsupported event_type");
  }
  if (typeof event.machine_id !== "string" || !/^[A-F0-9]{32}$/i.test(event.machine_id)) {
    throw new Error("invalid machine_id");
  }
  if (!event.payload || typeof event.payload !== "object") {
    throw new Error("payload must be an object");
  }
}

function validateLicenseStatusRequest(request) {
  if (!request || typeof request !== "object") throw new Error("request must be an object");
  if (typeof request.machine_id !== "string" || !/^[A-F0-9]{32}$/i.test(request.machine_id)) {
    throw new Error("invalid machine_id");
  }
  if (typeof request.license_key !== "string" || !request.license_key.trim()) {
    throw new Error("invalid license_key");
  }
}

function validateReviewRequest(request) {
  if (!request || typeof request !== "object") throw new Error("request must be an object");

  const displayName = cleanText(request.display_name || request.project_username, 80);
  if (displayName.length < 2) throw new Error("????? ???.");

  const machineId = normalizeMachineId(request.machine_id || request.id);
  if (!/^[A-F0-9]{32}$/.test(machineId) && !normalizeLicenseKey(request.verification_token)) {
    throw new Error("????? ?????????? Machine ID.");
  }

  const rating = Number(request.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("?????? ?????? ???? ?????? ?? 1 ?? 5.");
  }

  const experience = cleanText(request.experience || request.text, 3000);
  if (experience.length < 100) throw new Error("???????? ????? ?????? ???? ??????? 100 ????????.");

  const contactUrl = normalizeProfileUrl(request.contact_url || request.telegram || request.youtube || request.discord);
  if (!contactUrl) throw new Error("????? ??????? ??? ????? ? ?????.");

  if (!request.rules_consent) throw new Error("????? ???????? ? ????????? ??????????.");
  if (!request.personal_experience) throw new Error("????? ????????????? ??????? ?????.");
  if (!request.allow_profile) throw new Error("????? ?????????? ?? ????? ????????? ?????? ??????.");
}

async function readJson(req, maxBytes = 256 * 1024) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxBytes) throw new Error("request body too large");
  }
  return JSON.parse(body || "{}");
}

async function readBuffer(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function readJsonLines(path) {
  if (!existsSync(path)) return [];
  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeStreamer(value) {
  const streamer = String(value || "").trim().replace(/^@/, "").toLowerCase();
  return streamer || null;
}

function streamerFromTelemetryPayload(payload) {
  return normalizeStreamer(payload?.streamer)
    || parseCreatorFromUrl(payload?.source_url_hint)
    || parseCreatorFromUrl(payload?.chat_source_url_hint)
    || parseCreatorFromUrl(payload?.source_url)
    || parseCreatorFromUrl(payload?.url);
}

function platformFromTelemetryPayload(payload) {
  const explicit = String(payload?.platform || "").trim().toLowerCase();
  if (explicit && explicit !== "hls" && explicit !== "unknown") return explicit;
  const url = [
    payload?.source_url_hint,
    payload?.chat_source_url_hint,
    payload?.source_url,
    payload?.url,
  ].filter(Boolean).join(" ").toLowerCase();
  if (url.includes("twitch.tv") || url.includes("ttvnw.net") || url.includes("jtvnw.net") || url.includes("twitchcdn.net")) return "twitch";
  if (url.includes("kick.com")) return "kick";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  return explicit || "unknown";
}

function parseCreatorFromUrl(input, depth = 0) {
  if (!input || depth > 2) return null;
  let parsed;
  try {
    parsed = new URL(String(input));
  } catch {
    return null;
  }

  for (const value of parsed.searchParams.values()) {
    if (/^https?:\/\//i.test(value)) {
      const nested = parseCreatorFromUrl(value, depth + 1);
      if (nested) return nested;
    }
  }

  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);
  const first = segments[0] || "";

  if (host.includes("twitch.tv")) {
    if (!first || ["videos", "video", "v", "clip", "directory"].includes(first.toLowerCase())) return null;
    return normalizeStreamer(first);
  }

  if (host.includes("kick.com")) {
    if (!first || ["video", "categories"].includes(first.toLowerCase())) return null;
    return normalizeStreamer(first);
  }

  if (host.includes("youtube.com") || host.includes("youtu.be")) {
    if (first.startsWith("@")) return normalizeStreamer(first);
    if (["c", "channel", "user"].includes(first.toLowerCase()) && segments[1]) return normalizeStreamer(segments[1]);
  }

  if (host.includes("usher.ttvnw.net") && segments[0] === "api" && segments[1] === "channel" && segments[2] === "hls") {
    return normalizeStreamer((segments[3] || "").replace(/\.m3u8$/i, ""));
  }

  if (
    parsed.pathname.toLowerCase().includes(".m3u8")
    || host.includes("ttvnw.net")
    || host.includes("jtvnw.net")
    || host.includes("twitchcdn.net")
    || host.includes("cloudfront.net")
  ) {
    for (const segment of segments) {
      const match = segment.match(/^[a-f0-9]+_([A-Za-z0-9_]{2,25})_\d+_\d+/);
      if (match) return normalizeStreamer(match[1]);
    }
  }

  return null;
}

function avatarUrlForStreamer(platform, streamer) {
  const value = normalizeStreamer(streamer);
  if (!value) return null;
  if (platform === "youtube") return `https://unavatar.io/youtube/${encodeURIComponent(value.replace(/^@/, ""))}`;
  if (platform === "kick") return `https://unavatar.io/kick/${encodeURIComponent(value)}`;
  if (platform === "twitch" || platform === "hls" || platform === "unknown") return `https://unavatar.io/twitch/${encodeURIComponent(value)}`;
  return `https://unavatar.io/${encodeURIComponent(value)}`;
}

function previewUrlForStreamer(platform, streamer, payload) {
  if (payload?.thumbnail && /^https?:\/\//i.test(String(payload.thumbnail))) return String(payload.thumbnail);
  const value = normalizeStreamer(streamer);
  if (!value) return null;
  if (platform === "twitch" || platform === "hls" || platform === "unknown") {
    return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(value)}-440x248.jpg`;
  }
  return null;
}

function normalizeLicenseKey(value) {
  return String(value || "").replace(/\s+/g, "");
}

function formatReviewText(request) {
  return cleanText(request.experience || request.text, 3000);
  const parts = [];
  const pros = cleanText(request.pros, 1000);
  const cons = cleanText(request.cons, 1000);
  const experience = cleanText(request.experience, 3000);
  if (pros) parts.push(`Достоинства: ${pros}`);
  if (cons) parts.push(`Недостатки: ${cons}`);
  if (experience) parts.push(`Опыт: ${experience}`);
  return parts.join("\n\n");
}

function normalizeMachineId(value) {
  return String(value || "").replace(/[^A-F0-9]/gi, "").toUpperCase();
}

async function findReviewLicense(request) {
  const machineId = normalizeMachineId(request.machine_id || request.id);
  const token = normalizeLicenseKey(request.verification_token);
  const issued = (await readJsonLines(licensesPath))
    .filter((record) => {
      if (record.revoked_at) return false;
      if (machineId && normalizeMachineId(record.machine_id) === machineId) return true;
      if (token && normalizeLicenseKey(record.license_key) === token) return true;
      return false;
    })
    .reverse()[0];
  return issued || null;
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function decodeHeaderValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "";
  try {
    return decodeURIComponent(String(raw));
  } catch {
    return String(raw);
  }
}

function wordCount(value) {
  return cleanText(value, 10000).split(/\s+/).filter(Boolean).length;
}

function normalizeProfileUrl(value) {
  const raw = cleanText(value, 300);
  if (!raw) return "";
  if (/^@[A-Za-z0-9_]{3,64}$/.test(raw)) return `https://t.me/${raw.slice(1)}`;
  if (/^[A-Za-z0-9_]{3,64}$/.test(raw)) return raw.includes(".") ? `https://${raw}` : raw;
  try {
    const url = new URL(raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeAvatarUrl(value) {
  const url = normalizeProfileUrl(value);
  if (!url) return "";
  if (!/\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(url)) return "";
  return url;
}

function normalizeProofUrl(value) {
  const raw = cleanText(value, 500);
  if (!raw) return "";
  if (/^\/api\/review-files\/[A-Za-z0-9%_.-]+$/.test(raw)) return raw;
  return normalizeProfileUrl(raw);
}

async function avatarFromProfiles({ telegram, profile }) {
  const source = telegram || profile || "";
  try {
    const url = new URL(source);
    const telegramAvatar = telegramAvatarFromProfile(url.toString());
    if (telegramAvatar) return telegramAvatar;
    return await fetchProfileAvatar(url);
  } catch {
    return "";
  }
}

async function publicProfileAvatar(source) {
  try {
    if (!source) return "";
    return await fetchProfileAvatar(new URL(source));
  } catch {
    return "";
  }
}

function telegramAvatarFromProfile(source) {
  try {
    const url = new URL(source);
    if (/(^|\.)t\.me$/i.test(url.hostname) || /(^|\.)telegram\.me$/i.test(url.hostname)) {
      const username = url.pathname.split("/").filter(Boolean)[0];
      if (username) return `https://t.me/i/userpic/320/${encodeURIComponent(username)}.jpg`;
    }
  } catch {
    return "";
  }
  return "";
}

async function fetchProfileAvatar(url) {
  if (!["http:", "https:"].includes(url.protocol)) return "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": "FetchrReviewBot/1.0 (+https://fetchr.fun)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) return "";
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html")) return "";
    const html = (await response.text()).slice(0, 256 * 1024);
    const match = html.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    if (!match?.[1]) return "";
    const avatar = new URL(match[1], url).toString();
    return normalizeAvatarUrl(avatar) || avatar;
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function usageLabel(value) {
  const started = Date.parse(value || "");
  if (!Number.isFinite(started)) return "срок пользования подтверждается";
  const days = Math.max(0, Math.floor((Date.now() - started) / 86_400_000));
  if (days === 0) return "пользуется сегодня";
  if (days === 1) return "пользуется 1 день";
  if (days < 30) return `пользуется ${days} ${pluralRu(days, "день", "дня", "дней")}`;
  const months = Math.floor(days / 30);
  const restDays = days % 30;
  if (restDays === 0) return `пользуется ${months} ${pluralRu(months, "месяц", "месяца", "месяцев")}`;
  return `пользуется ${months} ${pluralRu(months, "месяц", "месяца", "месяцев")} ${restDays} ${pluralRu(restDays, "день", "дня", "дней")}`;
}

function pluralRu(value, one, few, many) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function normalizeChannel(value) {
  const channel = String(value || "").trim();
  if (!channel) return "";
  if (channel.startsWith("-100")) return channel;
  return channel.startsWith("@") ? channel : `@${channel}`;
}

async function checkTelegramSubscription(channel, userId) {
  if (!userId) return { ok: false, setupError: false };
  try {
    const response = await fetch(`https://api.telegram.org/bot${telegramToken}/getChatMember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: channel,
        user_id: userId,
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      return { ok: false, setupError: true };
    }
    const status = payload.result?.status;
    if (["creator", "administrator", "member"].includes(status)) {
      return { ok: true, setupError: false };
    }
    if (status === "restricted" && payload.result?.is_member) {
      return { ok: true, setupError: false };
    }
    return { ok: false, setupError: false };
  } catch {
    return { ok: false, setupError: true };
  }
}

function versionIsNewer(candidate, current) {
  const left = parseVersion(candidate);
  const right = parseVersion(current);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] || 0;
    const b = right[index] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

function parseVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function contentType(path) {
  switch (extname(path).toLowerCase()) {
    case ".exe": return "application/vnd.microsoft.portable-executable";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    case ".mov": return "video/quicktime";
    default: return "application/octet-stream";
  }
}

function safeReviewFileExtension(filename, contentTypeValue) {
  const extension = extname(filename).toLowerCase();
  const allowed = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov"]);
  if (allowed.has(extension)) return extension;
  if (contentTypeValue === "image/png") return ".png";
  if (contentTypeValue === "image/jpeg") return ".jpg";
  if (contentTypeValue === "image/webp") return ".webp";
  if (contentTypeValue === "image/gif") return ".gif";
  if (contentTypeValue === "video/mp4") return ".mp4";
  if (contentTypeValue === "video/webm") return ".webm";
  if (contentTypeValue === "video/quicktime") return ".mov";
  throw new Error("unsupported file type");
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
