import { SupabaseClient } from '@giga/general/decorators/integration/supabase-client';
import { GigaORM } from '@connectingmatrix/orm/orm';
import { ensureEntityOrmInstalled } from '@connectingmatrix/orm/services/graphql/entity-request-context';
import { queryChat } from '@connectingmatrix/chat/services/chat/read/query-chat';
import { chatGraphql, LiveSession } from './chat-giga-live.fixture';
import { CreatedIds } from './chat-giga-live.ids';
import { CHAT_CONFIRM, TREE_QUERY } from './chat-giga-live.queries';

function requestContext(session: LiveSession) {
  return {
    body: null,
    headers: { authorization: `Bearer ${session.sessionHeader}` },
    method: '',
    path: '',
    protocol: 'http',
    query: {},
    routeType: '',
    userId: session.userId,
  };
}

function sessionSupabase(session: LiveSession) {
  return SupabaseClient(requestContext(session) as any);
}

const CASE_TIMEOUT_MS = Number(process.env.CHAT_PARITY_CASE_TIMEOUT_MS || 180000);
let ormReady: Promise<void> | null = null;
const ensureOrmReady = () => {
  ormReady = ormReady || ensureEntityOrmInstalled();
  return ormReady;
};
const withTimeout = async <T>(promise: Promise<T>, label: string, timeoutMs = CASE_TIMEOUT_MS): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export async function readUserTree(session: LiveSession) {
  const result = await chatGraphql<{ aiFetchUserTree: { global: unknown[]; organization: unknown[]; user: unknown[] } }>(session, TREE_QUERY, {
    input: { includeGlobal: true, userPermissionsId: session.userId },
  });
  return result.aiFetchUserTree;
}

export async function sendChatQuery(params: {
  chatId?: string;
  ids: CreatedIds;
  message: string;
  sessionMetadata?: Record<string, unknown> | null;
  scope: { type: string; id: string; organizationId: null };
  session: LiveSession;
  system?: string;
}) {
  await ensureOrmReady();
  const input: any = {
    chatId: params.chatId || null,
    message: params.message,
    topK: 10,
  };
  if (!params.chatId) input.scope = { ...params.scope, type: String(params.scope.type || '').toLowerCase() };
  if (params.sessionMetadata) input.sessionMetadata = params.sessionMetadata;
  const data = await GigaORM.run({ caller: { id: params.session.userId, type: 'user' } }, () =>
    queryChat({ ...input, request: requestContext(params.session) as any, supabase: sessionSupabase(params.session) }),
  );
  if (!params.chatId && data?.chat?.id) params.ids.chats.add(String(data.chat.id));
  return data;
}

export async function sendChatSend(params: {
  chatId?: string;
  ids: CreatedIds;
  message: string;
  requestId?: string;
  sessionMetadata?: Record<string, unknown> | null;
  scope: { type: string; id: string; organizationId: null };
  session: LiveSession;
  system?: string;
}) {
  await ensureOrmReady();
  const input: any = {
    chatId: params.chatId || null,
    message: params.message,
    topK: 10,
  };
  if (!params.chatId) input.scope = { ...params.scope, type: String(params.scope.type || '').toLowerCase() };
  if (params.sessionMetadata) input.sessionMetadata = params.sessionMetadata;
  const data = await GigaORM.run({ caller: { id: params.session.userId, type: 'user' } }, () =>
    queryChat({ ...input, request: requestContext(params.session) as any, supabase: sessionSupabase(params.session) }),
  );
  if (!params.chatId && data?.chat?.id) params.ids.chats.add(String(data.chat.id));
  return {
    ack: {
      request_id: params.requestId || null,
      status: 'accepted',
    },
    done: {
      data,
    },
  };
}

export async function sendChatConfirm(params: { chatId: string; confirmText?: string; requestId?: string; session: LiveSession }) {
  const decision =
    String(params.confirmText || 'confirm')
      .trim()
      .toLowerCase() === 'cancel'
      ? 'cancel'
      : 'confirm';
  const data = await chatGraphql<any>(params.session, CHAT_CONFIRM, {
    input: {
      chat_id: params.chatId,
      decision,
    },
  });
  return {
    ack: {
      request_id: params.requestId || null,
      status: 'accepted',
    },
    done: {
      data: data.chatConfirm,
    },
  };
}

export async function sendChatFlow(params: {
  chatId?: string;
  confirmText?: string;
  expectConfirmation?: boolean;
  ids: CreatedIds;
  message: string;
  requestId?: string;
  sessionMetadata?: Record<string, unknown> | null;
  scope: { type: string; id: string; organizationId: null };
  session: LiveSession;
  system?: string;
  timeoutMs?: number;
}) {
  const startedAt = Date.now();
  const pendingStartedAt = Date.now();
  const pending = await withTimeout(sendChatSend(params), 'pending request', params.timeoutMs);
  const pendingMs = Date.now() - pendingStartedAt;
  const needsConfirmation = pending.done.data.agent?.requires_confirmation === true;
  if (!needsConfirmation) {
    return {
      pending,
      final: pending.done.data,
      timings: {
        confirmation_ms: null,
        pending_ms: pendingMs,
        total_ms: Date.now() - startedAt,
      },
    };
  }
  if (params.expectConfirmation === false) {
    return {
      pending,
      final: pending.done.data,
      timings: {
        confirmation_ms: null,
        pending_ms: pendingMs,
        total_ms: Date.now() - startedAt,
      },
    };
  }
  const confirmationStartedAt = Date.now();
  let confirmed: Awaited<ReturnType<typeof sendChatSend>>;
  try {
    confirmed = await withTimeout(
      sendChatConfirm({
        chatId: pending.done.data.chat.id,
        confirmText: params.confirmText,
        requestId: params.requestId,
        session: params.session,
      }),
      'confirmation request',
      params.timeoutMs,
    );
  } catch (error) {
    if (error instanceof Error) {
      Object.assign(error, {
        pending,
        timings: {
          confirmation_ms: Date.now() - confirmationStartedAt,
          pending_ms: pendingMs,
          total_ms: Date.now() - startedAt,
        },
      });
    }
    throw error;
  }
  return {
    pending,
    final: confirmed.done.data,
    timings: {
      confirmation_ms: Date.now() - confirmationStartedAt,
      pending_ms: pendingMs,
      total_ms: Date.now() - startedAt,
    },
  };
}
