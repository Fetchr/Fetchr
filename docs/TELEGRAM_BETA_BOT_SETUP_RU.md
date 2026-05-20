# Настройка Telegram-бота закрытой беты

## 1. Создать бота

1. Откройте `@BotFather` в Telegram.
2. Отправьте `/newbot`.
3. Задайте имя, например `Fetchr Beta`.
4. Задайте username, например `fetchr_beta_bot`.
5. Сохраните токен вида `123456789:AA...`.

Этот username нужно использовать при сборке приложения:

```powershell
$env:FETCHR_TG_BETA_BOT="fetchr_beta_bot"
```

## 2. Настроить канал

1. Создайте Telegram-канал или используйте существующий.
2. Добавьте бота в канал администратором.
3. Для публичного канала укажите username канала, например `@fetchr_channel`.
4. Для приватного канала используйте ID канала вида `-1001234567890` и отдельно ссылку-приглашение.

Бот проверяет подписку через `getChatMember`. Без прав администратора в канале проверка обычно не работает.

## 3. Запустить бота на VPS

Минимальный запуск:

```powershell
$env:TELEGRAM_BOT_TOKEN="123456789:telegram-token"
$env:FETCHR_BETA_REQUIRED_CHANNEL="@fetchr_channel"
npm run license:tg-bot
```

Для приватного канала:

```powershell
$env:TELEGRAM_BOT_TOKEN="123456789:telegram-token"
$env:FETCHR_BETA_REQUIRED_CHANNEL="-1001234567890"
$env:FETCHR_BETA_REQUIRED_CHANNEL_URL="https://t.me/+invite_link"
npm run license:tg-bot
```

Опционально можно ограничить выдачу ключей списком Telegram user id:

```powershell
$env:FETCHR_BETA_ALLOWED_USERS="11111111,22222222"
```

Лог выданных ключей:

```powershell
$env:FETCHR_BETA_BOT_LOG="C:\fetchr\beta-bot-licenses.jsonl"
```

## 4. Как работает выдача ключа

1. Пользователь открывает приложение.
2. Приложение генерирует `Machine ID`.
3. Пользователь нажимает кнопку Telegram.
4. Бот получает `Machine ID`.
5. Бот проверяет подписку на канал.
6. Если подписка есть, бот генерирует ключ `SCB1.payload.signature`.
7. Пользователь вставляет ключ в приложение.
8. Приложение локально проверяет подпись и привязку ключа к железу.

## 5. Что указать при сборке приложения

```powershell
$env:FETCHR_TG_BETA_BOT="fetchr_beta_bot"
$env:FETCHR_VPS_API_URL="https://your-vps.example.com/fetchr"
npm run tauri:build
```

`FETCHR_TG_BETA_BOT` нужен, чтобы кнопка в приложении открывала правильного бота.
