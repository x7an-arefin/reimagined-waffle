import fse from 'fs-extra';

const { readFile, pathExists } = fse;
import type { Photo } from './types/news.js';

/**
 * A single word with precise audio timestamps from Hyperframes transcribe.
 */
export interface WordTimestamp {
  text: string;
  start: number;  // seconds from start of audio
  end: number;    // seconds
}

/**
 * Timing slot for a photo in the video.
 */
export interface PhotoTiming {
  photoIndex: number;
  start: number;    // seconds
  end: number;      // seconds
  duration: number; // seconds
}

/**
 * A logical beat (paragraph or section) with timing.
 */
export interface BeatTiming {
  beatIndex: number;
  text: string;
  start: number;
  end: number;
  duration: number;
}

/**
 * Load and parse transcript.json produced by `npx hyperframes transcribe`.
 * Returns word-level timestamps. Falls back to empty array on parse errors.
 *
 * Hyperframes transcript format:
 * { words: [{ text: string, start: number, end: number }] }
 *
 * Whisper-based format (alternative):
 * { segments: [{ words: [...], start, end }] }
 */
export async function loadTranscript(transcriptPath: string): Promise<WordTimestamp[]> {
  if (!(await pathExists(transcriptPath))) {
    return [];
  }

  try {
    const raw = await readFile(transcriptPath, 'utf-8');
    const data = JSON.parse(raw);

    // Hyperframes native format: { words: [...] }
    if (Array.isArray(data.words) && data.words.length > 0) {
      return data.words.map((w: any) => ({
        text:  String(w.text  ?? w.word ?? '').trim(),
        start: Number(w.start ?? 0),
        end:   Number(w.end   ?? w.start ?? 0),
      })).filter((w: WordTimestamp) => w.text.length > 0);
    }

    // Whisper segment format: { segments: [{ words: [...] }] }
    if (Array.isArray(data.segments)) {
      const words: WordTimestamp[] = [];
      for (const seg of data.segments) {
        if (Array.isArray(seg.words)) {
          for (const w of seg.words) {
            const text = String(w.text ?? w.word ?? '').trim();
            if (text) {
              words.push({ text, start: Number(w.start ?? 0), end: Number(w.end ?? 0) });
            }
          }
        }
      }
      return words;
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Get total audio duration from transcript (last word's end time).
 * Falls back to provided estimate if transcript is empty.
 */
export function getAudioDuration(words: WordTimestamp[], fallbackSeconds: number): number {
  if (words.length === 0) return fallbackSeconds;
  return Math.ceil(words[words.length - 1].end) + 0.5; // small tail padding
}

/**
 * Distribute photo display times proportionally across the full narration duration.
 * First photo always starts at the title's end (after ~5s intro).
 * Photos get roughly equal time, with the last photo running to the outro.
 *
 * @param totalDuration - Total narration duration in seconds
 * @param photoCount    - Number of photos
 * @param introEnd      - When the title/intro clip ends (default: 5s)
 * @param outroStart    - When the outro/logo starts (default: 4s before end)
 */
export function distributePhotoTimings(
  totalDuration: number,
  photoCount: number,
  introEnd: number = 5,
  outroStart: number = 4
): PhotoTiming[] {
  const contentStart = introEnd;
  const contentEnd = totalDuration - outroStart;
  const contentDuration = Math.max(contentEnd - contentStart, photoCount * 4);
  const photoDuration = contentDuration / photoCount;

  return Array.from({ length: photoCount }, (_, i) => {
    const start = contentStart + i * photoDuration;
    const end = i < photoCount - 1 ? start + photoDuration : totalDuration;
    return {
      photoIndex: i,
      start: Math.round(start * 10) / 10,
      end:   Math.round(end   * 10) / 10,
      duration: Math.round((end - start) * 10) / 10,
    };
  });
}

/**
 * Split transcript words into beats (one per body paragraph).
 * Uses sentence boundaries in the words to align paragraph text to timestamps.
 *
 * @param words      - Word timestamps from transcript
 * @param paragraphs - Body paragraphs from news.json
 */
export function alignBeatsToTranscript(
  words: WordTimestamp[],
  paragraphs: string[]
): BeatTiming[] {
  if (words.length === 0 || paragraphs.length === 0) return [];

  // Normalize paragraphs into comparable word lists
  const totalWords = words.length;
  const wordsPerBeat = Math.floor(totalWords / paragraphs.length);

  return paragraphs.map((para, i) => {
    const startWordIdx = i * wordsPerBeat;
    const endWordIdx = i < paragraphs.length - 1
      ? (i + 1) * wordsPerBeat - 1
      : totalWords - 1;

    const clampedStart = Math.min(startWordIdx, totalWords - 1);
    const clampedEnd   = Math.min(endWordIdx,   totalWords - 1);

    return {
      beatIndex: i,
      text:      para,
      start:     Math.round(words[clampedStart].start * 10) / 10,
      end:       Math.round(words[clampedEnd].end     * 10) / 10,
      duration:  Math.round((words[clampedEnd].end - words[clampedStart].start) * 10) / 10,
    };
  });
}

/**
 * Generate an HTML string of <span> elements for a paragraph,
 * each span tagged with its word index for GSAP word-highlight animations.
 *
 * Produces: <span class="word" data-word-idx="0">Global</span> ...
 */
export function generateWordSpans(paragraph: string): string {
  return paragraph
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map((word, i) => `<span class="word" data-word-idx="${i}">${word}</span>`)
    .join(' ');
}

/**
 * Generate GSAP timeline calls for word-by-word caption highlighting.
 * Returns an array of JS lines to inject into the composition's <script>.
 *
 * @param words    - Word timestamps from transcript
 * @param selector - CSS selector for the word spans (e.g. '#caption .word')
 * @param offset   - Optional time offset if composition doesn't start at 0
 */
export function generateWordHighlightGSAP(
  words: WordTimestamp[],
  selector: string = '.caption-word',
  offset: number = 0
): string[] {
  if (words.length === 0) return [];

  const lines: string[] = [
    `// Word-by-word highlight synced to narration (${words.length} words)`,
  ];

  // Batch into groups of 5 for performance (avoid thousands of individual tweens)
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const t = (w.start + offset).toFixed(3);
    const dur = Math.max(w.end - w.start, 0.05).toFixed(3);
    lines.push(
      `tl.to('${selector}:nth-child(${i + 1})', { color: '#F4A261', fontWeight: 700, duration: ${dur}, ease: 'none' }, ${t});`
    );
    // Reset previous word's highlight
    if (i > 0) {
      const prevT = (w.start + offset - 0.05).toFixed(3);
      lines.push(
        `tl.to('${selector}:nth-child(${i})', { color: 'inherit', fontWeight: 400, duration: 0.05 }, ${prevT});`
      );
    }
  }

  return lines;
}

/**
 * Build estimated timings when no transcript is available.
 * Assumes average speaking rate of ~150 words per minute.
 */
export function estimateTimings(script: string, photoCount: number): {
  totalDuration: number;
  photoTimings: PhotoTiming[];
} {
  const wordCount = script.split(/\s+/).length;
  const wpm = 150; // average news narration pace
  const totalDuration = Math.ceil((wordCount / wpm) * 60) + 3; // +3s padding

  return {
    totalDuration,
    photoTimings: distributePhotoTimings(totalDuration, photoCount),
  };
}
