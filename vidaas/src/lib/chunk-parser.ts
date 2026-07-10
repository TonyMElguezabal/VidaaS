import { z } from 'zod';

const ChunkSchema = z.object({
  id: z.string().min(1, 'Chunk ID cannot be empty'),
  prompt: z.string().min(1, 'PROMPT cannot be empty'),
  imagePrompt: z.string().min(1, 'IMAGE prompt cannot be empty'),
  videoPrompt: z.string().min(1, 'VIDEO prompt cannot be empty'),
});

export type ParsedChunk = z.infer<typeof ChunkSchema>;

export function parseChunks(input: string): { chunks: ParsedChunk[]; errors: string[] } {
  const chunks: ParsedChunk[] = [];
  const errors: string[] = [];
  const delimiter = '—';

  // Split by delimiter and filter empty sections
  const sections = input.split(delimiter).filter((s) => s.trim());

  if (sections.length === 0) {
    errors.push('No chunks found. Use "—" to separate chunks.');
    return { chunks, errors };
  }

  const seenIds = new Set<string>();

  sections.forEach((section, index) => {
    try {
      const chunk = parseChunkSection(section.trim());

      // Check for duplicate IDs
      if (seenIds.has(chunk.id)) {
        errors.push(`Chunk ${index + 1}: Duplicate ID "${chunk.id}"`);
        return;
      }

      seenIds.add(chunk.id);
      chunks.push(chunk);
    } catch (error) {
      if (error instanceof z.ZodError) {
        errors.push(`Chunk ${index + 1}: ${error.errors[0]?.message || 'Invalid format'}`);
      } else {
        errors.push(`Chunk ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  });

  return { chunks, errors };
}

function parseChunkSection(section: string): ParsedChunk {
  const lines = section.split('\n').map((line) => line.trim());
  const fields: Partial<ParsedChunk> = {};

  let currentField: keyof ParsedChunk | null = null;
  let currentValue = '';

  for (const line of lines) {
    if (line.startsWith('ID:')) {
      if (currentField) {
        fields[currentField] = currentValue.trim();
      }
      currentField = 'id';
      currentValue = line.replace('ID:', '').trim();
    } else if (line.startsWith('PROMPT:')) {
      if (currentField) {
        fields[currentField] = currentValue.trim();
      }
      currentField = 'prompt';
      currentValue = line.replace('PROMPT:', '').trim();
    } else if (line.startsWith('IMAGE:')) {
      if (currentField) {
        fields[currentField] = currentValue.trim();
      }
      currentField = 'imagePrompt';
      currentValue = line.replace('IMAGE:', '').trim();
    } else if (line.startsWith('VIDEO:')) {
      if (currentField) {
        fields[currentField] = currentValue.trim();
      }
      currentField = 'videoPrompt';
      currentValue = line.replace('VIDEO:', '').trim();
    } else if (line && currentField) {
      // Continue accumulating value for current field
      currentValue += ' ' + line;
    }
  }

  // Store the last field
  if (currentField) {
    fields[currentField] = currentValue.trim();
  }

  return ChunkSchema.parse({
    id: fields.id || '',
    prompt: fields.prompt || '',
    imagePrompt: fields.imagePrompt || '',
    videoPrompt: fields.videoPrompt || '',
  });
}
