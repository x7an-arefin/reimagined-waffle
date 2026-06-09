import fse from 'fs-extra';
import path from 'path';
import { createWriteStream, statSync } from 'fs';
import type { Photo } from './types/news.js';

const { pathExists, copy, ensureDir, writeFile } = fse;

export interface ProcessedPhoto {
  originalSrc: string;
  localPath: string;          // path inside assets/
  assetName: string;          // e.g. photo-1.jpg
  caption?: string;
  alt: string;
  credit?: string;
  width?: number;
  height?: number;
  warnOversized: boolean;
}

const MAX_RECOMMENDED_BYTES = 4 * 1024 * 1024; // 4MB decoded warning threshold

/**
 * Download (if URL) or copy (if local) all news photos into the project assets/ dir.
 * Produces ProcessedPhoto objects with local paths for use in composition generation.
 *
 * @param photos    - Photo array from news.json
 * @param assetsDir - Destination assets directory
 */
export async function downloadAndProcessPhotos(
  photos: Photo[],
  assetsDir: string
): Promise<ProcessedPhoto[]> {
  await ensureDir(assetsDir);

  const processed: ProcessedPhoto[] = [];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const ext = getExtension(photo.src);
    const assetName = `photo-${i + 1}${ext}`;
    const destPath = path.join(assetsDir, assetName);

    console.log(`   Photo ${i + 1}/${photos.length}: ${shortenSrc(photo.src)}`);

    try {
      if (photo.src.startsWith('http://') || photo.src.startsWith('https://')) {
        // Download remote URL using Node 22 native fetch
        await downloadFile(photo.src, destPath);
        console.log(`     ✅ Downloaded → assets/${assetName}`);
      } else {
        // Local file — resolve relative to CWD
        const resolvedSrc = path.resolve(photo.src);
        if (await pathExists(resolvedSrc)) {
          await copy(resolvedSrc, destPath);
          console.log(`     ✅ Copied → assets/${assetName}`);
        } else {
          // Try resolving relative to the photo src as-is
          console.warn(`     ⚠️  Photo not found: ${photo.src} — using placeholder`);
          await writePlaceholderPhoto(destPath, photo.alt, i + 1);
        }
      }

      // Size warning (Chrome decodes all images to raw RGBA — large files = slow render)
      let warnOversized = false;
      try {
        const stat = statSync(destPath);
        if (stat.size > MAX_RECOMMENDED_BYTES) {
          warnOversized = true;
          const mb = (stat.size / 1024 / 1024).toFixed(1);
          console.warn(`     ⚠️  Large image: ${mb}MB. For faster renders, resize to max 3840px width.`);
          console.warn(`     Tip: mogrify -resize 3840x3840\\> "${destPath}"`);
        }
      } catch { /* stat may fail on placeholder */ }

      processed.push({
        originalSrc: photo.src,
        localPath:   destPath,
        assetName,
        caption:     photo.caption,
        alt:         photo.alt,
        credit:      photo.credit,
        warnOversized,
      });

    } catch (err: any) {
      console.warn(`     ⚠️  Failed to process photo ${i + 1}: ${err.message ?? err}`);
      // Write placeholder so composition HTML still has a valid image reference
      await writePlaceholderPhoto(destPath, photo.alt, i + 1);
      processed.push({
        originalSrc: photo.src,
        localPath:   destPath,
        assetName,
        caption:     photo.caption,
        alt:         photo.alt,
        credit:      photo.credit,
        warnOversized: false,
      });
    }
  }

  return processed;
}

/**
 * Download a remote file to a local path using Node 22 native fetch.
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  const buffer = await response.arrayBuffer();
  await writeFile(destPath, Buffer.from(buffer));
}

/**
 * Write a simple SVG placeholder for a missing photo.
 * The SVG uses the news color palette so the composition still looks good.
 */
async function writePlaceholderPhoto(destPath: string, alt: string, index: number): Promise<void> {
  // Write as .jpg filename but SVG content — browsers handle this fine
  // For actual Hyperframes render, replace with real photos
  const colors = ['#0A2540', '#1a3a5c', '#0d3050', '#162d45'];
  const bg = colors[(index - 1) % colors.length];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <rect width="1920" height="1080" fill="${bg}"/>
  <rect x="160" y="440" width="1600" height="4" fill="#E63946" opacity="0.6"/>
  <text x="960" y="500" font-family="Arial, sans-serif" font-size="64" font-weight="bold" fill="#ffffff" text-anchor="middle" opacity="0.9">
    Photo ${index}
  </text>
  <text x="960" y="580" font-family="Arial, sans-serif" font-size="32" fill="#a0b4c8" text-anchor="middle" opacity="0.8">
    ${escapeXml(alt)}
  </text>
  <text x="960" y="640" font-family="Arial, sans-serif" font-size="24" fill="#6080a0" text-anchor="middle">
    Replace with actual photo
  </text>
</svg>`;

  await writeFile(destPath, svg, 'utf-8');
}

/**
 * Get file extension from a URL or local path. Defaults to .jpg.
 */
function getExtension(src: string): string {
  try {
    const base = src.startsWith('http') ? new URL(src).pathname : src;
    const ext = path.extname(base).toLowerCase();
    // Accept common image formats; default to .jpg for unknowns
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
  } catch {
    return '.jpg';
  }
}

/** Shorten a src for console display */
function shortenSrc(src: string): string {
  if (src.length <= 60) return src;
  return src.slice(0, 30) + '...' + src.slice(-20);
}

/** Escape XML special characters */
function escapeXml(str: string): string {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
}
