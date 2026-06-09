# Brainstorm: Professional News Video Production from news.json using Web Tech

**Goal**: Newspaper creates high-quality, hooky video news from minimal inputs (text + few photos) using animations, local TTS voiceover. 
- Input: `news.json` (structured content)
- Output: Professional MP4 video (e.g. 1080p, 30fps)
- Tech: Web-native (HTML/CSS/JS + GSAP animations), rendered deterministically
- MVP: TypeScript CLI tool (no full UI yet)
- Stack inspiration: Hyperframes (HeyGen OSS) + GSAP + Hyperframes' built-in local TTS (Kokoro)

**Date**: 2026-06-09 (Asia/Dhaka timezone)

## Why This Stack is Perfect for Production-Grade Videos

Hyperframes (https://github.com/heygen-com/hyperframes) is *exactly* built for this:
- **"Write HTML. Render video."** — Define entire video as self-contained HTML + CSS + JS (with data attributes for timing/tracks).
- **Deterministic renders**: Headless Chrome (frame-by-frame seek) + FFmpeg → same JSON always = identical MP4. Great for news pipeline reliability.
- **Native audio support**: `<audio>` tags with `data-start`, `data-duration`, `data-track-index`, `data-volume`. Perfect for voiceover + optional bg music.
- **GSAP first-class**: Use GSAP timelines (paused, registered on `window.__timelines`) for all pro animations. Framework handles seeking.
- **Built-in local TTS pipeline**:
  - `npx hyperframes tts SCRIPT.md --voice <kokoro-voice> --output assets/narration.wav` (Kokoro: offline, high-quality ~MOS 4.5, 82M params, CPU-friendly, 54 voices, 9 languages, no API key).
  - `npx hyperframes transcribe narration.wav` → `transcript.json` (word-level timestamps for perfect sync).
- **Catalog of pro blocks**: Install reusable cinematic shader transitions (`npx hyperframes add cinematic-zoom`, `flash-through-white`, `light-leak`, etc.), captions, overlays.
- **Preview instantly**: `npx hyperframes preview` (live browser with hot reload).
- **CLI + agent-friendly**: Non-interactive by default. Perfect for your TS CLI wrapper. Also has skills for AI coding agents (Claude etc.) if you want to extend generation.
- **Self-contained projects**: index.html + compositions/ + assets/ (photos, audio, fonts).
- **Variables**: `data-composition-variables` + `data-variable-values` for data-driven from your news.json.
- **No React/bundler needed** (unlike Remotion alternative): Plain HTML, easier for agents/CLI templating.

**GSAP** (linked llms.txt): Industry gold standard for buttery-smooth text reveals, photo zooms/pans (Ken Burns), staggers, counters, etc. Use in the HTML scripts.

**Local TTS (Kokoro via Hyperframes)**: Truly local/offline, high quality for news narration. Better than tiny-tts (which is lighter but lower quality per early reviews). Supports word boundaries for sync.

**Web tech advantages**:
- Easy debugging/preview in browser.
- Familiar stack for web devs.
- Animations on text/photos look professional and "hooky" (subtle motion, reveals, sync).
- Scalable: Template different news styles (breaking, feature, data-heavy).

**Production grade potential**:
- Cinematic transitions (shaders look film-like).
- Synced visuals to voice (word highlights, timed photo changes).
- Clean typography, consistent branding.
- Subtitles (SRT from transcript).
- Deterministic + batchable.
- Extendable to full studio later.

**Alternatives considered**:
- Remotion: Excellent (React + TS, great for JSON datasets), but requires bundler and more setup. Hyperframes wins for plain HTML + built-in TTS/transcribe + catalog.
- Pure FFmpeg/Canvas: Too low-level for complex animations.
- HeyGen cloud API: Not local, costs, less control.

## Proposed MVP: TypeScript CLI Tool

**Name idea**: `news-hypervideo` or `@yourpaper/video-cli` or `hypernews-producer`.

**Install/Usage**:
```bash
npm install -g news-hypervideo
news-hypervideo generate ./news.json --output ./videos/breaking.mp4 --voice "af_bella" --resolution 1080p --fps 30
# Or with project output for iteration:
news-hypervideo generate ./news.json --project-dir ./video-project --render
```

**Core Flow (automates Hyperframes pipeline tailored to news)**:
1. **Parse news.json** (Zod validation).
2. **Generate narration script** (SCRIPT.md): Combine title/lead/body into natural spoken prose (add hooks, smooth flow). Optional: user-provided `voice_script`.
3. **TTS + Timing**:
   - Run Hyperframes `tts` → `assets/narration.wav` + `narration.txt`.
   - Run `transcribe` → `transcript.json` (word {text, start, end, ...}).
4. **Scaffold / Generate Hyperframes Project** (in temp dir or user-specified `--project-dir`):
   - Copy photos to `assets/`.
   - Generate `index.html` (root composition) + optional `compositions/*.html` (modular scenes: intro, photos, body, outro).
   - Inject content from JSON + timings from transcript.
   - Add GSAP script, data- attrs for all timed elements.
5. **Build Animations** (in generated HTML):
   - Use GSAP for everything visual.
   - Distribute photo timings across narration duration.
   - Sync text reveals/highlights to word timestamps.
6. **Optional**: Add catalog transitions (`npx hyperframes add cinematic-zoom` etc. inside the generated project).
7. **Lint/Validate** (run Hyperframes lint).
8. **Render**: `npx hyperframes render --output video.mp4` (or use @hyperframes/producer API directly for tighter integration).
9. **Post-process**:
   - Generate `subtitles.srt` from transcript.
   - Optional thumbnail (first frame or specific).
   - Metadata JSON.
10. **Cleanup** (if temp) or leave project for manual tweaks + re-render.

**Benefits of wrapper CLI**:
- One-command from news.json.
- Enforces news-specific structure (sections, photo sequencing).
- Handles asset copying, templating.
- Batch mode later: `generate --batch ./news/*.json`.
- Config file for defaults (voice, style, aspect ratio).
- Can integrate @hyperframes/* packages directly to avoid some subprocesses (TTS might still benefit from CLI for now).

**Tech for CLI (TS)**:
- Node 22+ (matches Hyperframes req).
- commander (CLI parsing).
- zod (schema + validation).
- fs-extra, glob, handlebars or lit-html-like templating for HTML gen.
- child_process or execa (to call `npx hyperframes ...` — or better, import packages).
- Optional: @hyperframes/core, @hyperframes/producer for programmatic control.
- Prettier for generated code? 
- Dev deps for testing.

**Requirements for users**:
- Node 22+
- FFmpeg (brew install / apt / choco)
- (Hyperframes will be a peer or auto-installed via npx)

## news.json Schema (MVP)

Use Zod for runtime + TS types.

```ts
// src/types/news.ts
import { z } from 'zod';

export const NewsSchema = z.object({
  id: z.string(),
  title: z.string().min(5),
  lead: z.string().optional(), // short hook
  body: z.array(z.string()).min(1), // paragraphs or sections
  photos: z.array(z.object({
    src: z.string(), // local path or URL (tool will download)
    caption: z.string().optional(),
    alt: z.string(),
    credit: z.string().optional(),
  })).min(1).max(10), // few photos as specified
  voice_script: z.string().optional(), // override auto-generated narration
  style: z.enum(['breaking', 'feature', 'data', 'standard']).default('standard'),
  duration_hint_seconds: z.number().positive().optional(),
  metadata: z.object({
    author: z.string().optional(),
    date: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
});

export type News = z.infer<typeof NewsSchema>;
```

**Example news.json** (for a sample):
```json
{
  "id": "news-2026-06-09-climate",
  "title": "Global Temperatures Hit Record Highs in May 2026",
  "lead": "Scientists warn of accelerating climate impacts as new data emerges.",
  "body": [
    "The latest report from the World Meteorological Organization shows average global temperatures soared past previous records.",
    "Extreme weather events have increased by 40% in vulnerable regions.",
    "Experts call for urgent policy action ahead of the upcoming summit."
  ],
  "photos": [
    {
      "src": "assets/temp-map.jpg",
      "alt": "Global temperature anomaly map",
      "caption": "Temperature deviations from 1951-1980 average",
      "credit": "NASA / NOAA"
    },
    {
      "src": "assets/flood.jpg",
      "alt": "Flooding in coastal city",
      "caption": "Recent flooding linked to rising seas"
    }
  ],
  "style": "breaking",
  "metadata": {
    "author": "Climate Desk",
    "date": "2026-06-09"
  }
}
```

## Example Generated Composition (index.html skeleton)

Hyperframes structure (from docs):

```html
<!-- index.html (root composition) -->
<div id="root" data-composition-id="news-video"
     data-start="0" data-width="1920" data-height="1080"
     data-composition-variables='[...]'>  <!-- if using vars -->

  <!-- Audio track for voiceover (critical!) -->
  <audio id="narration"
         class="clip"
         data-start="0"
         data-duration="42.5"  <!-- from actual audio -->
         data-track-index="0"
         data-volume="1.0"
         src="assets/narration.wav"></audio>

  <!-- Optional bg music track -->
  <!-- <audio ... data-track-index="1" src="assets/subtle-bg.mp3" data-volume="0.15"></audio> -->

  <!-- Intro Title Clip -->
  <div id="title-container" class="clip"
       data-start="0" data-duration="6" data-track-index="2"
       style="... positioning ...">
    <h1 id="main-title" class="news-title">Global Temperatures Hit Record Highs in May 2026</h1>
  </div>

  <!-- Photo 1 with Ken Burns animation -->
  <img id="photo-1" class="clip media"
       data-start="4" data-duration="12" data-track-index="3"
       src="assets/temp-map.jpg"
       style="object-fit: cover; ..." />

  <!-- Photo caption / credit overlay (timed) -->
  <div id="photo-1-caption" class="clip caption"
       data-start="8" data-duration="8" data-track-index="4">...</div>

  <!-- Body text sections (synced or staggered) -->
  <div id="body-text" class="clip"
       data-start="10" data-duration="25" data-track-index="5">
    <!-- Paragraphs or word spans for highlighting -->
  </div>

  <!-- Transitions: Install and reference catalog blocks as nested compositions -->
  <!-- e.g. <div data-composition-src="compositions/cinematic-zoom.html" data-start="..." ...></div> -->

  <!-- GSAP + custom logic script -->
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/SplitText.min.js"></script> <!-- if using club plugin, or custom split -->
  <script>
    // IMPORTANT: Paused timeline + register
    const tl = gsap.timeline({ paused: true });

    // Title animation example
    tl.from("#main-title", { opacity: 0, y: 50, scale: 0.9, duration: 1.2, ease: "power3.out" }, 0.5);

    // Photo Ken Burns (slow zoom + subtle pan)
    tl.to("#photo-1", { scale: 1.08, x: -20, duration: 12, ease: "none" }, 4);  // matches data-duration

    // Synced text: Use transcript.json to set absolute times
    // Example: highlight words as spoken
    // Assume we pre-split or use spans with data-word-time
    tl.to(".word-highlight", { backgroundColor: "#ffeb3b", duration: 0.1 }, wordStartTime);

    // Staggered body paragraphs
    tl.from(".body-para", { opacity: 0, y: 30, stagger: 0.4, duration: 0.8 }, 10);

    // Register for Hyperframes renderer
    window.__timelines = window.__timelines || {};
    window.__timelines["news-video"] = tl;

    // Optional: Variables
    // const vars = window.__hyperframes?.getVariables?.() || {};
  </script>
</div>
```

**More GSAP Ideas for Hooky Professional Look** (from Hyperframes guides + GSAP):
- **Kinetic titles**: Per-character or word stagger (SplitText or manual spans).
- **Photo montages**: Crossfades + individual Ken Burns (scale + position tweens). Stagger entry.
- **Text sync**: Word-by-word color/background highlight using transcript timestamps. Or typewriter effect on key phrases.
- **Counters** (if numbers in news): Animate numbers from 0.
- **Lower thirds / overlays**: Slide in with news-style graphics.
- **Eases**: Mix power3.out (energetic), expo.out (snappy), sine.inOut (smooth), none (for continuous zooms).
- **Subtle motion**: Always have *some* movement (breathing scale on logos, slow drift on text).
- **Scene structure**: 3-5 beats max for short news. Hard cuts or 1-2 shader transitions.
- **Catalog transitions**: Add `cinematic-zoom` (dramatic reveal), `light-leak` (warm filmic), `flash-through-white` for energy.

**Timing Strategy**:
- Total duration ≈ audio duration (extend with `tl.set({}, {}, totalAudio)` if needed).
- Distribute photos: e.g. photo 1 covers first 30% of narration, etc.
- Use transcript to drive *everything* visual after audio is generated (source of truth).

## Production-Grade Polish Ideas

- **Typography**: Professional news fonts (e.g. self-host Inter or Playfair Display for headlines; copy WOFF2 to assets/). High contrast.
- **Branding**: Consistent colors (navy #0A2540, accent #E63946, white), logo watermark (subtle, animated in/out).
- **Visual effects**: Subtle CSS filters (contrast, slight grain via overlay), vignette.
- **Pacing**: Match speech rate. Short sentences in script. 4-8s per "beat".
- **Captions**: Burned-in (use catalog caption blocks or custom GSAP) + optional SRT export. Word highlighting is pro.
- **Music/SFX**: Optional low-volume ambient/news-bed track mixed via separate audio track. User provides asset.
- **Multiple resolutions**: Support 1080p, 4K, vertical 9:16 for social/YouTube Shorts/Reels.
- **Accessibility**: Alt texts, good contrast, captions.
- **Quality controls**: Hyperframes quality flags (draft/standard/high). Test renders.
- **Iteration**: Output full project dir so editors can tweak HTML/GSAP in preview and re-render.
- **Error resilience**: Validate assets, graceful fallbacks (e.g. skip missing photo).
- **Batch & Pipeline**: Integrate into your existing news CMS (watch folder for new .json → auto video).

**Shader Transitions to Prioritize** (install via `npx hyperframes add <name>`):
- `cinematic-zoom`: Dramatic reveals.
- `flash-through-white` or `light-leak`: Cinematic news feel.
- `cross-warp-morph`: Smooth continuity.
- Limit to 2-3 per video.

## MVP Scope & Phased Roadmap

**Phase 1 (Core MVP - 1-2 weeks)**:
- CLI scaffold + parse news.json.
- Auto-generate script + run tts + transcribe (subprocess).
- Basic template: 1 composition with title + 2-3 photos (Ken Burns) + body text.
- Simple GSAP: title in, photo zooms, text fades.
- Copy assets, basic render.
- Output MP4 + project dir.

**Phase 2 (Polish & Sync)**:
- Full transcript-driven animations (word highlights, timed sections).
- Modular compositions (one per major beat).
- Add 1-2 catalog transitions.
- SRT subtitles export.
- Config file + CLI flags (voice, style, aspect).
- Better script generation (split body into timed beats).
- Validation + lint step.

**Phase 3 (Production Ready)**:
- Multiple style templates (breaking vs in-depth).
- Background music support + mixing.
- Image preprocessing (auto-crop, filters?).
- Batch processing.
- Thumbnail generation.
- Direct @hyperframes API integration (less npx).
- Logging, progress, error reports.
- Tests (sample news → expected video? snapshot renders hard but possible).
- Docs + example news.json.

**Phase 4 (Future)**:
- Full UI (using Hyperframes Studio?).
- AI enhancements (LLM for better script, or image gen for missing visuals).
- Voice cloning option (if Kokoro supports or switch engines).
- Integration with your newspaper CMS/API.
- Cloud render fallback (Hyperframes AWS Lambda).

## Potential Challenges & Solutions

1. **Audio-Visual Sync**:
   - **Solution**: Always generate TTS first → transcript is truth. Use absolute times in GSAP (tl.to(..., time: word.start)).
   - Preview in browser uses real audio playback + JS listeners if needed (but render is deterministic seek).
   - Test with varied sentence lengths.

2. **Image Quality/Placement**:
   - Download remote photos.
   - Use `object-fit: cover` + GSAP on wrapper div for Ken Burns (avoid animating <img> dimensions directly — common Hyperframes gotcha).
   - Pre-process? (optional later).

3. **Font Loading Determinism**:
   - Self-host fonts in assets/. Or use system stacks for simplicity. CDN for GSAP is ok (examples use it).

4. **Render Time**:
   - Short news videos (30-90s) are fast enough. 1080p/30fps.
   - Optimize: Fewer complex elements per frame.

5. **Script Quality**:
   - Start simple (concat + punctuation fixes). Later: LLM-assisted (but keep local-first for MVP).
   - Kokoro handles prosody well for news.

6. **Hyperframes Versioning**:
   - Pin a version. Test compatibility.

7. **Asset Management**:
   - Support both local paths and URLs in json (tool downloads to temp/assets).

8. **Customization**:
   - Allow overriding template via `--template` or custom HTML snippets in json.

## Next Steps & Recommendations

1. **Validate Stack**: Install Hyperframes locally (`npx hyperframes init test-news`), add a photo + audio manually, add GSAP, preview/render. Confirm Kokoro TTS quality on sample news text.
2. **Prototype Manually**: Build one killer sample composition for a real news item (use the catalog + GSAP examples).
3. **Define Schema Early**: Lock news.json format with your team.
4. **Start Coding the CLI**: I can scaffold the TS project here (package.json, basic CLI, schema, templating engine, sample generation).
5. **Agent Leverage**: Since you linked llms.txt files, use Claude/Cursor + Hyperframes skills (`npx skills add heygen-com/hyperframes`) to help generate the compositions or even parts of the CLI.
6. **Testing**: Create 3-5 diverse sample news.json (short breaking, longer feature with numbers).
7. **Metrics for "Professional"**: Hook in first 3s, smooth motion, clear audio, readable text, cinematic but not gimmicky.

## Time Estimates for Producing 10-15 Minute Videos

**Important context**: Your current examples and Hyperframes showcase are mostly short-form (30-90 seconds). 10-15 minutes (600-900 seconds of content) is 6-15x longer — this changes the economics significantly because of how Hyperframes renders (per-frame headless Chrome capture + FFmpeg).

### Breakdown of Time (End-to-End CLI Run)

| Step                        | 10-min video          | 15-min video          | Notes / Bottleneck |
|-----------------------------|-----------------------|-----------------------|--------------------|
| Script generation           | < 1s                 | < 1s                 | Negligible |
| TTS (Kokoro local)          | 30s – 3 min (CPU)<br>5-30s (GPU) | 45s – 4.5 min (CPU)<br>8-45s (GPU) | Extremely fast (3-200x realtime). Negligible. |
| Transcribe (word timestamps)| 1-4 min              | 1.5-6 min            | Whisper-style; scales with length. |
| HTML/GSAP composition gen   | 2-10s                | 3-15s                | Template + asset copy. |
| **Render (main cost)**      | **40-90 min** (optimistic)<br>**2-6+ hours** (realistic with effects) | **60-135 min** (optimistic)<br>**3-9+ hours** (realistic) | Headless Chrome frame-by-frame. See details below. |
| Post (SRT, thumbnail, etc.) | 10-30s               | 15-45s               | Negligible |
| **Total (good case)**       | **45-100 minutes**   | **65-150 minutes**   | One full production run |
| **Total (cinematic case)**  | **2.5-7 hours**      | **4-10+ hours**      | Heavy shaders/animations |

### Render Time Details (The Real Constraint)

Hyperframes render performance (from public benchmarks + GitHub issues, 2026 data):

- **Real example**: 42-second 1080p 30fps video rendered in **~3.5 minutes** on M2 Mac (6 workers). ≈ **5x real-time**.
- **Shader transitions kill performance**: One benchmark (854x480, 28s video, 6 workers):
  - Hard cuts only: **14 seconds**
  - 14 short shader transitions: **2 minutes 15 seconds** (≈10x slower)
  - Shaders appear to bypass worker parallelism and use a slower sequential composite path.
- General pattern (Hyperframes + similar tools like Remotion):
  - Optimistic (hard cuts + simple GSAP, 6-8 workers, draft/standard quality, 1080p): **3-6x real-time**.
  - Typical news video with some cinematic elements: **6-15x real-time**.
  - Heavy shaders + complex animations: **20-50x+ real-time** (or worse).

**For 10-15 min video at 30fps 1080p**:
- Frames: 18,000 – 27,000.
- Optimistic hardware (high-core CPU or M-series + workers + minimal shaders): **40-90 min** for 10 min content.
- With 2-4 shader transitions + rich GSAP (photo zooms, word highlights, multiple overlays): easily **2-6 hours**.
- 4K or 60fps: 1.5-4x slower.
- Low-end laptop (few workers): double or triple the times.

**Hardware impact** (rough):
- Modern high-core desktop / M3/M4 Mac / cloud instance with 8+ workers: best case above.
- Consumer laptop (4-8 cores): 1.5-3x slower.
- GPU encoding enabled (`useGpu: true` in producer): helps final encode but not the Chrome capture bottleneck.
- Remotion (very similar architecture) shows similar scaling limits — concurrency helps but has diminishing returns due to Chrome overhead.

**TTS is never the issue**: Kokoro is blazing fast even for long-form (10 min audio in under a minute on decent hardware).

### Other Time Factors

- **Development / Tool maturity for long videos**:
  - Once your CLI is built (MVP 1-2 weeks as planned), supporting 10-15 min is mostly automatic (the schema and templating already handle arbitrary durations).
  - Extra work needed: Better scene splitting (modular compositions), memory management for very long timelines, possibly segmenting the render and stitching with FFmpeg to avoid single long captures.
  - Testing long videos: Add 1-2 days.

- **Iteration time** (big advantage):
  - Browser preview (`npx hyperframes preview`): Near-instant, even for 15 min (you scrub the timeline in browser).
  - Draft renders: Use `--quality draft` or lower fps/res for quick tests (much faster).
  - Full high-quality render only at the end.

- **Comparison to traditional production**:
  - Manual (After Effects + voice actor + editor): 4-20+ hours per video (plus cost).
  - Your system: 1-3 hours end-to-end for a polished 10-15 min piece **after the first few runs** (most time is unattended render).
  - Daily production: Feasible if you run overnight or on dedicated hardware, or keep videos shorter (2-5 min is sweet spot for speed).

### Recommendations for 10-15 Min Videos

1. **Optimize for speed**:
   - Minimize shader transitions (use hard cuts + GSAP/CSS for most changes). Limit to 1-3 key moments.
   - Use "draft" quality for most iterations.
   - Split long videos into 3-5 minute segments → render in parallel → FFmpeg concat (big win for long content).
   - Lower fps (24 instead of 30) or 720p for internal versions.

2. **Hardware strategy**:
   - Dedicated render server (many cores + SSD + optional GPU).
   - Use Hyperframes' `workers` flag (up to 8) and the benchmark command to tune your machine.
   - Cloud (AWS/GCP with high vCPU) for burst capacity.

3. **Is 10-15 min realistic for news?**
   - Great for in-depth features, documentaries, or "explainers."
   - For daily breaking news, consider 60-180 second "video abstracts" first (these will render in 5-20 minutes).
   - The system shines brightest on shorter-to-medium lengths where render time is acceptable for high volume.

4. **Measurement**:
   - Once you have the CLI, run `npx hyperframes benchmark` on sample compositions of increasing length.
   - Add timing logs to your CLI.

**Bottom line estimate for a production 10-15 min news video** (after tool is mature):
- **Optimistic (optimized composition, good hardware)**: 45-90 minutes total wall time.
- **Realistic with professional cinematic touches**: 2-6 hours (mostly unattended render).
- **Daily throughput**: 4-12 such videos per day on one strong machine if batched overnight, or more with segmentation + parallel hardware.

This is still dramatically faster and cheaper than traditional video production.

(Section added 2026-06-09 based on latest Hyperframes benchmarks and analogs.)

## Next Steps & Recommendations (continued)
- Refine the news.json schema with your exact fields?
- Have me create the initial TS CLI skeleton + schema file + basic HTML template in the workspace?
- Prototype a full sample composition HTML + GSAP for a fake news story?
- Research specific Kokoro voices or catalog blocks more?
- Add background music handling or vertical video support?

Let's iterate — provide a real sample news.json or your preferred video style/length, and we'll make this production-ready fast! 

(Files generated in this workspace will persist for reference.)