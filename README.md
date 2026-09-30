# AudioVerse Studio — Vercel Edge Neural TTS

This version keeps the AudioVerse frontend unchanged and runs the lightweight Microsoft Edge Neural TTS bridge as Vercel Node.js Functions.

## Deploy

Deploy the folder containing `index.html`, `package.json`, `vercel.json`, `api/`, `js/`, `css/`, `data/`, and `assets/`.

Do not add an Azure key. The backend uses the Microsoft Edge Read Aloud service through `msedge-tts`.

## Test after deployment

- `/api/health`
- `/api/voices`
- Generate narration from AudioVerse.

The frontend contains the bundled voice catalog and will never blank the selectors if the live catalog endpoint is temporarily unavailable.


## V17 compatibility implementation
This build preserves the desktop workflow in the browser: IndexedDB local media library, non-destructive timeline items, audio attachment after Edge Neural TTS generation, seconds-based audio timing, repeat-selection Fit to Audio, queue review, Edge word-boundary SRT generation, volume controls, project persistence, and local FFmpeg/WASM MP4 export. Browser video preview uses the native media decoder/Blob URL because desktop ffplay/FFmpeg frame preview is not available inside a browser sandbox.
