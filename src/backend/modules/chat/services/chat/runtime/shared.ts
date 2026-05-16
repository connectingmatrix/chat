import { getScopedLogger } from '@connectingmatrix/logger/lib/logger';

export const logger = getScopedLogger('ai-chat-service');

export function mergeUniqueIds(...values: Array<string | undefined | null>) {
  return Array.from(new Set(values.map((value) => (value || '').trim()).filter(Boolean)));
}

export const SUBJECT_WITH_TAGS_SELECT = `*,
  ai_subject_tags (
    ai_tags (
      id,
      name,
      slug
    )
  )`;

export const POST_WITH_ATTACHMENTS_SELECT = `*,
  ai_attachments (
    id,
    post_id,
    file_name,
    mime_type,
    storage_path,
    content_text,
    metadata,
    created_at,
    updated_at
  )`;
