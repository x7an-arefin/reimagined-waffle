import { z } from 'zod';

export const PhotoSchema = z.object({
  src: z.string().describe('Local file path or URL to photo. Tool will handle downloading/copying.'),
  caption: z.string().optional(),
  alt: z.string(),
  credit: z.string().optional(),
});

export const NewsSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(5).max(200),
  lead: z.string().optional().describe('Short hook or summary paragraph'),
  body: z.array(z.string().min(1)).min(1).describe('Array of paragraphs or body sections'),
  photos: z.array(PhotoSchema).min(1).max(12),
  voice_script: z.string().optional().describe('Optional override for the full narration script'),
  style: z.enum(['breaking', 'feature', 'data', 'standard']).default('standard'),
  duration_hint_seconds: z.number().positive().optional(),
  metadata: z.object({
    author: z.string().optional(),
    date: z.string().optional(),
    source: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
});

export type News = z.infer<typeof NewsSchema>;
export type Photo = z.infer<typeof PhotoSchema>;

// Example usage in CLI: validate with NewsSchema.parse(json)
