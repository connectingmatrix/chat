import { ENTITY, FIELD, PERMISSIONS, Entity } from '@connectingmatrix/orm/orm';

export type ChatShareRow = {
  chat_id: string;
  share_token: string;
  snapshot: Record<string, unknown>;
  published_at: string;
  revoked_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

@ENTITY({ table: 'ai_chat_shares', label: 'ChatShare', store: 'supabase', primaryKey: ['chat_id', 'share_token'] })
@PERMISSIONS({ read: 'CHAT_SHARE_READ', create: 'CHAT_SHARE_CREATE', update: 'CHAT_SHARE_UPDATE', delete: 'CHAT_SHARE_DELETE' })
export class ChatShareEntity extends Entity<ChatShareRow> {
  @FIELD({ type: 'string', required: true, index: true }) public declare chat_id: string | null;

  @FIELD({ type: 'string', required: true, index: true, unique: true }) public declare share_token: string | null;

  @FIELD({ type: 'object', required: true }) public declare snapshot: Record<string, unknown> | null;

  @FIELD({ type: 'string', required: true }) public declare published_at: string | null;

  @FIELD({ type: 'string' }) public declare revoked_at: string | null;

  @FIELD({ type: 'string' }) public declare created_at: string | null;

  @FIELD({ type: 'string' }) public declare updated_at: string | null;

  public static async loadByChatId(chatId: string): Promise<ChatShareEntity | null> {
    return this.find({ chat_id: chatId }).single();
  }

  public static async loadPublicByToken(token: string): Promise<ChatShareEntity | null> {
    const share = await this.find({ share_token: token }).single();
    return share?.revoked_at ? null : share;
  }

  public static async publish(input: { chatId: string; token: string; snapshot: Record<string, unknown> }): Promise<ChatShareEntity> {
    const now = new Date().toISOString();
    const existing = await this.loadByChatId(input.chatId);
    if (existing) {
      return existing.update({
        share_token: input.token,
        snapshot: input.snapshot,
        revoked_at: null,
        published_at: now,
        updated_at: now,
      });
    }
    return this.create({
      chat_id: input.chatId,
      share_token: input.token,
      snapshot: input.snapshot,
      published_at: now,
      revoked_at: null,
      created_at: now,
      updated_at: now,
    });
  }

  public static async revoke(chatId: string): Promise<void> {
    const share = await this.loadByChatId(chatId);
    if (share) await share.update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }

  public static async loadByChatIdScoped(supabase: any, chatId: string) {
    const module = await import('@connectingmatrix/chat/services/chat/runtime/share');
    return module.loadChatShareByChatId(supabase, chatId);
  }

  public static async loadPublicByTokenScoped(supabase: any, token: string) {
    const module = await import('@connectingmatrix/chat/services/chat/runtime/share');
    return module.loadPublicChatShareByToken(supabase, token);
  }

  public static async publishByChatId(supabase: any, chatId: string) {
    const module = await import('@connectingmatrix/chat/services/chat/runtime/share');
    return module.publishChatShare(supabase, chatId);
  }

  public static async revokeByChatIdScoped(supabase: any, chatId: string) {
    const module = await import('@connectingmatrix/chat/services/chat/runtime/share');
    return module.revokeChatShare(supabase, chatId);
  }

  public static async upsertByChatId(input: { chatId: string; token: string; snapshot: Record<string, unknown> }): Promise<ChatShareEntity> {
    return this.publish(input);
  }

  public static async revokeByChatId(chatId: string): Promise<void> {
    await this.revoke(chatId);
  }

  public static async readActiveByChatId(chatId: string): Promise<ChatShareEntity | null> {
    const share = await this.loadByChatId(chatId);
    return share?.revoked_at ? null : share;
  }

  public static async readActiveByToken(token: string): Promise<ChatShareEntity | null> {
    return this.loadPublicByToken(token);
  }
}
