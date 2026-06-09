#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import fse from 'fs-extra';
import path from 'path';

const { mkdirpSync } = fse;
import { NewsSchema, type News } from './types/news.js';
import { generateScript } from './script-generator.js';
import { runHyperframesTTS, runHyperframesTranscribe } from './tts.js';
import { generateComposition } from './composition-generator.js';
import { renderVideo } from './renderer.js';
import { downloadAndProcessPhotos } from './image-processor.js';
import { downloadBackgroundMusic } from './music-search.js';
import { loadTranscript } from './transcript-sync.js';
import { getWavDuration } from './wav-parser.js';

const program = new Command();

program
  .name('news-hypervideo')
  .description('Generate professional news videos from news.json using Hyperframes, GSAP, and local TTS (Kokoro)')
  .version('0.1.0');

program
  .command('generate')
  .description('Generate a video from a news.json file')
  .argument('<news-json>', 'Path to news.json file')
  .option('-o, --output <path>', 'Output MP4 path or directory', './output')
  .option('--project-dir <dir>', 'Output full Hyperframes project dir for iteration', '')
  .option('--voice <voice>', 'Kokoro TTS voice (e.g. af_bella, am_michael, af_sky)', '')
  .option('--speed <speed>', 'TTS speed multiplier (default: style preset)', '')
  .option('--bg-music <music>', 'Background music: auto | none | <path_or_url>', 'auto')
  .option('--resolution <res>', 'Video resolution: 1080p | 720p | 4k | 9:16 | 1:1', '1080p')
  .option('--fps <fps>', 'Frames per second', '30')
  .option('--aspect <ratio>', 'Aspect ratio: 16:9 | 9:16 | 1:1', '16:9')
  .option('--style <style>', 'News style template override: breaking | feature | data | standard', '')
  .option('--preset <preset>', 'Render preset: fast | balanced | final', 'balanced')
  .option('--workers <n>', 'Number of render workers (1-8). Default: auto', 'auto')
  .option('--skip-tts', 'Reuse existing narration.wav (skip TTS generation)', false)
  .option('--preview', 'Open browser preview instead of rendering to MP4', false)
  .option('--no-render', 'Generate project but skip render step')
  .option('--gpu', 'Enable GPU-accelerated encoding (if supported)', false)
  .option('--segments <n>', 'Split composition into n segments for parallel rendering', '1')
  .action(async (newsJsonPath: string, options) => {
    console.log('\n🎬 news-hypervideo — Production News Video Generator');
    console.log('─'.repeat(55));

    try {
      // 1. Load and validate news.json
      if (!existsSync(newsJsonPath)) {
        throw new Error(`news.json not found: ${newsJsonPath}`);
      }
      const raw = readFileSync(newsJsonPath, 'utf-8');
      const news: News = NewsSchema.parse(JSON.parse(raw));
      console.log(`✅ Loaded: "${news.title}" [${news.style}] (ID: ${news.id})`);

      // Override style from CLI flag if provided
      if (options.style) {
        (news as any).style = options.style;
      }

      const style = (news.style || 'standard').toLowerCase();

      const defaultVoiceMap: Record<string, string> = {
        breaking: 'af_bella+af_sarah',
        feature: 'am_adam+am_michael',
        data: 'am_michael+am_adam',
        standard: 'af_bella+af_nicole',
      };

      const defaultSpeedMap: Record<string, number> = {
        breaking: 1.15,
        feature: 1.06,
        data: 1.00,
        standard: 1.10,
      };

      const voice = options.voice || defaultVoiceMap[style] || 'af_bella+af_nicole';
      const speed = options.speed ? parseFloat(options.speed) : (defaultSpeedMap[style] || 1.10);

      // Resolve output paths
      const outputDir = options.output.endsWith('.mp4')
        ? path.dirname(path.resolve(options.output))
        : path.resolve(options.output);
      mkdirpSync(outputDir);

      const projectDir = options.projectDir
        ? path.resolve(options.projectDir)
        : path.join(outputDir, `${news.id}-project`);
      mkdirpSync(projectDir);
      mkdirpSync(path.join(projectDir, 'assets'));
      mkdirpSync(path.join(projectDir, 'compositions'));

      const videoPath = options.output.endsWith('.mp4')
        ? path.resolve(options.output)
        : path.join(outputDir, `${news.id}.mp4`);

      // 2. Generate narration script
      const script = news.voice_script || generateScript(news);
      console.log(`📝 Narration script ready (${script.split(' ').length} words)`);

      const narrationPath = path.join(projectDir, 'assets', 'narration.wav');
      const scriptPath = path.join(projectDir, 'assets', 'script.md');
      const transcriptPath = path.join(projectDir, 'assets', 'transcript.json');

      // Write script.md for reference
      writeFileSync(scriptPath, `# Narration Script\n\n${script}\n`);

      // 3. TTS + Transcribe
      if (!options.skipTts || !existsSync(narrationPath)) {
        await runHyperframesTTS(script, narrationPath, voice, speed);
        console.log('🎙️  TTS complete — Kokoro narration generated');

        if (existsSync(narrationPath)) {
          await runHyperframesTranscribe(narrationPath, transcriptPath);
          console.log('📜 Transcript generated — word timestamps ready for sync');
        }
      } else {
        console.log('⏭️  Skipping TTS (--skip-tts) — reusing existing narration.wav');
      }

      // 4. Download / process photos
      console.log('🖼️  Processing photos...');
      const processedPhotos = await downloadAndProcessPhotos(news.photos, path.join(projectDir, 'assets'));

      // 4b. Background Music
      const bgMusicOption = options.bgMusic || 'auto';
      if (bgMusicOption.toLowerCase() !== 'none') {
        const bgMusicDest = path.join(projectDir, 'assets', 'bg-music.mp3');
        if (bgMusicOption.toLowerCase() === 'auto') {
          try {
            await downloadBackgroundMusic(style, bgMusicDest);
          } catch (err: any) {
            console.warn(`   ⚠️ Failed to download background music: ${err.message || err}. Continuing without bg-music.`);
          }
        } else {
          console.log(`🎵 Copying/downloading background music from: ${bgMusicOption}`);
          try {
            if (bgMusicOption.startsWith('http://') || bgMusicOption.startsWith('https://')) {
              const res = await fetch(bgMusicOption);
              if (!res.ok) throw new Error(`Status ${res.status}`);
              const buffer = Buffer.from(await res.arrayBuffer());
              writeFileSync(bgMusicDest, buffer);
              console.log(`   ✅ Music downloaded to assets/bg-music.mp3`);
            } else {
              if (existsSync(bgMusicOption)) {
                await fse.copy(bgMusicOption, bgMusicDest);
                console.log(`   ✅ Music copied to assets/bg-music.mp3`);
              } else {
                throw new Error(`Local file not found: ${bgMusicOption}`);
              }
            }
          } catch (err: any) {
            console.warn(`   ⚠️ Failed to copy/download background music: ${err.message || err}. Continuing without bg-music.`);
          }
        }
      } else {
        const bgMusicDest = path.join(projectDir, 'assets', 'bg-music.mp3');
        if (existsSync(bgMusicDest)) {
          await fse.remove(bgMusicDest);
        }
      }

      const segmentsCount = parseInt(options.segments || '1');

      if (segmentsCount <= 1) {
        // 5. Generate standard single Hyperframes composition HTML
        await generateComposition(news, script, narrationPath, transcriptPath, projectDir, processedPhotos, options);
        console.log(`📁 Project generated: ${projectDir}`);
        console.log('   → index.html (GSAP + Hyperframes data-attrs)');
        console.log('   → assets/ (narration.wav, transcript.json, photos)');

        // 6. Preview or Render
        if (options.preview) {
          console.log('\n🌐 Opening browser preview...');
          const { execa } = await import('execa');
          await execa('npx', ['hyperframes', 'preview'], { cwd: projectDir, stdio: 'inherit' });
        } else if (options.render !== false) {
          const presetMap: Record<string, { quality: string; workers: string }> = {
            fast:     { quality: 'draft',    workers: options.workers === 'auto' ? '4' : options.workers },
            balanced: { quality: 'standard', workers: options.workers === 'auto' ? '6' : options.workers },
            final:    { quality: 'high',     workers: options.workers === 'auto' ? '8' : options.workers },
          };
          const preset = presetMap[options.preset] ?? presetMap.balanced;

          console.log(`\n🎞️  Rendering video...`);
          console.log(`   Preset: ${options.preset} | Quality: ${preset.quality} | Workers: ${preset.workers} | FPS: ${options.fps}`);

          await renderVideo(projectDir, videoPath, {
            resolution: options.resolution,
            fps: parseInt(options.fps),
            quality: preset.quality,
            workers: preset.workers,
            gpu: options.gpu,
          });

          console.log(`\n✅ Done! Video: ${videoPath}`);
          console.log(`   Project: ${projectDir}`);
          console.log(`   Re-render anytime: cd "${projectDir}" && npx hyperframes render`);
        } else {
          console.log('\n✅ Project ready (--no-render). To render manually:');
          console.log(`   cd "${projectDir}" && npx hyperframes render --output "${videoPath}"`);
          console.log(`   Or preview: cd "${projectDir}" && npx hyperframes preview`);
        }
      } else {
        // 5. Segment Splitting Logic
        console.log(`\n✂️  Segmenting project into ${segmentsCount} parts...`);
        
        // Generate the parent project files first (for full assets and metadata)
        await generateComposition(news, script, narrationPath, transcriptPath, projectDir, processedPhotos, { ...options, isSegment: false });
        console.log(`📁 Parent project generated at: ${projectDir}`);

        const words = await loadTranscript(transcriptPath);
        const { alignBeatsToTranscript, getAudioDuration } = await import('./transcript-sync.js');
        
        const estimatedDuration = news.duration_hint_seconds ?? Math.max(35, script.split(' ').length / 2.5);
        let wavDuration = getWavDuration(narrationPath);
        if (wavDuration <= 0) {
          wavDuration = words.length > 0 ? getAudioDuration(words, estimatedDuration) : estimatedDuration;
        }

        const beats = words.length > 0
          ? alignBeatsToTranscript(words, news.body)
          : news.body.map((para, i) => {
              const contentDuration = wavDuration - 8.0 - 4.5;
              const segLen = contentDuration / news.body.length;
              const start  = 8.0 + i * segLen;
              return { beatIndex: i, text: para, start, end: start + segLen, duration: segLen };
            });

        const segmentSize = Math.ceil(beats.length / segmentsCount);
        const segmentPaths: string[] = [];
        const segmentDirs: string[] = [];
        const { execa } = await import('execa');

        const bgMusicPath = path.join(projectDir, 'assets', 'bg-music.mp3');

        for (let i = 0; i < segmentsCount; i++) {
          const segmentBeats = beats.slice(i * segmentSize, (i + 1) * segmentSize);
          if (segmentBeats.length === 0) continue;

          // Calculate start and end times for this segment
          const t_start = i === 0 ? 0 : segmentBeats[0].start;
          const t_end   = i === segmentsCount - 1 ? wavDuration : segmentBeats[segmentBeats.length - 1].end;
          const t_duration = t_end - t_start;

          const segProjectDir = `${projectDir}-seg${i}`;
          segmentDirs.push(segProjectDir);
          mkdirpSync(segProjectDir);
          mkdirpSync(path.join(segProjectDir, 'assets'));
          mkdirpSync(path.join(segProjectDir, 'compositions'));

          console.log(`   Segment ${i}: ${t_start.toFixed(1)}s → ${t_end.toFixed(1)}s (Duration: ${t_duration.toFixed(1)}s)`);

          // Slice narration WAV using FFmpeg
          const segNarrationPath = path.join(segProjectDir, 'assets', 'narration.wav');
          try {
            await execa('ffmpeg', [
              '-ss', String(t_start),
              '-to', String(t_end),
              '-i', narrationPath,
              '-c', 'copy',
              '-y',
              segNarrationPath
            ]);
          } catch (err: any) {
            throw new Error(`Failed to slice narration audio for segment ${i}: ${err.message}`);
          }

          // Slice and shift transcript words
          const segWords = words
            .filter(w => w.start >= t_start && w.end <= t_end)
            .map(w => ({
              text: w.text,
              start: w.start - t_start,
              end: w.end - t_start
            }));
          const segTranscriptPath = path.join(segProjectDir, 'assets', 'transcript.json');
          writeFileSync(segTranscriptPath, JSON.stringify({ words: segWords }, null, 2));

          // Partition photos
          const photosPerSeg = Math.ceil(processedPhotos.length / segmentsCount);
          let segPhotos = processedPhotos.slice(i * photosPerSeg, (i + 1) * photosPerSeg);
          if (segPhotos.length === 0 && processedPhotos.length > 0) {
            segPhotos = [processedPhotos[processedPhotos.length - 1]];
          }

          // Copy photos to segment assets
          for (const photo of segPhotos) {
            const destPhoto = path.join(segProjectDir, 'assets', photo.assetName);
            await fse.copy(path.join(projectDir, 'assets', photo.assetName), destPhoto);
          }

          // Copy background music if present
          const bgMusicDest = path.join(segProjectDir, 'assets', 'bg-music.mp3');
          if (existsSync(bgMusicPath)) {
            await fse.copy(bgMusicPath, bgMusicDest);
          }

          // Generate segment composition
          const segmentNews: News = {
            ...news,
            id: `${news.id}-seg${i}`,
            lead: i === 0 ? news.lead : undefined,
            body: segmentBeats.map(b => b.text),
            photos: segPhotos.map(p => ({ src: p.assetName, alt: p.alt, caption: p.caption, credit: p.credit })),
          };

          const segOptions = {
            ...options,
            isSegment: true,
            segmentIndex: i,
            totalSegments: segmentsCount
          };

          await generateComposition(
            segmentNews,
            segmentNews.body.join(' '),
            segNarrationPath,
            segTranscriptPath,
            segProjectDir,
            segPhotos,
            segOptions
          );

          segmentPaths.push(path.join(outputDir, `${news.id}-seg${i}.mp4`));
        }

        console.log(`✅ All ${segmentsCount} segments successfully generated!`);

        // 6. Preview or Render segments
        if (options.preview) {
          console.log('\n🌐 Opening browser preview for segment 0...');
          await execa('npx', ['hyperframes', 'preview'], { cwd: segmentDirs[0], stdio: 'inherit' });
        } else if (options.render !== false) {
          const presetMap: Record<string, { quality: string; workers: string }> = {
            fast:     { quality: 'draft',    workers: options.workers === 'auto' ? '4' : options.workers },
            balanced: { quality: 'standard', workers: options.workers === 'auto' ? '6' : options.workers },
            final:    { quality: 'high',     workers: options.workers === 'auto' ? '8' : options.workers },
          };
          const preset = presetMap[options.preset] ?? presetMap.balanced;

          console.log(`\n🎞️  Rendering ${segmentsCount} segments sequentially...`);
          for (let i = 0; i < segmentDirs.length; i++) {
            console.log(`🎬 Rendering Segment ${i + 1}/${segmentsCount}...`);
            await renderVideo(segmentDirs[i], segmentPaths[i], {
              resolution: options.resolution,
              fps: parseInt(options.fps),
              quality: preset.quality,
              workers: preset.workers,
              gpu: options.gpu,
            });
          }

          // Stitch segments together
          console.log(`\n🧵 Stitching segment files together...`);
          const { stitchSegments } = await import('./renderer.js');
          await stitchSegments(segmentPaths, videoPath);
          console.log(`\n✅ Done! Combined news video: ${videoPath}`);
        } else {
          console.log('\n✅ Segments ready (--no-render). Ready to be processed in CI parallel matrix.');
        }
      }

    } catch (error) {
      if (error instanceof Error) {
        console.error(`\n❌ Failed: ${error.message}`);
        if (error.message.includes('ZodError') || error.constructor.name === 'ZodError') {
          console.error('   Check your news.json matches the required schema.');
          console.error('   Run: news-hypervideo schema to see the schema.');
        }
      } else {
        console.error('\n❌ Unexpected error:', error);
      }
      process.exit(1);
    }
  });

// Schema helper command
program
  .command('schema')
  .description('Print the expected news.json schema')
  .action(() => {
    console.log(`
news.json schema (all fields):

{
  "id": "unique-id-string",               // required
  "title": "News headline (5-200 chars)", // required
  "lead": "Short hook paragraph",         // optional
  "body": ["Paragraph 1", "Para 2"],      // required, min 1 item
  "photos": [                             // required, 1-12 items
    {
      "src": "./path/to/photo.jpg",       // local path or https:// URL
      "alt": "Alt text description",      // required
      "caption": "Photo caption",         // optional
      "credit": "Photographer / Agency"   // optional
    }
  ],
  "voice_script": "Custom narration...", // optional — overrides auto-generated
  "style": "breaking|feature|data|standard", // default: "standard"
  "duration_hint_seconds": 60,           // optional hint for timing
  "metadata": {
    "author": "Staff Reporter",
    "date": "2026-06-09",
    "source": "Reuters",
    "tags": ["climate", "science"]
  }
}
`);
  });

program.parse();
