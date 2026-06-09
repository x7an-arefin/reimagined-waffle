import { writeFileSync, existsSync } from 'fs';
import fse from 'fs-extra';
const { ensureDirSync } = fse;
import path from 'path';

/**
 * Map news styles to search keywords for Archive.org / Free Music Archive.
 */
function getSearchKeyword(style: string): string {
  switch (style.toLowerCase()) {
    case 'breaking':
      return 'electronic beat techno';
    case 'feature':
      return 'ambient tension cinematic';
    case 'data':
      return 'minimal electronic downtempo';
    case 'standard':
    default:
      return 'acoustic instrumental corporate';
  }
}

interface ArchiveDoc {
  identifier: string;
  title?: string;
}

interface ArchiveSearchResponse {
  response?: {
    docs?: ArchiveDoc[];
    numFound?: number;
  };
}

interface ArchiveFile {
  name: string;
  format?: string;
}

interface ArchiveMetadataResponse {
  files?: ArchiveFile[];
}

/**
 * Searches Archive.org for a Creative Commons music track matching the style,
 * and downloads it to the target path.
 */
export async function downloadBackgroundMusic(style: string, outputPath: string): Promise<string> {
  const keyword = getSearchKeyword(style);
  console.log(`🔍 Searching Archive.org (Free Music Archive) for style '${style}' (keywords: '${keyword}')...`);
  
  // 1. Search FMA collection
  let query = `collection:(freemusicarchive) AND (${keyword}) AND format:(MP3)`;
  let searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&rows=20&output=json`;
  
  let docs: ArchiveDoc[] = [];
  try {
    const res = await fetch(searchUrl);
    if (res.ok) {
      const data = (await res.json()) as ArchiveSearchResponse;
      docs = data.response?.docs || [];
    }
  } catch (err: any) {
    console.warn(`   ⚠️ Archive.org search failed: ${err.message || err}. Trying fallback search...`);
  }
  
  // Fallback if no docs found
  if (docs.length === 0) {
    console.log(`   No tracks found for keywords. Trying generic instrumental fallback...`);
    query = `collection:(freemusicarchive) AND instrumental AND format:(MP3)`;
    searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&rows=20&output=json`;
    try {
      const res = await fetch(searchUrl);
      if (res.ok) {
        const data = (await res.json()) as ArchiveSearchResponse;
        docs = data.response?.docs || [];
      }
    } catch (err: any) {
      console.warn(`   ⚠️ Fallback search failed: ${err.message || err}`);
    }
  }
  
  if (docs.length === 0) {
    throw new Error('Could not find any suitable tracks on Archive.org.');
  }
  
  // 2. Choose a random track from the results
  const chosenDoc = docs[Math.floor(Math.random() * docs.length)];
  console.log(`   Found track: "${chosenDoc.title || 'Untitled'}" (ID: ${chosenDoc.identifier})`);
  
  // 3. Fetch files list for the chosen identifier
  const metadataUrl = `https://archive.org/metadata/${chosenDoc.identifier}`;
  const metaRes = await fetch(metadataUrl);
  if (!metaRes.ok) {
    throw new Error(`Failed to fetch metadata for item ${chosenDoc.identifier}: ${metaRes.statusText}`);
  }
  
  const metaData = (await metaRes.json()) as ArchiveMetadataResponse;
  const files = metaData.files || [];
  
  // Look for MP3 files (format is usually VBR MP3 or MP3)
  const mp3File = files.find(f => 
    f.name.toLowerCase().endsWith('.mp3') && 
    (f.format?.toUpperCase().includes('MP3') || !f.format)
  );
  
  if (!mp3File) {
    throw new Error(`No MP3 file found in Archive.org metadata for identifier ${chosenDoc.identifier}`);
  }
  
  const fileName = mp3File.name;
  console.log(`   Selected MP3 file: "${fileName}"`);
  
  // 4. Download the MP3
  const downloadUrl = `https://archive.org/download/${chosenDoc.identifier}/${encodeURIComponent(fileName)}`;
  console.log(`   Downloading background track...`);
  
  ensureDirSync(path.dirname(outputPath));
  
  const dlRes = await fetch(downloadUrl);
  if (!dlRes.ok) {
    throw new Error(`Failed to download MP3 from ${downloadUrl}: ${dlRes.statusText}`);
  }
  
  const arrayBuffer = await dlRes.arrayBuffer();
  writeFileSync(outputPath, Buffer.from(arrayBuffer));
  console.log(`   ✅ Background music saved to: ${outputPath}`);
  
  return outputPath;
}
