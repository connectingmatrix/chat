import type { RetrievedChunk, SourceReference } from '@giga/shared/types/contracts/graphql.types';

export type { AnswerSynthesisInput, AnswerSynthesisOutput } from '@giga/shared/types/contracts/agent.types';

export type {
  ChatDebugEvent,
  ChatDebugStatus,
  ChatMessageRecord,
  ChatMessageRole,
  ChatScope,
  ChatScopeSnapshot,
  ChatScopeType,
  ChatShareDbRecord,
  ChatShareRecord,
  ChatShareSnapshot,
  ChatSessionRecord,
  QueryChatDebugOptions,
  QueryChatInput,
  ResolvedChatScope,
} from '@giga/shared/types/contracts/chat.types';

export type { RetrievedChunk, SourceReference } from '@giga/shared/types/contracts/graphql.types';

export const CHAT_SCOPE_TYPES = ['channel', 'category', 'subject', 'post', 'temporary'] as const;
