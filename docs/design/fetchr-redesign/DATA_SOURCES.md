# Fetchr Data Sources

Fetchr should not rely on manually prepared avatars, streamer thumbnails, or preview screenshots.

Runtime image sources:
- Twitch VOD thumbnail URL from Twitch API.
- Twitch channel/profile image from Twitch API.
- Kick channel profile picture / livestream thumbnail from Kick API or page metadata.
- YouTube thumbnail URL from URL metadata or existing downloader metadata.
- m3u8 tasks should use a generated platform placeholder unless metadata provides a thumbnail.
- Chat Render preview can use a screenshot URL entered by the user or generated from the video if the app already supports frame extraction.
- Sponsor Blur preview should use a frame extracted from the selected video or a user-provided reference image.

Fallback behavior:
- If image URL is missing, broken, or blocked, show a dark graphite placeholder with platform/source label.
- Never block task creation because a thumbnail/avatar is missing.

Icons:
- Prefer the existing project icon system.
- If unavailable, use a maintained open-source icon library matching the frontend framework.
- Icons should be UI components, not downloaded runtime images.