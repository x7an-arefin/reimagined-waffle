import { execa } from 'execa';
import fse from 'fs-extra';
import path from 'path';

const { ensureDir, writeFile } = fse;

interface RenderOptions {
  resolution: string;
  fps: number;
  quality: string;    // 'draft' | 'standard' | 'high'
  workers: string;    // '4' | '6' | '8' | 'auto'
  gpu: boolean;
}

const RESOLUTION_MAP: Record<string, { width: number; height: number }> = {
  '720p':  { width: 1280,  height: 720  },
  '1080p': { width: 1920,  height: 1080 },
  '4k':    { width: 3840,  height: 2160 },
  '9:16':  { width: 1080,  height: 1920 }, // Vertical (Shorts/Reels)
  '1:1':   { width: 1080,  height: 1080 }, // Square
};

/**
 * Render the Hyperframes project to MP4 using headless Chrome + FFmpeg.
 *
 * Performance notes:
 * - Each worker captures frames in parallel (Chrome BeginFrame API)
 * - Draft quality: ~2-4x faster than standard (great for iteration)
 * - Avoid shader transitions (10x cost) — use GSAP/CSS instead
 * - Segment long videos into 2-3 min chunks and concat with FFmpeg
 *
 * @param projectDir - Directory containing index.html + assets/
 * @param outputPath - Destination .mp4 path
 * @param options    - Resolution, fps, quality, workers, gpu
 */
export async function renderVideo(
  projectDir: string,
  outputPath: string,
  options: RenderOptions
): Promise<void> {
  await ensureDir(path.dirname(outputPath));

  const res = RESOLUTION_MAP[options.resolution] ?? RESOLUTION_MAP['1080p'];
  const workerCount = options.workers === 'auto' ? undefined : options.workers;

  // Build the hyperframes render command arguments
  const args: string[] = [
    'hyperframes', 'render',
    '--output', outputPath,
    '--fps',    String(options.fps),
  ];

  // Quality flag maps to Hyperframes quality levels
  if (options.quality && options.quality !== 'standard') {
    args.push('--quality', options.quality);
  }

  // Workers for parallel frame capture
  if (workerCount) {
    args.push('--workers', workerCount);
  }

  // GPU encoding acceleration (not Chrome capture — that's CPU-bound)
  if (options.gpu) {
    args.push('--gpu');
  }

  // Resolution: Hyperframes expects --resolution preset
  let resPreset = 'landscape';
  if (options.resolution === '4k') resPreset = '4k';
  else if (options.resolution === '9:16') resPreset = 'portrait';
  else if (options.resolution === '1:1') resPreset = 'square';
  else if (options.resolution === '1080p') resPreset = '1080p';
  args.push('--resolution', resPreset);

  console.log(`   Command: npx ${args.join(' ')}`);
  console.log(`   Working dir: ${projectDir}`);

  try {
    await execa('npx', args, {
      cwd: projectDir,
      stdio: 'inherit',
    });
  } catch (err: any) {
    if (err.message?.includes('not found') || err.exitCode === 127) {
      throw new Error(
        'Hyperframes CLI not found. Install it: npm install -g hyperframes\n' +
        'Requires Node 22+ and FFmpeg (install via: choco install ffmpeg  OR  winget install ffmpeg).'
      );
    }
    if (err.message?.includes('FFmpeg')) {
      throw new Error(
        'FFmpeg not found. Install it:\n' +
        '  Windows: choco install ffmpeg  OR  winget install ffmpeg\n' +
        'Then restart your terminal.'
      );
    }
    throw new Error(`Render failed: ${err.message ?? err}`);
  }

  console.log(`\n🎬 Render complete: ${outputPath}`);
}

/**
 * Stitch multiple MP4 segment files into one final video using FFmpeg.
 * Used for long-form news (10+ min) rendered in parallel segments.
 *
 * @param segmentPaths - Ordered list of segment .mp4 files
 * @param outputPath   - Final stitched output .mp4
 */
export async function stitchSegments(segmentPaths: string[], outputPath: string): Promise<void> {
  await ensureDir(path.dirname(outputPath));

  // Write FFmpeg concat list file
  const concatListPath = path.join(path.dirname(outputPath), '_concat.txt');
  const concatContent = segmentPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
  await writeFile(concatListPath, concatContent);

  console.log(`   Stitching ${segmentPaths.length} segments → ${outputPath}`);

  try {
    await execa('ffmpeg', [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      '-y',
      outputPath,
    ], { stdio: 'inherit' });
  } catch (err: any) {
    throw new Error(`FFmpeg stitch failed: ${err.message ?? err}`);
  }
}
