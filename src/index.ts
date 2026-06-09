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

      // 5. Generate Hyperframes composition HTML
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
