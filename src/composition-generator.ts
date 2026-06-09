import fse from 'fs-extra';
import path from 'path';
import type { News } from './types/news.js';
import type { ProcessedPhoto } from './image-processor.js';

const { writeFile, ensureDir, pathExists } = fse;
import { getWavDuration } from './wav-parser.js';
import {
  loadTranscript,
  getAudioDuration,
  distributePhotoTimings,
  alignBeatsToTranscript,
  generateWordSpans,
  estimateTimings,
  type WordTimestamp,
  type PhotoTiming,
  type BeatTiming,
} from './transcript-sync.js';

// === News Brand Color Palette ===
const PALETTE = {
  navy:       '#0A2540',
  navyLight:  '#122d4d',
  accent:     '#E63946', // Breaking red
  gold:       '#F4A261', // Highlight amber
  white:      '#FFFFFF',
  offWhite:   '#F0F4F8',
  grayLight:  '#A0B4C8',
  overlay:    'rgba(10, 37, 64, 0.82)',
  overlayMid: 'rgba(10, 37, 64, 0.55)',
};

// === Canvas sizes per resolution ===
const CANVAS = {
  '1080p': { w: 1920, h: 1080 },
  '720p':  { w: 1280, h: 720  },
  '4k':    { w: 3840, h: 2160 },
  '9:16':  { w: 1080, h: 1920 },
  '1:1':   { w: 1080, h: 1080 },
};

type Resolution = keyof typeof CANVAS;

/**
 * Generate a full Hyperframes project: index.html + assets/ + README.
 *
 * Features:
 * - Google Fonts (Inter + Playfair Display) — professional news typography
 * - Breaking news lower-third bar with style-aware framing
 * - Photo Ken Burns (zoom+pan) on wrapper divs — no direct img animation
 * - Photo crossfade via overlapping clips + GSAP opacity
 * - Body text reveals — transcript-aligned when available, staggered fallback
 * - Word-level caption highlights driven by transcript timestamps
 * - Vignette + grain overlays for cinematic feel
 * - Outro: newspaper branding + URL pill fade in
 * - All GSAP timelines registered as window.__timelines[id] for Hyperframes renderer
 */
export async function generateComposition(
  news: News,
  script: string,
  narrationPath: string,
  transcriptPath: string,
  projectDir: string,
  photos: ProcessedPhoto[],
  options: any
): Promise<void> {
  await ensureDir(projectDir);
  await ensureDir(path.join(projectDir, 'assets'));
  await ensureDir(path.join(projectDir, 'compositions'));

  // Load transcript for real timing (empty array = fall back to estimates)
  const words: WordTimestamp[] = await loadTranscript(transcriptPath);
  const hasTranscript = words.length > 0;

  // Calculate timing
  const estimatedDuration = news.duration_hint_seconds ?? Math.max(35, script.split(' ').length / 2.5);
  
  // Try to get exact WAV duration first
  let wavDuration = getWavDuration(narrationPath);
  if (wavDuration <= 0) {
    wavDuration = hasTranscript ? getAudioDuration(words, estimatedDuration) : estimatedDuration;
  }
  
  const isSegment = !!options.isSegment;
  const segmentIndex = options.segmentIndex !== undefined ? parseInt(options.segmentIndex) : 0;
  const totalSegments = options.totalSegments !== undefined ? parseInt(options.totalSegments) : 1;

  // Add padding at the end for the outro sequence ONLY in the last segment or non-split builds
  const isLastSegment = !isSegment || (segmentIndex === totalSegments - 1);
  const outroDur = isLastSegment ? 4.5 : 0.5;
  const totalDuration = wavDuration + outroDur;

  const bgMusicPath = path.join(projectDir, 'assets', 'bg-music.mp3');
  const hasBgMusic = await pathExists(bgMusicPath);

  const isFirstSegment = !isSegment || (segmentIndex === 0);
  const introEnd = isFirstSegment ? 5.5 : 0.5;
  const beatIntroEnd = isFirstSegment ? 8.0 : 0.5;

  const photoTimings: PhotoTiming[] = distributePhotoTimings(totalDuration, photos.length, introEnd, outroDur);

  const beats: BeatTiming[] = hasTranscript
    ? alignBeatsToTranscript(words, news.body)
    : news.body.map((para, i) => {
        const contentDuration = Math.max(totalDuration - beatIntroEnd - outroDur, news.body.length * 2);
        const segLen = contentDuration / news.body.length;
        const start  = beatIntroEnd + i * segLen;
        return { beatIndex: i, text: para, start, end: start + segLen, duration: segLen };
      });

  // Canvas dimensions
  const res = (CANVAS[options.resolution as Resolution] ?? CANVAS['1080p']);
  const { w, h } = res;

  // Style-specific intro label
  const styleLabel: Record<string, string> = {
    breaking: '🔴 BREAKING NEWS',
    feature:  '📰 IN DEPTH',
    data:     '📊 DATA REPORT',
    standard: '📢 NEWS',
  };
  const label = styleLabel[news.style] ?? styleLabel.standard;

  const headlineWordsHtml = news.title
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map((word, i) => `<span class="headline-word" style="display:inline-block; transform-origin: center bottom;">${escHtml(word)}</span>`)
    .join(' ');

  // Build GSAP calls for photos (Ken Burns + crossfades)
  const photoGsapLines: string[] = [];
  photos.forEach((_, i) => {
    const pt = photoTimings[i];
    const dir = i % 2 === 0 ? -1 : 1; // alternate pan direction
    const wrapId = `#photo-wrap-${i}`;
    const imgId  = `#photo-img-${i}`;

    // Fade wrapper in (crossfade with previous)
    photoGsapLines.push(
      `// Photo ${i + 1}`,
      `tl.fromTo('${wrapId}', { opacity: 0 }, { opacity: 1, duration: 1.2, ease: 'power2.inOut' }, ${pt.start});`,
      // Ken Burns: slow zoom + subtle pan on the inner img
      `tl.fromTo('${imgId}', { scale: 1.0, x: ${dir * 0} }, { scale: 1.07, x: ${dir * 30}, duration: ${pt.duration}, ease: 'none' }, ${pt.start});`,
    );
    // Fade out before next photo (overlap of 1.2s)
    if (i < photos.length - 1) {
      const fadeStart = (photoTimings[i + 1].start - 0.3).toFixed(1);
      photoGsapLines.push(`tl.to('${wrapId}', { opacity: 0, duration: 1.0, ease: 'power2.inOut' }, ${fadeStart});`);
    } else {
      // Last photo fades at outro
      const outroStart = (totalDuration - 4.5).toFixed(1);
      photoGsapLines.push(`tl.to('${wrapId}', { opacity: 0, duration: 1.5, ease: 'power2.inOut' }, ${outroStart});`);
    }
  });

  // Build GSAP calls for body beat reveals
  const beatGsapLines: string[] = [];
  beats.forEach((beat, i) => {
    beatGsapLines.push(
      `tl.set('#beat-${i}', { opacity: 1 }, ${beat.start.toFixed(2)});`,
      `tl.fromTo('#beat-${i} .word', { opacity: 0.15, y: 15, rotateX: -30 }, { opacity: 1, y: 0, rotateX: 0, duration: 0.6, ease: 'power2.out', stagger: 0.05 }, ${beat.start.toFixed(2)});`
    );
    // Fade out previous beat when new one comes in
    if (i > 0) {
      const prevFadeOut = (beat.start - 0.1).toFixed(2);
      beatGsapLines.push(`tl.to('#beat-${i - 1}', { opacity: 0, y: -15, duration: 0.5, ease: 'power2.in' }, ${prevFadeOut});`);
    }
    // Last beat fades out at the outro
    if (i === beats.length - 1) {
      const lastFadeOut = (totalDuration - 4.5 - 0.1).toFixed(2);
      beatGsapLines.push(`tl.to('#beat-${i}', { opacity: 0, y: -15, duration: 0.5, ease: 'power2.in' }, ${lastFadeOut});`);
    }
  });

  // Photo clips HTML
  const photoClipsHtml = photos.map((photo, i) => {
    const pt = photoTimings[i];
    const captionHtml = photo.caption
      ? `<div class="caption-bar" id="caption-${i}">
          <span class="caption-text">${escHtml(photo.caption)}</span>
          ${photo.credit ? `<span class="caption-credit"> — ${escHtml(photo.credit)}</span>` : ''}
        </div>`
      : '';

    return `
  <!-- Photo ${i + 1}: ${escHtml(photo.alt)} -->
  <div id="photo-wrap-${i}" class="clip photo-wrap"
       data-start="${pt.start}" data-duration="${pt.duration}" data-track-index="${3 + i * 2}"
       style="position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;overflow:hidden;">
    <img id="photo-img-${i}" src="assets/${photo.assetName}"
         alt="${escHtml(photo.alt)}"
         style="width:100%;height:100%;object-fit:cover;transform-origin:center center;" />
    <div class="vignette-overlay"></div>
    ${captionHtml}
  </div>`;
  }).join('\n');

  // Beat text clips HTML
  const beatClipsHtml = beats.map((beat, i) => {
    const wordsSpans = generateWordSpans(beat.text);
    return `
  <!-- Beat ${i + 1} -->
  <div id="beat-${i}" class="clip beat-text"
       data-start="${beat.start.toFixed(2)}"
       data-duration="${beat.duration.toFixed(2)}"
       data-track-index="${3 + photos.length * 2 + i}"
       style="opacity:0; perspective: 800px; transform-style: preserve-3d;">
    <p class="beat-para">${wordsSpans}</p>
  </div>`;
  }).join('\n');

  // Outro timing
  const outroStart = totalDuration - 4.5;

  // Extend timeline sentinel (zero-cost, ensures full duration)
  const sentinelLine = `tl.set({}, {}, ${totalDuration.toFixed(1)}); // extend timeline to full duration`;

  // Segment layout configurations
  let titleBlockHtml = '';
  let titleGsap = '';
  if (isFirstSegment) {
    titleBlockHtml = `
  <!-- ─── TITLE BLOCK (intro only) ─── -->
  <div id="accent-bar"></div>
  <div id="title-block" class="clip"
       data-start="0" data-duration="6" data-track-index="2"
       style="transform-style: preserve-3d; z-index: 25;">
    <div class="news-label" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px;">
      <svg class="pulsing-dot" width="12" height="12" viewBox="0 0 12 12" style="overflow: visible;">
        <circle cx="6" cy="6" r="4" fill="${PALETTE.white}"></circle>
      </svg>
      <span>${escHtml(label)}</span>
    </div>
    <h1 class="news-headline">${headlineWordsHtml}</h1>
    ${news.lead ? `<p class="news-lead">${escHtml(news.lead)}</p>` : ''}
  </div>`;

    titleGsap = `
    // ── TITLE SEQUENCE ──
    // Accent bar wipe in
    tl.fromTo('#accent-bar', { width: 0 }, { width: '${Math.round(w * 0.15)}px', duration: 0.7, ease: 'power3.out' }, 0.2);
    // Label slam
    tl.from('.news-label', { opacity: 0, x: -30, duration: 0.5, ease: 'power3.out' }, 0.5);
    
    // Headline: 3D staggered word reveal
    tl.set('#title-block', { perspective: 1000 }, 0);
    tl.fromTo('.headline-word', 
      { opacity: 0, y: 50, rotateX: -60, scale: 0.8 }, 
      { opacity: 1, y: 0, rotateX: 0, scale: 1, duration: 0.85, ease: 'back.out(1.5)', stagger: 0.08 }, 
      0.6
    );

    // Lead line
    ${news.lead ? "tl.from('.news-lead', { opacity: 0, y: 20, duration: 0.9, ease: 'power2.out' }, 1.3);" : '// (no lead)'}
    // Title block fade out at end of intro
    tl.to('#title-block', { opacity: 0, y: -20, duration: 0.7, ease: 'power2.in' }, 5.5);
    tl.to('#accent-bar',  { opacity: 0, duration: 0.4, ease: 'power2.in' }, 5.7);
    `;
  }

  let outroHtml = '';
  let outroGsap = '';
  if (isLastSegment) {
    outroHtml = `
  <!-- ─── OUTRO ─── -->
  <div id="outro" class="clip"
       data-start="${outroStart.toFixed(2)}"
       data-duration="${(totalDuration - outroStart + 0.5).toFixed(2)}"
       data-track-index="${3 + photos.length * 2 + beats.length}"
       style="opacity:0;">
    <div class="outro-accent-line"></div>
    <div class="outro-paper">${escHtml(news.metadata?.author ?? 'The Daily')}</div>
    <div class="outro-tagline">Stay Informed &bull; Stay Ahead</div>
    <div class="outro-accent-line"></div>
  </div>`;

    outroGsap = `
    // ── OUTRO ──
    tl.to('#outro',         { opacity: 1, duration: 1.2, ease: 'power2.inOut' }, ${outroStart.toFixed(2)});
    tl.from('.outro-paper', { opacity: 0, y: 30, duration: 1.0, ease: 'power3.out' }, ${(outroStart + 0.4).toFixed(2)});
    tl.from('.outro-tagline', { opacity: 0, duration: 0.8, ease: 'power2.out' }, ${(outroStart + 0.9).toFixed(2)});
    tl.from('.outro-accent-line', { scaleX: 0, duration: 0.6, ease: 'power3.out', stagger: 0.2 }, ${(outroStart + 0.3).toFixed(2)});
    `;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(news.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Playfair+Display:wght@700;900&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Root composition canvas ── */
    #root {
      position: relative;
      width: ${w}px;
      height: ${h}px;
      overflow: hidden;
      background: ${PALETTE.navy};
      font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
      color: ${PALETTE.white};
    }

    /* ── Photo layers ── */
    .photo-wrap { pointer-events: none; z-index: 2; }
    .photo-wrap img { display: block; }

    /* ── Staggered word animation helpers ── */
    .headline-word, .word {
      display: inline-block;
      transform-style: preserve-3d;
      backface-visibility: hidden;
    }

    /* ── Cinematic vignette ── */
    .vignette-overlay {
      position: absolute; inset: 0;
      background: radial-gradient(ellipse at center, transparent 40%, rgba(5, 20, 40, 0.72) 100%);
      pointer-events: none;
    }

    /* ── Global film grain overlay (static texture, cheap) ── */
    #grain {
      position: absolute; inset: 0; z-index: 90;
      opacity: 0.035;
      pointer-events: none;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E");
      background-size: 256px 256px;
      animation: grainDrift 0.15s steps(1) infinite;
    }
    @keyframes grainDrift {
      0%   { background-position: 0 0; }
      25%  { background-position: -40px -20px; }
      50%  { background-position: 20px 40px; }
      75%  { background-position: -20px 20px; }
      100% { background-position: 40px -40px; }
    }

    /* ── Persistent dark gradient (bottom overlay for text readability) ── */
    #bottom-gradient {
      position: absolute; bottom: 0; left: 0; right: 0;
      height: 45%;
      background: linear-gradient(to top, rgba(5, 15, 30, 0.92) 0%, transparent 100%);
      z-index: 10; pointer-events: none;
    }
    #top-gradient {
      position: absolute; top: 0; left: 0; right: 0;
      height: 25%;
      background: linear-gradient(to bottom, rgba(5, 15, 30, 0.7) 0%, transparent 100%);
      z-index: 10; pointer-events: none;
    }

    /* ── Title block ── */
    #title-block {
      position: absolute;
      bottom: ${Math.round(h * 0.12)}px;
      left: ${Math.round(w * 0.06)}px;
      right: ${Math.round(w * 0.06)}px;
      z-index: 20;
    }
    .news-label {
      display: inline-block;
      background: ${PALETTE.accent};
      color: ${PALETTE.white};
      font-family: 'Inter', sans-serif;
      font-size: ${Math.round(h * 0.024)}px;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      padding: ${Math.round(h * 0.008)}px ${Math.round(w * 0.012)}px;
      margin-bottom: ${Math.round(h * 0.018)}px;
      border-radius: 3px;
    }
    .news-headline {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: ${Math.round(h * 0.068)}px;
      font-weight: 900;
      line-height: 1.08;
      color: ${PALETTE.white};
      text-shadow: 0 3px 24px rgba(0, 0, 0, 0.8), 0 1px 4px rgba(0, 0, 0, 0.5);
      margin-bottom: ${Math.round(h * 0.018)}px;
      letter-spacing: -0.01em;
    }
    .news-lead {
      font-family: 'Inter', sans-serif;
      font-size: ${Math.round(h * 0.026)}px;
      font-weight: 500;
      color: ${PALETTE.offWhite};
      line-height: 1.45;
      text-shadow: 0 2px 12px rgba(0, 0, 0, 0.7);
      max-width: ${Math.round(w * 0.75)}px;
    }

    /* ── Red accent bar (breaking news style) ── */
    #accent-bar {
      position: absolute;
      bottom: ${Math.round(h * 0.195)}px;
      left: ${Math.round(w * 0.06)}px;
      width: 0;
      height: 4px;
      background: ${PALETTE.accent};
      z-index: 21;
    }

    /* ── Beat text (body) ── */
    .beat-text {
      position: absolute;
      bottom: ${Math.round(h * 0.12)}px;
      left: ${Math.round(w * 0.06)}px;
      right: ${Math.round(w * 0.08)}px;
      z-index: 20;
    }
    .beat-para {
      font-family: 'Inter', sans-serif;
      font-size: ${Math.round(h * 0.034)}px;
      font-weight: 600;
      line-height: 1.5;
      color: ${PALETTE.white};
      text-shadow: 0 2px 16px rgba(0, 0, 0, 0.85);
      max-width: ${Math.round(w * 0.8)}px;
    }

    /* ── Caption bar (photo attribution) ── */
    .caption-bar {
      position: absolute;
      bottom: ${Math.round(h * 0.28)}px;
      left: ${Math.round(w * 0.04)}px;
      background: ${PALETTE.overlay};
      backdrop-filter: blur(4px);
      padding: ${Math.round(h * 0.008)}px ${Math.round(w * 0.014)}px;
      border-left: 3px solid ${PALETTE.accent};
      border-radius: 0 4px 4px 0;
      z-index: 15;
      max-width: ${Math.round(w * 0.6)}px;
    }
    .caption-text {
      font-family: 'Inter', sans-serif;
      font-size: ${Math.round(h * 0.02)}px;
      font-weight: 500;
      color: ${PALETTE.offWhite};
    }
    .caption-credit {
      font-size: ${Math.round(h * 0.017)}px;
      color: ${PALETTE.grayLight};
      font-style: italic;
    }

    /* ── Date / metadata bar (top-left) ── */
    #meta-bar {
      position: absolute;
      top: ${Math.round(h * 0.04)}px;
      left: ${Math.round(w * 0.05)}px;
      z-index: 25;
      display: flex;
      align-items: center;
      gap: ${Math.round(w * 0.015)}px;
    }
    .meta-newspaper {
      font-family: 'Playfair Display', serif;
      font-size: ${Math.round(h * 0.028)}px;
      font-weight: 700;
      color: ${PALETTE.white};
      opacity: 0.92;
      letter-spacing: 0.02em;
    }
    .meta-dot { color: ${PALETTE.accent}; font-size: ${Math.round(h * 0.028)}px; }
    .meta-date {
      font-family: 'Inter', sans-serif;
      font-size: ${Math.round(h * 0.02)}px;
      font-weight: 500;
      color: ${PALETTE.grayLight};
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    /* ── Outro card ── */
    #outro {
      position: absolute; inset: 0;
      background: ${PALETTE.navy};
      z-index: 80;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: ${Math.round(h * 0.03)}px;
    }
    .outro-paper {
      font-family: 'Playfair Display', serif;
      font-size: ${Math.round(h * 0.08)}px;
      font-weight: 900;
      color: ${PALETTE.white};
      letter-spacing: 0.02em;
    }
    .outro-tagline {
      font-family: 'Inter', sans-serif;
      font-size: ${Math.round(h * 0.026)}px;
      font-weight: 400;
      color: ${PALETTE.grayLight};
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .outro-accent-line {
      width: ${Math.round(w * 0.12)}px;
      height: 3px;
      background: ${PALETTE.accent};
      border-radius: 2px;
    }
  </style>
</head>
<body>

<div id="root"
     data-composition-id="${news.id}"
     data-start="0"
     data-width="${w}"
     data-height="${h}">

  <!-- ─── AUDIO TRACKS ─── -->
  <audio id="narration" class="clip"
         data-start="0"
         data-duration="${totalDuration.toFixed(2)}"
         data-track-index="0"
         data-volume="1"
         src="assets/narration.wav"></audio>
  ${hasBgMusic ? `
  <audio id="bg-music" class="clip"
         data-start="0"
         data-duration="${totalDuration.toFixed(2)}"
         data-track-index="100"
         data-volume="0.06"
         loop
         src="assets/bg-music.mp3"></audio>` : ''}

  <!-- ─── BACKGROUND (fallback color, shows through before first photo) ─── -->
  <div style="position:absolute;inset:0;background:linear-gradient(135deg, ${PALETTE.navy} 0%, ${PALETTE.navyLight} 100%);z-index:1;"></div>

  <!-- ─── PHOTO SEQUENCE ─── -->
${photoClipsHtml}

  <!-- ─── READABILITY GRADIENTS ─── -->
  <div id="bottom-gradient"></div>
  <div id="top-gradient"></div>

  <!-- ─── META BAR (top-left: newspaper name + date) ─── -->
  <div id="meta-bar" class="clip"
       data-start="0" data-duration="${totalDuration.toFixed(2)}" data-track-index="1">
    <span class="meta-newspaper">${escHtml(news.metadata?.author ?? 'The Daily')}</span>
    <span class="meta-dot">•</span>
    <span class="meta-date">${escHtml(news.metadata?.date ?? new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}</span>
  </div>

  ${titleBlockHtml}

  <!-- ─── SVG CORNER RETICLES & PROGRESS BAR ─── -->
  <svg id="reticles" width="100%" height="100%" style="position:absolute; inset:0; z-index: 30; pointer-events:none;">
    <path id="reticle-tl" d="M 40 80 L 40 40 L 80 40" fill="none" stroke="${PALETTE.accent}" stroke-width="4" stroke-linecap="square" />
    <path id="reticle-tr" d="M ${w - 80} 40 L ${w - 40} 40 L ${w - 40} 80" fill="none" stroke="${PALETTE.accent}" stroke-width="4" stroke-linecap="square" />
    <path id="reticle-bl" d="M 40 ${h - 80} L 40 ${h - 40} L 80 ${h - 40}" fill="none" stroke="${PALETTE.accent}" stroke-width="4" stroke-linecap="square" />
    <path id="reticle-br" d="M ${w - 80} ${h - 40} L ${w - 40} ${h - 40} L ${w - 40} ${h - 80}" fill="none" stroke="${PALETTE.accent}" stroke-width="4" stroke-linecap="square" />
  </svg>

  <div id="progress-container" style="position:absolute; bottom:0; left:0; right:0; height: 6px; background: rgba(255,255,255,0.1); z-index: 100;">
    <div id="progress-bar" style="width:0%; height:100%; background: linear-gradient(to right, ${PALETTE.accent}, ${PALETTE.gold}); box-shadow: 0 0 10px ${PALETTE.accent};"></div>
  </div>

  <!-- ─── BODY TEXT BEATS (one per paragraph) ─── -->
${beatClipsHtml}

  ${outroHtml}

  <!-- ─── FILM GRAIN OVERLAY ─── -->
  <div id="grain"></div>

  <!-- ─── GSAP (CDN) ─── -->
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    /**
     * news-hypervideo — GSAP Timeline
     * Generated by news-hypervideo CLI v0.1.0
     *
     * Registered as window.__timelines["${news.id}"] for Hyperframes deterministic renderer.
     * All tweens use absolute time positions (tl.to/from(el, {}, TIME)).
     * Timeline is PAUSED — Hyperframes seeks it frame-by-frame during render.
     *
     * Total duration: ${totalDuration.toFixed(2)}s | Photos: ${photos.length} | Beats: ${beats.length}
     * Transcript-driven: ${hasTranscript}
     */
    const tl = gsap.timeline({ paused: true });

    // ── PROGRESS BAR & DYNAMIC DOCK RETICLES ──
    tl.fromTo('#progress-bar', { width: '0%' }, { width: '100%', duration: ${totalDuration.toFixed(2)}, ease: 'none' }, 0);
    tl.fromTo('#reticle-tl', { x: -30, y: -30, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' }, 0.2);
    tl.fromTo('#reticle-tr', { x: 30, y: -30, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' }, 0.2);
    tl.fromTo('#reticle-bl', { x: -30, y: 30, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' }, 0.2);
    tl.fromTo('#reticle-br', { x: 30, y: 30, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' }, 0.2);
    tl.fromTo('.pulsing-dot circle', { r: 3, opacity: 0.3 }, { r: 6, opacity: 1, duration: 0.6, repeat: Math.floor(${totalDuration} / 1.2) - 1, yoyo: true, ease: 'sine.inOut' }, 0);

    ${titleGsap}
    // Meta bar fade in
    tl.from('#meta-bar', { opacity: 0, duration: 0.8, ease: 'power2.out' }, 0.3);

    // ── PHOTO SEQUENCE (Ken Burns + crossfades) ──
    ${photoGsapLines.join('\n    ')}

    // ── BODY TEXT BEATS ──
    ${beatGsapLines.join('\n    ')}

    ${outroGsap}

    // ── Extend timeline to full duration (zero-cost) ──
    ${sentinelLine}

    // ── Register with Hyperframes renderer ──
    window.__timelines = window.__timelines || {};
    window.__timelines['${news.id}'] = tl;

    console.log('%c[news-hypervideo] GSAP timeline registered for "${news.id}"', 'color:#E63946;font-weight:bold');
    console.log('%c  Duration: ${totalDuration.toFixed(2)}s | Photos: ${photos.length} | Beats: ${beats.length} | Transcript: ${hasTranscript}', 'color:#888');
  </script>
</div>

</body>
</html>`;

  await writeFile(path.join(projectDir, 'index.html'), html);

  // meta.json for Hyperframes project identification
  await writeFile(
    path.join(projectDir, 'meta.json'),
    JSON.stringify({
      name:        news.title,
      id:          news.id,
      style:       news.style,
      duration:    totalDuration,
      resolution:  `${w}x${h}`,
      fps:         options.fps ?? 30,
      hasTranscript,
      created:     new Date().toISOString(),
      generator:   'news-hypervideo CLI v0.1.0',
    }, null, 2)
  );

  // README with quick commands
  await writeFile(
    path.join(projectDir, 'README.md'),
    `# ${news.title}\n\nGenerated by news-hypervideo CLI.\n\n` +
    `**Style**: ${news.style} | **Duration**: ~${Math.round(totalDuration)}s | **Photos**: ${photos.length}\n\n` +
    `## Quick Commands\n\n` +
    `\`\`\`bash\n# Preview in browser (hot reload):\nnpx hyperframes preview\n\n` +
    `# Render (standard quality):\nnpx hyperframes render --output ../${news.id}.mp4\n\n` +
    `# Draft render (fast for iteration):\nnpx hyperframes render --output ../${news.id}-draft.mp4 --quality draft\n\n` +
    `# Add cinematic transition:\nnpx hyperframes add cinematic-zoom\n# Then reference it in index.html as a sub-composition\n\`\`\`\n\n` +
    `## Polish Checklist\n` +
    `- [ ] Replace placeholder photos with real high-res images\n` +
    `- [ ] Run real TTS if stub was used\n` +
    `- [ ] Add 1-2 catalog shader transitions (cinematic-zoom, light-leak)\n` +
    `- [ ] Tweak font sizes / colors in the \`<style>\` block\n` +
    `- [ ] Add newspaper logo to outro (replace text with \`<img src="assets/logo.png">\`)\n`
  );

  console.log(`   Composition: ${totalDuration.toFixed(1)}s total | Transcript sync: ${hasTranscript ? 'YES ✅' : 'estimated ⚠️'}`);
}

/** Escape HTML special characters */
function escHtml(str: string): string {
  return str.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c
  );
}
