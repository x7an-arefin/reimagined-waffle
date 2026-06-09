import { execa } from 'execa';
import fse from 'fs-extra';
import path from 'path';

const { writeFile, ensureFile, pathExists } = fse;
import { mergeWavBuffers } from './wav-parser.js';

/**
 * Run Hyperframes TTS using Kokoro (local, fully offline).
 * Produces a high-quality narration WAV from the news script.
 *
 * Kokoro: 82M param neural TTS, MOS ~4.5, 54 voices, 9 languages.
 * First run: auto-downloads the model (~300MB). Subsequent runs are fast.
 *
 * @param script  - Full narration text
 * @param outputPath - Destination .wav path
 * @param voice  - Kokoro voice name (e.g. af_bella, am_michael, af_sky)
 */
export async function runHyperframesTTS(
  script: string,
  outputPath: string,
  voice: string = 'af_bella',
  speed: number = 1.0
): Promise<void> {
  // Write script to .md file (Hyperframes tts expects a text/md file)
  const scriptPath = path.join(path.dirname(outputPath), 'script.md');
  await writeFile(scriptPath, script, 'utf-8');

  console.log(`   Voice: ${voice}`);
  console.log(`   Speed: ${speed}`);
  console.log(`   Script: ${script.split(' ').length} words → ${scriptPath}`);
  console.log(`   Output: ${outputPath}`);

  // Try calling the running Kokoro server first
  const serverUrl = process.env.KOKORO_SERVER_URL || 'http://localhost:8880/tts';
  console.log(`   Attempting to fetch TTS from server at ${serverUrl}...`);
  try {
    // Split text into sentences/pauses to prevent request timeout on long scripts
    const sentences = script.split(/(?<=[.!?])\s+|(?<=\.\.\.)\s+/).filter(s => s.trim().length > 0);
    const chunks: string[] = [];
    let currentChunk = '';
    
    for (const sentence of sentences) {
      if ((currentChunk + ' ' + sentence).trim().split(/\s+/).length > 80) {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk = currentChunk ? currentChunk + ' ' + sentence : sentence;
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim());

    const wavBuffers: Buffer[] = [];
    console.log(`   Processing TTS in ${chunks.length} chunk(s) to prevent timeouts...`);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      console.log(`     Synthesizing chunk ${i + 1}/${chunks.length} (${chunkText.split(' ').length} words)...`);
      
      const res = await fetch(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunkText, voice, speed })
      });
      
      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }
      
      const data = (await res.json()) as { audio_b64?: string };
      if (!data.audio_b64) {
        throw new Error(`Response missing audio_b64`);
      }
      
      wavBuffers.push(Buffer.from(data.audio_b64, 'base64'));
    }
    
    const finalBuffer = mergeWavBuffers(wavBuffers);
    await writeFile(outputPath, finalBuffer);
    console.log(`   ✅ TTS generated successfully via local server (merged ${chunks.length} chunks).`);
    return;
  } catch (err: any) {
    console.warn(`   ⚠️  Could not connect/generate via local Kokoro server (${err.message ?? err}). Falling back to CLI...`);
  }

  // Fallback to local CLI (First run downloads Kokoro model ~300MB)
  console.log('   (Running via Hyperframes CLI. First run downloads Kokoro model ~300MB — subsequent runs are instant)');
  try {
    await execa('npx', [
      'hyperframes', 'tts',
      scriptPath,
      '--voice', voice,
      '--speed', String(speed),
      '--output', outputPath,
    ], { stdio: 'inherit' });
  } catch (err: any) {
    // Friendly error for common cases
    if (err.message?.includes('not found') || err.exitCode === 127) {
      throw new Error(
        'Hyperframes CLI not found. Install it: npm install -g hyperframes\n' +
        'Or ensure npx can access it. Requires Node 22+.'
      );
    }
    throw new Error(`TTS failed: ${err.message ?? err}`);
  }
}

/**
 * Run Hyperframes transcribe to get word-level timestamps.
 * Produces transcript.json with { words: [{text, start, end}] } format.
 *
 * @param narrationPath - Path to the narration .wav file
 * @param transcriptOutputPath - Where to write transcript.json
 */
export async function runHyperframesTranscribe(
  narrationPath: string,
  transcriptOutputPath: string
): Promise<void> {
  if (!(await pathExists(narrationPath))) {
    console.warn(`   ⚠️  narration.wav not found at ${narrationPath} — skipping transcribe`);
    return;
  }

  console.log(`   Transcribing: ${narrationPath}`);

  try {
    // Hyperframes transcribe writes transcript.json next to the wav by default.
    // We pass --output flag to control placement.
    await execa('npx', [
      'hyperframes', 'transcribe',
      narrationPath,
      '--output', transcriptOutputPath,
    ], { stdio: 'inherit' });
  } catch (err: any) {
    // Transcribe failure is non-fatal — we fall back to estimated timings
    console.warn(`   ⚠️  Transcribe failed (${err.message ?? err})`);
    console.warn('   Falling back to estimated timings. Word-sync will be approximate.');
    // Write empty transcript so downstream code doesn't crash
    await ensureFile(transcriptOutputPath);
    await writeFile(transcriptOutputPath, JSON.stringify({ words: [] }, null, 2));
  }
}
