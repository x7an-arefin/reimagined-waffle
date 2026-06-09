# Hyperframes News Video — Render Time Optimization Tips & Tricks

**Goal**: Dramatically reduce the 2–10+ hour render times for 10–15 minute videos.

**Core Principle**: The bottleneck is **per-frame headless Chrome capture**, not encoding or TTS. Shaders, heavy DOM/compositing, and large assets multiply cost. Parallelism helps but has limits. Architectural splitting gives the biggest gains for long videos.

Data sources: Official Hyperframes Rendering + Performance guides, GitHub benchmarks (shader 10x slowdown), Remotion analogs, real production examples (42s video ≈ 3.5 min on M2 with 6 workers).

---

## 1. Quick CLI Flag Wins (Apply Immediately — 2–5x Speedup)

Use these in your CLI wrapper and document them.

| Trick | Command / Setting | Expected Impact | When to Use |
|-------|-------------------|-----------------|-------------|
| **Draft quality for iteration** | `--quality draft` (or `--crf 28`) | 2–4x faster | All testing / previews. Visually close enough for validation. |
| **Tune workers** | `--workers 4` or `--workers 8` (or `auto`) | 1.5–3x on multi-core | Start with `auto`. Increase on render server if CPU/RAM headroom (monitor htop). Max 8. |
| **GPU encoding** | `--gpu` | 10–30% faster encode (not capture) | Always for final renders on supported hardware (NVENC, VideoToolbox, etc.). |
| **Lower fps / resolution for tests** | `--fps 24` or `--resolution 720p` (via composition or flag) | 25–50% faster | Early iterations. |
| **Avoid Docker unless needed** | (default = local) | Faster startup & capture | Local dev & iteration. Use `--docker` only for final reproducible/CI renders. |
| **Benchmark your machine** | `npx hyperframes benchmark` | Discover optimal workers/quality | Run once per hardware. |

**CLI integration tip**: Add flags like `--draft`, `--fast`, `--final` presets in your `news-hypervideo` CLI that map to these.

---

## 2. Shader & Transition Strategy (Biggest Single Lever — Up to 10x)

From real benchmark: 14 short shaders → **9.7x slower** than hard cuts on the same timeline.

**Rules**:
- Use **hard cuts + GSAP/CSS transitions** for 90% of changes.
- Limit **catalog shader transitions** (`cinematic-zoom`, `flash-through-white`, etc.) to **1–3 per video** (key reveals or section breaks only).
- Replace shader transitions with:
  - GSAP `from/to` on opacity + scale/position.
  - CSS `transition` + `transform` (cheaper).
  - Simple crossfades via two overlapping clips + GSAP opacity.
- For "cinematic" feel without cost: Slow Ken Burns zooms (`ease: "none"`, long duration) + subtle film grain overlay (static PNG).

**In composition**:
```html
<!-- Good: Hard cut + GSAP reveal -->
<div data-start="12" ...>Section 2</div>

<!-- Expensive: Many shaders -->
<div data-composition-src="compositions/cinematic-zoom.html" data-start="..." data-duration="0.4"></div>
```

**Expected gain**: 3–10x on affected sections.

---

## 3. Image & Asset Optimization (Huge Memory & CPU Saver)

Chrome decodes every image to raw RGBA every frame. Size on disk doesn't matter — decoded size does.

**Rules**:
- Resize **all photos** to at most **2× canvas** (3840×2160 max for 1080p comp).
  ```bash
  mkdir -p assets/resized
  mogrify -path assets/resized -resize 3840x3840\> assets/*.jpg
  ```
- In `news.json` or generator: Auto-downscale or warn on oversized images.
- Use JPEG over PNG when possible (smaller decoded?).
- Preload critical images (Hyperframes has mechanisms; ensure `window.__renderReady`).
- For repeated backgrounds/overlays: Use small tiled images or CSS gradients instead of large photos.

**In HTML**:
```html
<img src="assets/resized/photo-1.jpg" style="object-fit: cover;" />
```

**Expected gain**: 20–60% on image-heavy scenes. Prevents OOM and massive slowdowns.

---

## 4. Avoid Expensive Compositing Effects (from Performance Guide)

**Never or minimize**:
- Stacked `backdrop-filter: blur()` on large areas (especially high radii like 64px+). Cost multiplies.
  - Fix: Pre-render the blurred effect into a static PNG once and use a regular `<img>`.
  - Limit to 2–3 tuned layers max.
- Heavy `box-shadow` / `text-shadow` on many animated elements.
- Large `filter: blur()` or complex filters on full-screen elements.
- `mask-image` combined with other expensive properties.

**Good alternatives**:
- Static pre-composited overlays.
- GSAP `opacity` + `scale` (very cheap).
- SVG filters only when necessary (test cost).

**Rule of thumb**: If preview stutters, the render will be proportionally slow.

---

## 5. GSAP & Animation Efficiency

- Always `gsap.timeline({ paused: true })`.
- Use `ease: "none"` for continuous motion (zooms/pans) — cheapest.
- Prefer `tl.set()` and simple `from/to` over complex multi-property tweens.
- Extend long timelines with `tl.set({}, {}, totalDuration)` (zero cost).
- Minimize per-frame DOM reads/writes in GSAP callbacks.
- Split heavy animations into sub-compositions (Hyperframes handles nesting efficiently).

**For photo Ken Burns (common in news)**:
```js
tl.to("#photo-wrapper", { scale: 1.06, x: -30, duration: 12, ease: "none" }, startTime);
```
(Wrap `<img>` in a positioned div — never animate the img tag dimensions directly.)

---

## 6. Architectural Tricks for Long Videos (10–15 min) — 3–8x Speedup

This is the highest-leverage strategy for your use case.

**Segment & Parallel Render**:
1. Split the 10–15 min video into **3–6 logical segments** (e.g. 2–3 min each) in your news.json or storyboard.
2. Generate **separate Hyperframes projects** (or sub-compositions) for each segment.
3. Render segments **in parallel**:
   - On one machine: Use multiple terminal tabs or a simple script with `&` + `wait`.
   - On multiple machines / cloud: Even better.
4. Stitch with FFmpeg (very fast):
   ```bash
   ffmpeg -f concat -safe 0 -i segments.txt -c copy final.mp4
   ```

**Benefits**:
- Near-linear scaling with number of segments/workers.
- Each segment stays in fast "short composition" regime.
- Easier to iterate on one section without re-rendering everything.
- Memory per render stays manageable.

**Implementation in CLI**:
- Add `--segment` mode or auto-split based on `duration_hint` / transcript beats.
- Output `segments/` folder + concat script.

**Other architectural wins**:
- Use **sub-compositions** (`data-composition-src`) heavily — Hyperframes is designed for this.
- Keep individual compositions under ~2–3 minutes where possible.
- For very long narration: Pre-split script into beats and render beat-by-beat.

---

## 7. Preview & Iteration Workflow (Don't Render Full Until Ready)

- Do **99% of work in browser preview** (`npx hyperframes preview`).
  - It does the same per-frame work but you only pay when you scrub.
  - Fix expensive frames here (stutter = slow render).
- Use `--quality draft` + lower res/fps for quick test renders of sections.
- Only run full `--quality standard` (or high) at the very end.
- Add a "fast" preset in your CLI that does draft + low workers + segment mode.

---

## 8. Hardware, Environment & Measurement

- **Run the benchmark**: `npx hyperframes benchmark` — it tests different quality/FPS/workers and reports times. Use this to pick defaults for your news-video CLI.
- **Workers tuning**:
  - Default is conservative (half cores, max 4).
  - On a dedicated 16+ core render box: Try 6–8.
  - Watch RAM (each worker ~256MB+ Chrome) and CPU.
- **GPU**:
  - `--gpu` for encoding.
  - Local mode uses browser GPU for capture by default (good).
  - Docker often disables it.
- **Dedicated render machine** or cloud spot instances for long videos.
- **Profile slow frames** (Hyperframes/Remotion style): Add verbose logging or time individual scenes in your generator.
- Avoid running multiple full renders concurrently on the same machine (contention).

---

## 9. TTS & Pre-Processing (Small but Cumulative)

- Kokoro is already very fast. Use it.
- Pre-generate narration + transcript once per news.json and cache (your CLI should do this).
- For very long videos: Split script generation and TTS per segment too.
- Resize/optimize photos **once** when ingesting into `news.json` (store resized versions in assets).

---

## 10. Final Polish & Encoding (Post-Capture)

- After capture, you can do a fast second-pass FFmpeg re-encode if needed (rarely worth it).
- Use `--video-bitrate` or `--crf` only for delivery constraints, not speed.

---

## Expected Cumulative Impact (Applying All Tricks)

| Scenario | Before (naive) | After (all tips) | Speedup |
|----------|----------------|------------------|---------|
| 10-min video, some shaders, full res | 3–6 hours | 30–90 minutes | **4–8x** |
| 15-min cinematic | 6–10+ hours | 60–180 minutes | **4–10x** |
| Iteration cycle (draft + segments) | 45–90 min per test | 5–15 min | **6–10x** |

**Realistic target for daily news**:
- Short 2–4 min videos: 8–20 minutes end-to-end.
- 10–15 min features: 45–120 minutes (mostly parallel unattended renders).

---

## How to Implement in Your news-hypervideo CLI

1. Add presets: `--preset fast` / `--preset balanced` / `--preset final`.
2. Auto-apply image resizing on photo ingestion.
3. Detect and warn (or auto-replace) heavy effects in generated HTML.
4. Implement `--segments` / auto-segment mode + concat.
5. Expose `--workers`, `--quality`, `--gpu` directly.
6. Run `npx hyperframes benchmark` as part of `doctor` or first-run.
7. Cache TTS/transcript + resized assets per news ID.

---

## Measurement & Continuous Improvement

- Add timing output to your CLI (total time, per-segment, TTS vs render).
- After each render, log: duration, workers, quality, shaders used, image count.
- Periodically re-benchmark on your hardware.
- Profile one "slow scene" by temporarily isolating it.

**Next actions**:
- Update the composition generator to follow the authoring rules above.
- Add segmentation support.
- Wire the fast/draft presets.

This list, applied systematically, can bring long-form news video production from "overnight job" to "lunch break" territory on reasonable hardware.

(Compiled 2026-06-09 from official docs + community benchmarks.)