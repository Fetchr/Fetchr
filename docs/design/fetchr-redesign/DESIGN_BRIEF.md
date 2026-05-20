# Fetchr Redesign Brief

Fetchr is a stream/VOD download and processing manager, not a video editor.

The UI should feel like a premium dark graphite professional desktop app inspired by Adobe Premiere Pro / Photoshop / After Effects 26.x visual polish.

Use Adobe-like ideas only for:
- dark graphite panels;
- compact desktop controls;
- professional spacing;
- right-side properties panels;
- top toolbar discipline;
- precise typography;
- blue accent color.

Do not add:
- editing timelines;
- video layers;
- compositions;
- tracks;
- keyframes;
- montage workflow.

Core product model:
- Add stream/VOD/source.
- Analyze links and streams.
- Queue download tasks.
- Download streams/VODs.
- Apply preset processing steps.
- Optional clipping/timecodes.
- Optional sponsor blur zones.
- Optional chat export.
- Save files to configured folders.

Implementation rules:
- Every UI block must be implemented in its own component file.
- Do not rewrite backend/download logic unless explicitly required.
- Reuse existing commands, events, stores, and types where possible.
- New UI components should receive props and callbacks instead of owning business logic.
- Styling should be modular.
- Keep Russian UI strings.
- Preserve all current features.

Asset rules:
- Reference screenshots are stored in docs/design/fetchr-redesign/references/.
- Reference screenshots are design references only.
- Do not import reference screenshots into runtime UI.
- Runtime thumbnails, avatars and previews should come from platform data, URLs, or user-provided links.
- If no image URL is available, show a generated placeholder.
- Icons should use the existing project icon system if present.
- If no icon system exists, install and use an appropriate open-source icon library.