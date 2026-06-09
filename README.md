# news-hypervideo

TypeScript CLI tool to produce professional-grade news videos from a simple `news.json` file.

Uses:
- **Hyperframes** (HeyGen OSS) — HTML → deterministic MP4 renders with Puppeteer + FFmpeg
- **GSAP** — buttery text & photo animations (Ken Burns, reveals, sync)
- **Local TTS (Kokoro via Hyperframes)** — high-quality offline voiceover + word timestamps for perfect visual sync

**MVP Status**: Scaffolding complete. Core flow stubbed with clear production implementation paths. Ready for iteration.

## Quick Start (after setup)

```bash
npm install
npm run build

# Generate from sample
npm run generate examples/sample-news.json -- --output ./output/test.mp4 --voice af_bella --project-dir ./test-project
```

Then follow the instructions printed (or in the generated project README).

## How it Works (MVP Flow)

1. `news.json` → validated
2. Generate spoken script
3. TTS (Kokoro local) + (future) transcribe for timings
4. Generate Hyperframes `index.html` + assets with GSAP animations tailored to news (title, photo sequence with Ken Burns, body text)
5. Render via Hyperframes (stub for now — full version executes the command)

The output project folder is a **full Hyperframes project** — you can:
- `npx hyperframes preview` (live browser editing)
- Manually tweak HTML/GSAP
- `npx hyperframes render`
- Add catalog blocks (`npx hyperframes add cinematic-zoom`)

## Current Limitations (MVP)

- TTS and render are documented stubs (print commands + create placeholders). Full exec coming next.
- No real transcript-driven word sync yet (estimated timings).
- Photos: remote URLs noted; local copy works.
- Single template style.

## Next Immediate Steps (recommended)

1. Install deps: `npm install`
2. Test the generate command (it will guide you).
3. Manually test Hyperframes on the generated project to validate renders.
4. Enhance `composition-generator.ts` with real transcript loading + better GSAP.
5. Wire real `execa` calls for tts + render.
6. Add support for installing catalog transitions automatically.

## Project Structure

```
src/
  index.ts              # CLI entry (commander)
  types/news.ts         # Zod schema
  script-generator.ts   # news.json → narration script
  tts.ts                # Hyperframes tts wrapper
  composition-generator.ts  # HTML + GSAP template engine
  renderer.ts           # Hyperframes render wrapper
examples/
  sample-news.json
brainstorm/
  news-video-production-idea.md   # Full detailed brainstorm
```

See `brainstorm/news-video-production-idea.md` for complete architecture, GSAP examples, production tips, schema rationale, and roadmap.

## Production Vision

One-command daily news videos that look like they were crafted by a video production team:
- Cinematic shader transitions
- Voice-synced text highlights & photo reveals
- Clean newspaper-style typography + motion
- Fully local, deterministic, batchable

Perfect hook for your newspaper's digital audience.

---

Built as an initial scaffold during brainstorming. Let's iterate!

Run `npm run generate -- --help` for options.
