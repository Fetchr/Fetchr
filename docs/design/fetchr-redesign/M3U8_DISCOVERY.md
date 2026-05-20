# M3U8 Discovery Rules

Fetchr should support two Twitch discovery modes:

## 1. Public Twitch VOD mode

Input:
- Twitch username / channel login.

Flow:
1. Resolve Twitch username to user/broadcaster ID.
2. Fetch public VODs for the broadcaster.
3. Display saved streams/VODs in the UI.
4. For each public VOD, use the correct Twitch video URL as the main copy/add-to-queue URL.
5. Mark chat availability as true only when the task source is a valid Twitch VOD URL and the existing app supports Twitch chat extraction/rendering.
6. Use Twitch thumbnail/profile URLs for preview images.

Expected result:
- User can search by streamer nickname.
- User sees all publicly available saved streams returned by Twitch.
- Copy button copies the correct Twitch direct VOD URL.
- Add to queue uses Twitch VOD URL, not m3u8, when the VOD is public.

## 2. Tracker / recovered m3u8 mode

Input:
- TwitchTracker / StreamCharts / SullyGnome link.
- Streamer nickname + stream id / start time.
- Manual tracker metadata.

Flow:
1. Use tracker pages only as metadata sources.
2. Try to recover/find publicly accessible HLS/m3u8 video playlists using existing m3u8 finder logic.
3. If the playlist is accessible, display it as video-only source.
4. Add to queue as m3u8/HLS video-only task.
5. Disable chat export for recovered m3u8 sources.
6. Show clear UI warning: “Чат недоступен для recovered m3u8. Используйте прямую Twitch VOD ссылку, если нужен чат.”

Restrictions:
- Do not bypass authentication.
- Do not download private/paid/auth-protected content.
- Do not forge tokens.
- If a stream is not publicly accessible, mark it as unavailable.
- Do not pretend that m3u8 contains chat.