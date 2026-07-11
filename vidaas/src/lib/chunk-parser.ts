import { z } from 'zod';

const ChunkSchema = z.object({
  id: z.string().min(1, 'Chunk ID cannot be empty'),
  prompt: z.string().min(1, 'PROMPT cannot be empty'),
  imagePrompt: z.string().min(1, 'IMAGE prompt cannot be empty'),
  videoPrompt: z.string().min(1, 'VIDEO prompt cannot be empty'),
});

export type ParsedChunk = z.infer<typeof ChunkSchema>;

// A delimiter is a line consisting ONLY of dashes: an em dash (—), en dash (–),
// or a markdown horizontal rule (--- or more). This avoids splitting on em
// dashes that appear *inline* within prose (e.g. "discovery—no camera movement").
const DELIMITER_LINE = /^\s*(?:—+|–+|-{3,})\s*$/;

function splitIntoSections(input: string): string[] {
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of input.split('\n')) {
    if (DELIMITER_LINE.test(line)) {
      if (current.some((l) => l.trim())) sections.push(current.join('\n'));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.some((l) => l.trim())) sections.push(current.join('\n'));
  return sections;
}

export function parseChunks(input: string): { chunks: ParsedChunk[]; errors: string[] } {
  const chunks: ParsedChunk[] = [];
  const errors: string[] = [];

  // Split on delimiter lines only (not inline dashes within a field's text).
  const sections = splitIntoSections(input);

  if (sections.length === 0) {
    errors.push('No chunks found. Separate chunks with a line containing only "—".');
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
        errors.push(`Chunk ${index + 1}: ${error.issues[0]?.message || 'Invalid format'}`);
      } else {
        errors.push(`Chunk ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  });

  return { chunks, errors };
}

// Field labels, matched case-insensitively at the start of a (markdown-cleaned)
// line, tolerating "LABEL:" or "LABEL :" with the value on the same line.
const FIELD_LABELS: Array<[RegExp, keyof ParsedChunk]> = [
  [/^id\s*:\s*/i, 'id'],
  [/^prompt\s*:\s*/i, 'prompt'],
  [/^image\s*:\s*/i, 'imagePrompt'],
  [/^video\s*:\s*/i, 'videoPrompt'],
];

// Strip markdown emphasis/heading/list markers so labels like "**IMAGE:**"
// or "- IMAGE:" are recognized. Applied per line before label detection.
function cleanLine(line: string): string {
  return line
    .replace(/\*\*/g, '') // bold
    .replace(/^\s*#+\s*/, '') // heading
    .replace(/^\s*[-*]\s+/, '') // list bullet
    .replace(/\*/g, '') // stray italics
    .trim();
}

function parseChunkSection(section: string): ParsedChunk {
  const lines = section.split('\n');
  const fields: Partial<ParsedChunk> = {};

  let currentField: keyof ParsedChunk | null = null;
  let currentValue = '';

  const flush = () => {
    if (currentField) fields[currentField] = currentValue.trim();
  };

  for (const raw of lines) {
    const line = cleanLine(raw);
    if (!line) continue;

    let matched = false;
    for (const [re, field] of FIELD_LABELS) {
      const m = line.match(re);
      if (m) {
        flush();
        currentField = field;
        currentValue = line.slice(m[0].length).trim();
        matched = true;
        break;
      }
    }

    if (!matched && currentField) {
      // Continuation of the current field's value.
      currentValue += ' ' + line;
    }
  }

  flush();

  return ChunkSchema.parse({
    id: fields.id || '',
    prompt: fields.prompt || '',
    imagePrompt: fields.imagePrompt || '',
    videoPrompt: fields.videoPrompt || '',
  });
}
