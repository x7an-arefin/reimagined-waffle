import { readFileSync, existsSync } from 'fs';

/**
 * Scan a PCM WAV file header and retrieve its exact duration in seconds.
 */
export function getWavDuration(filePath: string): number {
  try {
    if (!existsSync(filePath)) {
      console.warn(`WAV file not found for duration check: ${filePath}`);
      return 0;
    }
    const buffer = readFileSync(filePath);
    if (buffer.length < 44) return 0;
    
    const format = buffer.toString('ascii', 8, 12);
    if (format !== 'WAVE') return 0;
    
    const byteRate = buffer.readUInt32LE(28);
    if (byteRate === 0) return 0;
    
    // Walk subchunks to locate the "data" subchunk
    let offset = 12;
    while (offset < buffer.length - 8) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      if (chunkId === 'data') {
        return chunkSize / byteRate;
      }
      // Advance by subchunk header (8 bytes) + chunk size
      offset += 8 + chunkSize;
    }
  } catch (e) {
    console.error('Failed to parse WAV duration:', e);
  }
  return 0;
}

/**
 * Merge multiple WAV buffers into a single continuous WAV buffer.
 * Assumes all input buffers have identical format (sample rate, bit depth, channels).
 */
export function mergeWavBuffers(wavBuffers: Buffer[]): Buffer {
  if (wavBuffers.length === 0) return Buffer.alloc(0);
  if (wavBuffers.length === 1) return wavBuffers[0];

  const first = wavBuffers[0];
  
  // Find format chunk details
  let fmtOffset = 12;
  let fmtSize = 16;
  while (fmtOffset < first.length - 8) {
    const chunkId = first.toString('ascii', fmtOffset, fmtOffset + 4);
    const chunkSize = first.readUInt32LE(fmtOffset + 4);
    if (chunkId === 'fmt ') {
      fmtSize = chunkSize;
      break;
    }
    fmtOffset += 8 + chunkSize;
  }
  
  const fmtHeader = first.subarray(fmtOffset, fmtOffset + 8 + fmtSize);

  // Extract raw PCM bytes from all buffers
  const pcmBuffers: Buffer[] = [];
  let totalDataSize = 0;
  
  for (const buf of wavBuffers) {
    let offset = 12;
    while (offset < buf.length - 8) {
      const chunkId = buf.toString('ascii', offset, offset + 4);
      const chunkSize = buf.readUInt32LE(offset + 4);
      if (chunkId === 'data') {
        // Extract raw PCM data subchunk
        const pcm = buf.subarray(offset + 8, offset + 8 + chunkSize);
        pcmBuffers.push(pcm);
        totalDataSize += pcm.length;
        break;
      }
      offset += 8 + chunkSize;
    }
  }

  // Build the new WAV header
  const headerSize = 12 + (8 + fmtSize) + 8; // RIFF + fmt chunk + data chunk header
  const header = Buffer.alloc(headerSize);
  
  // Write "RIFF" and size
  header.write('RIFF', 0);
  header.writeUInt32LE(headerSize + totalDataSize - 8, 4);
  header.write('WAVE', 8);
  
  // Copy format chunk
  fmtHeader.copy(header, 12);
  
  // Write "data" chunk header and total data size
  const dataOffset = 12 + 8 + fmtSize;
  header.write('data', dataOffset);
  header.writeUInt32LE(totalDataSize, dataOffset + 4);

  return Buffer.concat([header, ...pcmBuffers]);
}
