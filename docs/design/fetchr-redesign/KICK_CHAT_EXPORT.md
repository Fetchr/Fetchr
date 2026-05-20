# Kick Chat Export

Goal:
Implement Kick chat export from scratch so Fetchr can automatically download Kick chat JSON and render it as chat overlay.

Important:
- Kick chat export must be isolated from Twitch chat logic.
- Do not break existing chat render.
- Do not assume Kick VOD chat replay endpoint is stable.
- Use an adapter-based design.

Required outputs:
1. Raw Kick chat JSON:
   {baseFileName}.kick.raw-chat.json

2. Normalized chat JSON:
   {baseFileName}.kick.chat.json

3. Optional rendered output:
   MOV / WebM / PNG sequence depending on selected format.

Input sources:
- Kick channel URL.
- Kick video/VOD URL.
- Kick slug + optional video id.
- Existing downloaded Kick video task.

Required normalized message schema:
- id
- platform: "kick"
- offsetMs
- createdAt
- authorId
- authorName
- authorColor
- authorBadges
- text
- fragments
- emotes
- replyTo
- raw

Flow:
1. Parse Kick URL and resolve slug/video id.
2. Fetch channel/livestream/video metadata using official API when possible.
3. Discover chat replay JSON source using existing project logic or a dedicated Kick adapter.
4. Download all chat pages/messages with retries and rate limiting.
5. Save raw JSON.
6. Normalize messages to Fetchr internal chat format.
7. Save normalized JSON.
8. Render normalized chat using existing chat renderer.
9. If chat replay is unavailable, show a clear error and still allow video download.

Restrictions:
- Do not use paid third-party APIs unless user explicitly configures them.
- Do not use browser automation unless absolutely necessary and isolated.
- Do not bypass authentication.
- Do not store tokens in plaintext.
- If an endpoint changes, fail gracefully with actionable error.