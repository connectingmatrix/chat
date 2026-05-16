export type ParsedSlashCommand = {
  raw: string;
  command: string;
  canonical: string;
  args: string[];
  quoted: string[];
  body: string;
};

const ALIASES: Record<string, string> = {
  '/worflow': '/workflow',
  '/workflows': '/workflow',
  '/tree': '/tree',
  '/Tree': '/tree',
  '/channel': '/channel',
  '/Channel': '/channel',
  '/categories': '/categories',
  '/Categories': '/categories',
  '/category': '/categories',
  '/chart': '/chart',
  '/Chart': '/chart',
};

export const isSlashCommandText = (value: unknown): boolean =>
  String(value ?? '')
    .trim()
    .startsWith('/');

export function parseSlashCommand(value: unknown): ParsedSlashCommand {
  const raw = String(value ?? '').trim();
  const quoted = Array.from(raw.matchAll(/"([^"]+)"|'([^']+)'/g), (match) => String(match[1] || match[2] || '').trim()).filter(Boolean);
  const parts = raw.split(/\s+/).filter(Boolean);
  const command = parts[0] || '';
  const canonicalCommand = ALIASES[command] || command.toLowerCase();
  const canonical = [canonicalCommand, ...parts.slice(1).map((part) => part.toLowerCase())].join(' ');
  const body = raw.slice(command.length).trim();
  return { raw, command, canonical, args: parts.slice(1), quoted, body };
}

export function stripCommandPrefix(raw: string, pattern: RegExp): string {
  return raw
    .replace(pattern, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
}
