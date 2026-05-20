# VPS API для Fetchr beta

Приложение берёт адрес VPS из переменной сборки:

```powershell
$env:FETCHR_VPS_API_URL="https://your-vps.example.com/fetchr"
$env:FETCHR_TG_BETA_BOT="your_fetchr_beta_bot"
npm run tauri:build
```

## Telegram beta bot

Бот запускается отдельно на VPS:

```powershell
$env:TELEGRAM_BOT_TOKEN="123456:telegram-token"
$env:FETCHR_BETA_ALLOWED_USERS="11111111,22222222"
npm run license:tg-bot
```

Приложение открывает ссылку:

```text
https://t.me/<bot>?start=fetchr_<MACHINE_ID>
```

Бот генерирует ключ формата `SCB1.payload.signature`; ключ уже содержит `machine_id`, поэтому локальная проверка в приложении привязывает доступ к железу.

## Телеметрия

Минимальный API для VPS есть в проекте:

```powershell
$env:PORT="8787"
npm run vps:api
```

`POST /telemetry/events`

Событие запуска приложения:

```json
{
  "event_type": "app_launch",
  "app_version": "0.2.0",
  "channel": "beta",
  "machine_id": "AABBCCDDEEFF00112233445566778899",
  "sent_at": "2026-05-17T12:00:00Z",
  "payload": {}
}
```

Событие завершённой загрузки:

```json
{
  "event_type": "stream_downloaded",
  "app_version": "0.2.0",
  "channel": "beta",
  "machine_id": "AABBCCDDEEFF00112233445566778899",
  "sent_at": "2026-05-17T12:10:00Z",
  "payload": {
    "platform": "twitch",
    "streamer": "streamer_login",
    "mode": "vod",
    "download_kind": "video",
    "url_hash": "sha256-of-url",
    "title": "Stream title",
    "output_bytes": 123456789,
    "download_elapsed_ms": 42000
  }
}
```

На стороне VPS счётчики считаются по этим событиям:

- количество запусков приложения: count `event_type = app_launch`;
- количество скачанных стримов: count `event_type = stream_downloaded`;
- топ стримеров: group by `payload.streamer`, order by count desc.

## Онлайн-обновления

Для тестового VPS API положите инсталлятор в `vps-data/downloads` и создайте `vps-data/latest-update.json`:

```json
{
  "version": "0.2.1",
  "installer_url": "https://your-vps.example.com/downloads/Fetchr-Setup-0.2.1.exe",
  "installer_sha256": "lowercase_sha256_hex",
  "size_bytes": 73400320,
  "published_at": "2026-05-17T12:00:00Z",
  "notes": "Краткое описание изменений"
}
```

`GET /updates/latest?platform=windows&channel=beta&current_version=0.2.0`

Ответ, когда доступна новая версия:

```json
{
  "version": "0.2.1",
  "installer_url": "https://your-vps.example.com/downloads/Fetchr-Setup-0.2.1.exe",
  "installer_sha256": "lowercase_sha256_hex",
  "size_bytes": 73400320,
  "published_at": "2026-05-17T12:00:00Z",
  "notes": "Краткое описание изменений"
}
```

Если обновления нет:

```json
{
  "available": false,
  "version": "0.2.0"
}
```
