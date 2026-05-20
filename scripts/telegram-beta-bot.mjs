#!/usr/bin/env node
import { appendFileSync } from "node:fs";

import { createLicenseKey, normalizeMachineId } from "./license-keygen.mjs";

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedUsers = parseAllowedUsers(process.env.FETCHR_BETA_ALLOWED_USERS);
const logPath = process.env.FETCHR_BETA_BOT_LOG || "beta-bot-licenses.jsonl";
const requiredChannel = normalizeChannel(process.env.FETCHR_BETA_REQUIRED_CHANNEL);
const requiredChannelUrl =
  process.env.FETCHR_BETA_REQUIRED_CHANNEL_URL || channelToUrl(requiredChannel);

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}

let offset = Number(process.env.TELEGRAM_BOT_OFFSET || 0);

console.log("Fetchr beta Telegram bot started");

while (true) {
  try {
    const updates = await telegram("getUpdates", {
      offset,
      timeout: 30,
      allowed_updates: ["message"],
    });

    for (const update of updates.result || []) {
      offset = Math.max(offset, update.update_id + 1);
      await handleUpdate(update);
    }
  } catch (err) {
    console.error(String(err instanceof Error ? err.stack || err.message : err));
    await sleep(3000);
  }
}

async function handleUpdate(update) {
  const message = update.message;
  if (!message?.chat?.id) return;

  const from = message.from || {};
  const chatId = message.chat.id;

  if (allowedUsers.size && !allowedUsers.has(String(from.id))) {
    await sendMessage(chatId, "Доступ к закрытой beta-версии не выдан для этого Telegram-аккаунта.");
    return;
  }

  const text = message.text || "";
  const machineId = extractMachineId(text);

  if (!machineId) {
    await sendStartInstructions(chatId);
    return;
  }

  if (requiredChannel) {
    const subscription = await checkRequiredSubscription(requiredChannel, from.id);
    if (!subscription.ok) {
      await sendMessage(
        chatId,
        subscription.setupError
          ? "Бот не может проверить подписку. Проверь, что бот добавлен администратором в официальный канал, затем попробуй еще раз."
          : [
              "Для получения beta-ключа нужна подписка на официальный канал Fetchr.",
              "",
              "1. Подпишись на канал.",
              "2. Вернись сюда.",
              "3. Отправь Machine ID еще раз.",
            ].join("\n"),
        subscribeKeyboard(),
      );
      return;
    }
  }

  try {
    const normalized = normalizeMachineId(machineId);
    const testerName =
      [from.username && `@${from.username}`, from.first_name, from.last_name]
        .filter(Boolean)
        .join(" ")
        .trim() || `Telegram ${from.id || "tester"}`;
    const key = createLicenseKey({
      machine_id: normalized,
      name: testerName,
      note: `telegram:${from.id || "unknown"}`,
    });

    appendFileSync(
      logPath,
      `${JSON.stringify({
        issued_at: new Date().toISOString(),
        machine_id: normalized,
        license_key: key,
        telegram_user_id: from.id || null,
        username: from.username || null,
        first_name: from.first_name || null,
        last_name: from.last_name || null,
      })}\n`,
      "utf8",
    );

    await sendMessage(
      chatId,
      [
        requiredChannel ? `Подписка на ${requiredChannel} проверена.` : null,
        "Ключ закрытой beta-версии создан и привязан к этому устройству.",
        "",
        key,
        "",
        "Скопируй ключ в поле активации Fetchr.",
        "Если отписаться от официального канала, ключ будет сброшен и перестанет работать.",
      ].filter(Boolean).join("\n"),
    );
  } catch (err) {
    await sendMessage(chatId, `Machine ID не принят: ${String(err instanceof Error ? err.message : err)}`);
  }
}

async function sendStartInstructions(chatId) {
  const lines = [];

  if (requiredChannel) {
    lines.push(
      "Для beta-доступа нужна подписка на официальный канал Fetchr.",
      "",
      "Сначала подпишись на канал, затем отправь Machine ID из приложения.",
    );
  } else {
    lines.push("Отправь Machine ID из Fetchr.");
  }

  lines.push(
    "",
    "Machine ID можно скопировать в Fetchr: Настройки -> Лицензия и beta -> Machine ID.",
    "Если пришел из приложения по кнопке Telegram, нажми Start еще раз или отправь код вручную.",
  );

  await sendMessage(chatId, lines.join("\n"), requiredChannel ? subscribeKeyboard() : {});
}

function extractMachineId(text) {
  const directStart = text.match(/(?:^|\s)\/start\s+fetchr_([A-Fa-f0-9]{32})(?:\s|$)/);
  if (directStart) return directStart[1];
  const startPayload = text.match(/fetchr_([A-Fa-f0-9]{32})/);
  if (startPayload) return startPayload[1];
  const plain = text.match(/\b[A-Fa-f0-9]{32}\b/);
  return plain?.[0] || null;
}

async function sendMessage(chatId, text, extra = {}) {
  await telegram("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...extra,
  });
}

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(json)}`);
  }
  return json;
}

function parseAllowedUsers(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

async function checkRequiredSubscription(channel, userId) {
  if (!userId) return { ok: false, setupError: false };
  try {
    const response = await telegram("getChatMember", {
      chat_id: channel,
      user_id: userId,
    });
    const status = response.result?.status;
    if (["creator", "administrator", "member"].includes(status)) {
      return { ok: true, setupError: false };
    }
    if (status === "restricted" && response.result?.is_member) {
      return { ok: true, setupError: false };
    }
    return { ok: false, setupError: false };
  } catch (err) {
    console.error(`Subscription check failed: ${String(err instanceof Error ? err.message : err)}`);
    return { ok: false, setupError: true };
  }
}

function subscribeKeyboard() {
  if (!requiredChannelUrl) return {};
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Подписаться на канал",
            url: requiredChannelUrl,
          },
        ],
      ],
    },
  };
}

function normalizeChannel(value) {
  const channel = String(value || "").trim();
  if (!channel) return "";
  if (channel.startsWith("-100")) return channel;
  return channel.startsWith("@") ? channel : `@${channel}`;
}

function channelToUrl(channel) {
  if (!channel || channel.startsWith("-100")) return "";
  return `https://t.me/${channel.replace(/^@/, "")}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
