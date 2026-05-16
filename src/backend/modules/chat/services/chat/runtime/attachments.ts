import { BadRequestError } from 'routing-controllers';
import type { ChatQueryAttachmentInput } from '@giga/shared/types/contracts/chat.types';

export type ProcessedChatAttachmentKind = 'image' | 'document' | 'tabular' | 'archive' | 'database' | 'code' | 'unknown';

export type ProcessedChatAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  kind: ProcessedChatAttachmentKind;
  drivePath: string | null;
  sourceUrl: string | null;
  hasInlineContent: boolean;
  metadata: Record<string, unknown>;
  previewLabel: string;
  processingAgent: 'image-processing-agent' | 'document-processing-agent' | 'tabular-processing-agent' | 'archive-processing-agent' | 'database-processing-agent' | 'code-context-agent';
};

const MAX_INLINE_BYTES = Number(process.env.CHAT_ATTACHMENT_INLINE_BYTES || 8 * 1024 * 1024);
const MAX_ATTACHMENTS = Number(process.env.CHAT_ATTACHMENT_MAX_FILES || 12);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tiff']);
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'txt', 'md', 'markdown', 'doc', 'docx', 'rtf']);
const TABULAR_EXTENSIONS = new Set(['csv', 'tsv', 'xls', 'xlsx', 'jsonl', 'parquet']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', '7z']);
const DATABASE_EXTENSIONS = new Set(['sqlite', 'sqlite3', 'db', 'duckdb', 'kuzu', 'json']);
const CODE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'kt', 'cs', 'php', 'rb', 'sql', 'graphql', 'yaml', 'yml', 'json', 'html', 'css', 'scss']);

const ALLOWED_MIME_PREFIXES = ['image/', 'text/'];
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/json',
  'application/jsonl',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream',
  'application/x-sqlite3',
  'application/vnd.duckdb',
  'application/x-yaml',
]);

const text = (value: unknown): string => String(value || '').trim();
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const sanitizeName = (value: unknown) => text(value).replace(/[\\/\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 180) || 'attachment';
const extensionOf = (fileName: string) => fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : '';
const decodedSize = (base64: string): number => Math.floor((base64.replace(/^data:[^;]+;base64,/, '').length * 3) / 4);

const kindFor = (extension: string, mimeType: string): ProcessedChatAttachmentKind => {
  if (mimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (TABULAR_EXTENSIONS.has(extension)) return 'tabular';
  if (DATABASE_EXTENSIONS.has(extension)) return 'database';
  if (ARCHIVE_EXTENSIONS.has(extension)) return 'archive';
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document';
  if (CODE_EXTENSIONS.has(extension)) return 'code';
  return 'unknown';
};

const agentFor = (kind: ProcessedChatAttachmentKind): ProcessedChatAttachment['processingAgent'] => {
  if (kind === 'image') return 'image-processing-agent';
  if (kind === 'tabular') return 'tabular-processing-agent';
  if (kind === 'archive') return 'archive-processing-agent';
  if (kind === 'database') return 'database-processing-agent';
  if (kind === 'code') return 'code-context-agent';
  return 'document-processing-agent';
};

const mimeAllowed = (mimeType: string, extension: string) => {
  if (!mimeType) return Boolean(extension);
  if (ALLOWED_MIME_TYPES.has(mimeType)) return true;
  return ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
};

export const isRuntimeSelectorAttachment = (attachment: ChatQueryAttachmentInput): boolean => {
  const direct = attachment as Record<string, unknown>;
  const meta = record(attachment.metadata);
  const kind = text(direct.kind || direct.type || meta.kind || meta.type).toLowerCase();
  return Boolean(
    kind === 'agent' ||
      kind === 'workflow' ||
      direct.agentId ||
      direct.agent_id ||
      meta.agentId ||
      meta.agent_id ||
      direct.workflowId ||
      direct.workflow_id ||
      meta.workflowId ||
      meta.workflow_id,
  );
};

export const normalizeChatFileAttachments = (attachments: ChatQueryAttachmentInput[]): ChatQueryAttachmentInput[] =>
  attachments.filter((attachment) => !isRuntimeSelectorAttachment(attachment));

export const processChatAttachments = (params: {
  attachments: ChatQueryAttachmentInput[];
  chatId: string;
  mode: string;
  userId: string;
  emit?: (stage: string, status: 'started' | 'progress' | 'completed' | 'failed', message: string, meta?: Record<string, unknown>, chatId?: string | null) => void;
}): ProcessedChatAttachment[] => {
  if (params.attachments.length > MAX_ATTACHMENTS) throw new BadRequestError(`Chat messages support at most ${MAX_ATTACHMENTS} attachments.`);
  return params.attachments.map((attachment, index) => {
    const metadata = record(attachment.metadata);
    const fileName = sanitizeName(attachment.file_name || metadata.fileName || metadata.name || `attachment-${index + 1}`);
    const mimeType = text(attachment.mime_type || metadata.mimeType || metadata.type).toLowerCase();
    const extension = extensionOf(fileName);
    const inlineContent = text(attachment.content_base64);
    const sizeBytes = Number(metadata.sizeBytes || metadata.size || (inlineContent ? decodedSize(inlineContent) : 0));
    const kind = kindFor(extension, mimeType);
    if (!mimeAllowed(mimeType, extension)) throw new BadRequestError(`Attachment ${fileName} uses unsupported type ${mimeType || extension || 'unknown'}.`);
    if (inlineContent && sizeBytes > MAX_INLINE_BYTES) throw new BadRequestError(`Attachment ${fileName} exceeds inline upload limit.`);
    if (kind === 'unknown') throw new BadRequestError(`Attachment ${fileName} is not ingestionable for chat.`);
    const processingAgent = agentFor(kind);
    const processed: ProcessedChatAttachment = {
      id: text(metadata.id || metadata.attachmentId || `${params.chatId}-attachment-${index + 1}`),
      fileName,
      mimeType: mimeType || 'application/octet-stream',
      extension,
      sizeBytes,
      kind,
      drivePath: text(attachment.drive_path || metadata.drivePath) || null,
      sourceUrl: text(attachment.source_url || metadata.sourceUrl) || null,
      hasInlineContent: Boolean(inlineContent),
      metadata,
      previewLabel: `${kind.toUpperCase()} · ${fileName}${sizeBytes ? ` · ${Math.ceil(sizeBytes / 1024)} KB` : ''}`,
      processingAgent,
    };
    params.emit?.(
      `chat.attachments.${kind}`,
      'progress',
      kind === 'image' ? 'Image attachment routed to image-processing-agent.' : `Attachment routed to ${processingAgent}.`,
      {
        attachment_id: processed.id,
        file_name: processed.fileName,
        kind: processed.kind,
        mime_type: processed.mimeType,
        processing_agent: processed.processingAgent,
        mode: params.mode,
      },
      params.chatId,
    );
    return processed;
  });
};

export const chatAttachmentContextMarkdown = (attachments: ProcessedChatAttachment[]): string => {
  if (!attachments.length) return '';
  const rows = attachments.map((attachment, index) =>
    `${index + 1}. ${attachment.fileName} (${attachment.kind}, ${attachment.mimeType}, ${attachment.processingAgent})`,
  );
  return ['\n\n### Attached files processed for this message', ...rows].join('\n');
};

export const appendChatAttachmentContext = (message: string, attachments: ProcessedChatAttachment[]): string =>
  attachments.length ? `${message}${chatAttachmentContextMarkdown(attachments)}` : message;
