import { ENTITY, FIELD, PERMISSIONS, Entity } from '@connectingmatrix/orm/orm';

export type AttachmentRow = {
  id: string;
  post_id: string;
  file_name?: string | null;
  mime_type?: string | null;
  storage_path?: string | null;
  content_text?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type StorageUploadData = { fullPath?: string | null; path?: string | null; id?: string | null };
type StorageUploadResponse = { data: StorageUploadData | null; error: Error | null };
type StorageRemoveResponse = { data: StorageUploadData[] | null; error: Error | null };
type StorageClient = {
  storage: {
    from: (bucket: string) => {
      upload: (path: string, body: Buffer | string, options: { contentType?: string; upsert?: boolean }) => Promise<StorageUploadResponse>;
      remove: (paths: string[]) => Promise<StorageRemoveResponse>;
    };
  };
};

@ENTITY({ table: 'ai_attachments', label: 'Attachment', store: 'supabase', primaryKey: 'id' })
@PERMISSIONS({ read: 'ATTACHMENT_READ', create: 'ATTACHMENT_CREATE', update: 'ATTACHMENT_UPDATE', delete: 'ATTACHMENT_DELETE' })
export class AttachmentEntity extends Entity<AttachmentRow> {
  @FIELD({ type: 'string', required: true, index: true }) public declare id: string | null;

  @FIELD({ type: 'string', required: true, index: true }) public declare post_id: string | null;

  @FIELD({ type: 'string' }) public declare file_name: string | null;

  @FIELD({ type: 'string' }) public declare mime_type: string | null;

  @FIELD({ type: 'string' }) public declare storage_path: string | null;

  @FIELD({ type: 'string' }) public declare content_text: string | null;

  @FIELD({ type: 'object', default: {} }) public declare metadata: Record<string, unknown> | null;

  @FIELD({ type: 'string' }) public declare created_at: string | null;

  @FIELD({ type: 'string' }) public declare updated_at: string | null;

  public static async uploadStorageObject(
    client: StorageClient,
    input: { bucket: string; path: string; body: Buffer | string; contentType?: string; upsert?: boolean },
  ): Promise<StorageUploadData | null> {
    const result = await client.storage.from(input.bucket).upload(input.path, input.body, {
      contentType: input.contentType || undefined,
      upsert: input.upsert === true,
    });
    if (result.error) throw result.error;
    return result.data;
  }

  public static async removeStorageObjects(client: StorageClient, input: { bucket: string; paths: string[] }): Promise<void> {
    const paths = input.paths.filter(Boolean);
    if (!paths.length) return;
    const result = await client.storage.from(input.bucket).remove(paths);
    if (result.error) throw result.error;
  }
}
