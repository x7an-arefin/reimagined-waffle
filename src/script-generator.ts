import type { News } from './types/news.js';

/**
 * Generate a natural, professionally-paced narration script from news.json.
 *
 * Rules for good news narration:
 * - Hook immediately (title is the lede — don't repeat it robotically)
 * - Short sentences (15-20 words max). News audio is consumed fast.
 * - Pause markers (ellipsis) give Kokoro natural breathing room.
 * - Style-specific openings create the right tone.
 * - Closing CTA is brief and authoritative.
 *
 * Future enhancement: LLM pass for better flow, pronunciation fixes, emphasis marks.
 */
export function generateScript(news: News): string {
  const parts: string[] = [];

  // Style-specific hook / intro
  const styleIntros: Record<string, string> = {
    breaking: 'Breaking news.',
    feature:  '',  // features lead with the hook directly
    data:     'New data reveals',
    standard: '',
  };

  const intro = styleIntros[news.style] ?? '';
  if (intro) parts.push(intro);

  // Title as the opening line (the lede)
  const cleanTitle = normalizeForSpeech(news.title);
  parts.push(cleanTitle + '.');

  // Lead / hook paragraph (if present)
  if (news.lead) {
    parts.push(normalizeForSpeech(news.lead));
  }

  // Body paragraphs — split on sentence boundaries and join them with pauses
  news.body.forEach((para, i) => {
    const sentences = para.split(/(?<=[.!?])\s+/);
    const normalizedSentences = sentences.map(s => normalizeForSpeech(s));
    const joined = normalizedSentences.join(' ... ');
    // Add slight pause before each para after the first
    parts.push((i > 0 ? '... ' : '') + joined);
  });

  // Closing line
  const closings: Record<string, string> = {
    breaking: '... We will continue to update this story as more details emerge.',
    feature:  '... Stay with us for continued coverage.',
    data:     '... Full report available on our website.',
    standard: '... Stay informed with us.',
  };
  parts.push(closings[news.style] ?? closings.standard);

  return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Normalize text for natural Kokoro TTS output:
 * - Ensure sentences end with punctuation (period)
 * - Expand common abbreviations
 * - Remove markdown artifacts
 * - Normalize quotes and dashes
 */
function normalizeForSpeech(text: string): string {
  let s = text.trim();

  // Strip markdown artifacts
  s = s.replace(/\*\*(.*?)\*\*/g, '$1');
  s = s.replace(/\*(.*?)\*/g, '$1');
  s = s.replace(/`(.*?)`/g, '$1');
  s = s.replace(/#{1,6}\s/g, '');

  // Replace double dashes/colons/em dashes with ellipses for dramatic pauses in speech
  s = s.replace(/--/g, '... ');
  s = s.replace(/ — /g, '... ');
  s = s.replace(/ - /g, '... ');
  s = s.replace(/:/g, '... ');

  // Normalize quotes
  s = s.replace(/[""]/g, '"');
  s = s.replace(/['']/g, "'");

  // Expand common abbreviations for better TTS pronunciation
  s = s
    .replace(/\bDr\./g, 'Doctor')
    .replace(/\bMr\./g, 'Mister')
    .replace(/\bMrs\./g, 'Missus')
    .replace(/\bProf\./g, 'Professor')
    .replace(/\bGov\./g, 'Governor')
    .replace(/\bSen\./g, 'Senator')
    .replace(/\bRep\./g, 'Representative')
    .replace(/\bGen\./g, 'General')
    .replace(/\bCo\./g, 'Company')
    .replace(/\bCorp\./g, 'Corporation')
    .replace(/\bInc\./g, 'Incorporated')
    .replace(/\bLtd\./g, 'Limited')
    .replace(/\bvs\./gi, 'versus')
    .replace(/\betc\./gi, 'etcetera');

  // Numbers: expand common patterns for clearer narration
  s = s.replace(/(\d+)%/g, '$1 percent');
  s = s.replace(/\$(\d+(?:\.\d+)?)\s*B\b/g, '$$$1 billion');
  s = s.replace(/\$(\d+(?:\.\d+)?)\s*M\b/g, '$$$1 million');
  s = s.replace(/\$(\d+(?:\.\d+)?)\s*K\b/g, '$$$1 thousand');

  // Ensure sentence ends with punctuation
  if (!/[.!?]$/.test(s)) {
    s += '.';
  }

  return s;
}
