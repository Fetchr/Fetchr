# Stream Cutter

Нативный Windows-клиент для нарезки и загрузки видеостримов (Twitch, YouTube, Kick, VK, HLS) поверх `yt-dlp` + `N_m3u8DL-RE` + `ffmpeg`. Архитектура — Tauri v2 (Rust) + React 18 + TypeScript + Tailwind 3. Дизайн — плотный, клавиатурный, в стиле Linear / Raycast.

## Стек

- **Фронтенд:** React 18, Vite 5, TypeScript 5 (strict), Tailwind 3, Radix UI, cmdk, TanStack Router/Virtual, Zustand, i18next, hls.js, lucide-react
- **Бэкенд:** Rust (stable ≥ 1.77), Tauri 2, tokio, anyhow, serde, regex, parking_lot
- **Тулинг:** pnpm, ESLint, Prettier, cargo

## Требования

- Windows 10/11
- Node.js 18+, pnpm 9+
- Rust toolchain (stable, `rustup install stable`)
- Visual Studio Build Tools (MSVC)
- WebView2 Runtime (предустановлен в Windows 11)

## Быстрый старт

```powershell
pnpm install
pnpm tauri dev
```

Первая сборка Rust кешируется и занимает 2–5 минут; повторные — секунды.

## Запуск двойным кликом (без cmd)

В корне репозитория лежат три launcher-а:

| Файл               | Что делает                                                              |
| ------------------ | ----------------------------------------------------------------------- |
| `Build.bat`        | Собирает релизный `.exe` (нужно запустить один раз, перед продакшном).  |
| `Stream Cutter.vbs`| Тихий запуск без окна cmd — если exe собран, стартует его; иначе dev.   |
| `Start.bat`        | Стандартный dev-режим (видно консоль — полезно при отладке).            |

Рекомендуемый сценарий:

1. Один раз запусти `Build.bat` — соберётся `src-tauri\target\release\stream-cutter.exe`.
2. Дальше кликай `Stream Cutter.vbs` (или закинь его в Автозагрузку / создай ярлык на рабочий стол).

## Производственная сборка

```powershell
pnpm tauri build
```

Артефакты: `src-tauri/target/release/stream-cutter.exe` и инсталляторы в `src-tauri/target/release/bundle/`.

## Положение бинарей

Приложение ищет `yt-dlp.exe`, `N_m3u8DL-RE.exe`, `ffmpeg.exe`, `ffprobe.exe` в следующем порядке:

1. Каталог, указанный в **Настройках → Инструменты** (`binariesDir`).
2. Рядом с `stream-cutter.exe` (sidecar, при production сборке).
3. Родительский каталог проекта (при `pnpm tauri dev` работает относительно `src-tauri/..`).
4. `PATH`.

Положи все четыре `.exe` в одну папку — проще всего.

## Горячие клавиши

| Клавиша           | Действие                                                   |
| ----------------- | ---------------------------------------------------------- |
| `Ctrl+K`          | Палитра команд                                             |
| `Ctrl+N`          | Добавить стрим                                             |
| `Ctrl+Enter`      | Запустить очередь                                          |
| `Ctrl+,`          | Настройки                                                  |
| `G` → `Q/L/F/B/S` | Очередь/Логи/**Finder**/Библиотека/Настройки              |
| `Esc`             | Закрыть палитру/диалог                                     |

## Структура

```
stream-cutter/
├── src/                      # React фронтенд
│   ├── app/                  # Роутер
│   ├── components/           # Переиспользуемые UI-блоки
│   │   └── ui/               # shadcn-style примитивы
│   ├── features/             # Экранные функциональные модули
│   ├── i18n/                 # RU/EN
│   ├── lib/                  # Хелперы и IPC-обёртки
│   ├── stores/               # Zustand-сторы
│   ├── styles/               # Tailwind + токены
│   └── types/                # TS-типы доменных сущностей
├── src-tauri/
│   ├── src/
│   │   ├── binaries.rs       # Резолвер sidecar-бинарей
│   │   ├── commands/         # Tauri commands
│   │   ├── jobs/             # Очередь, runner
│   │   ├── proxy.rs          # Нормализация прокси
│   │   └── lib.rs            # Инициализация приложения
│   ├── capabilities/         # Tauri ACL
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
```

## Дизайн-токены

Все цвета, бордеры, тени и анимации заданы через CSS custom properties в `src/styles/globals.css` и замаплены в `tailwind.config.ts`. Базовые правила:

- Плотность: 13 px базовый, 11 px мелкий, линии 1 px.
- Только dark-тема.
- Моно-шрифт JetBrains Mono для логов, URL, тайм-кодов, цифр.
- Акцент: `#7C6CF6` (violet 70).
- Фокус-ring — 2 px `hsl(var(--accent))` с оффсетом 1 px.

## Что уже есть

- ✅ Очередь задач с состояниями queued/running/paused/done/error/cancelled.
- ✅ Диалог "Добавить стрим" с авто-резолвом, **HLS-плеером предпросмотра** и кнопками «Старт/Конец отсюда».
- ✅ Превью + thumbnail + платформа + автор + длительность прямо в строке очереди.
- ✅ **M3U8 Finder** (`Ctrl+K → Открыть M3U8 Finder` или `G F`) — brute-force Twitch CDN по username/stream_id/времени старта, в т.ч. с авто-скрейпом twitchtracker/streamscharts/sullygnome.
- ✅ Потоковые логи по каждой задаче (виртуализированные).
- ✅ Палитра команд (Ctrl+K) и hotkeys.
- ✅ Страница настроек с авто-определением бинарей.
- ✅ Прокси (HTTP/SOCKS) с нормализацией под yt-dlp и `N_m3u8DL-RE`.
- ✅ Интернационализация RU/EN.
- ✅ Прямые `.m3u8` / cloudfront ссылки автоматически идут через `N_m3u8DL-RE` (yt-dlp их плохо переваривает).

## Что запланировано

- Библиотека завершённых загрузок с метаданными.
- Планировщик на Task Scheduler/Cron для авто-запуска.
- Автообновление списка форматов при смене URL.

## Лицензия

MIT.
