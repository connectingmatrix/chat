import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

export type GigaKnowledgeChunk = {
  id: string;
  path: string;
  title: string;
  text: string;
  score: number;
};

const KNOWLEDGE_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const MAX_FILE_BYTES = 2_000_000;
const DEFAULT_CHUNK_CHARS = 2_800;
const DEFAULT_MAX_CHUNKS = 8;

const keywordPattern =
  /\b(giga|knowledge|workflow|agent|chat|mcp|graphql|backend|node rules?|nodes?|channel|category|subject|post|shared space|chart|map)\b/i;
const cache = new Map<string, GigaKnowledgeChunk[]>();

const text = (value: unknown) => String(value || '').trim();

function roots() {
  return [
    join(process.cwd(), 'KNOWLEDGE.md'),
    join(process.cwd(), 'GIGA_KNOWLEDGE.md'),
    join(process.cwd(), 'docs'),
    join(process.cwd(), 'context'),
    join(process.cwd(), 'packages/apps/chat/src/services/chat'),
    join(process.cwd(), 'packages/apps/permissions/src/manifest'),
    join(process.cwd(), 'packages/apps/plan-policy/src/manifest'),
  ];
}

function walk(path: string, files: string[] = []) {
  if (!existsSync(path)) return files;
  const stat = statSync(path);
  if (stat.isFile()) {
    if (KNOWLEDGE_EXTENSIONS.has(extname(path).toLowerCase()) && stat.size <= MAX_FILE_BYTES) files.push(path);
    return files;
  }
  if (!stat.isDirectory()) return files;
  for (const entry of readdirSync(path)) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist' || entry === 'cache') continue;
    walk(join(path, entry), files);
  }
  return files;
}

function splitSections(path: string, content: string): GigaKnowledgeChunk[] {
  const title = path.split(/[\\/]/g).pop() || path;
  const parts = content
    .replace(/\r\n/g, '\n')
    .split(/\n(?=#{1,3}\s+)/g)
    .map((part) => part.trim())
    .filter(Boolean);
  const raw = parts.length ? parts : [content.trim()];
  const chunks: GigaKnowledgeChunk[] = [];
  for (const [sectionIndex, section] of raw.entries()) {
    for (let offset = 0; offset < section.length; offset += DEFAULT_CHUNK_CHARS) {
      const slice = section.slice(offset, offset + DEFAULT_CHUNK_CHARS).trim();
      if (!slice) continue;
      const heading = slice.match(/^#{1,3}\s+(.+)$/m)?.[1] || title;
      chunks.push({ id: `${path}:${sectionIndex}:${offset}`, path, title: heading, text: slice, score: 0 });
    }
  }
  return chunks;
}

function loadAll(): GigaKnowledgeChunk[] {
  const key = process.cwd();
  const cached = cache.get(key);
  if (cached) return cached;
  const chunks: GigaKnowledgeChunk[] = [];
  for (const root of roots()) {
    for (const file of walk(root)) {
      try {
        chunks.push(...splitSections(file, readFileSync(file, 'utf8')));
      } catch (_error) {
        // Knowledge files are optional; unreadable files should not break chat.
      }
    }
  }
  cache.set(key, chunks);
  return chunks;
}

function terms(message: string) {
  return Array.from(
    new Set(
      message
        .toLowerCase()
        .replace(/[^a-z0-9\s_-]+/g, ' ')
        .split(/\s+/g)
        .filter((term) => term.length > 2),
    ),
  );
}

function score(chunk: GigaKnowledgeChunk, searchTerms: string[]) {
  const haystack = `${chunk.title}\n${chunk.path}\n${chunk.text}`.toLowerCase();
  let value = 0;
  for (const term of searchTerms) if (haystack.includes(term)) value += term.length > 5 ? 3 : 1;
  if (/\bgiga\b/.test(haystack)) value += 2;
  if (/\bnode rules?\b|\bworkflow\b|\bmcp\b|\bgraphql\b/.test(haystack)) value += 1;
  return value;
}

export function readGigaKnowledgeForMessage(message: string, options: { maxChunks?: number } = {}): GigaKnowledgeChunk[] {
  const query = text(message);
  if (!query || !keywordPattern.test(query)) return [];
  const searchTerms = terms(query);
  const maxChunks = Math.max(1, options.maxChunks || DEFAULT_MAX_CHUNKS);
  return loadAll()
    .map((chunk) => ({ ...chunk, score: score(chunk, searchTerms) }))
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score || left.text.length - right.text.length)
    .slice(0, maxChunks);
}

export function formatKnowledgeChunks(chunks: GigaKnowledgeChunk[]) {
  if (!chunks.length) return '';
  return chunks
    .map((chunk, index) => [`[Giga knowledge ${index + 1}]`, `Title: ${chunk.title}`, `Path: ${chunk.path}`, chunk.text].join('\n'))
    .join('\n\n---\n\n');
}
