import {
  ChatExecutionModeEnum,
  ChatRuntimeEngineEnum,
  ChatRuntimeMetadata,
  ChatSessionMetadata,
  resolveChatRuntimeEngineFromMetadata,
} from './query-chat-engine';
import type { QueryChatInput } from '../contracts/types';

type ChatAttachmentInput = NonNullable<QueryChatInput['attachments']>[number];

export const chatAttachmentInputs = (input: QueryChatInput) =>
  Array.isArray(input.attachments) ? input.attachments.filter((attachment) => attachment && typeof attachment === 'object') : [];

export const resolveChatExecutionMode = (input: QueryChatInput, metadata: ChatSessionMetadata | null | undefined): ChatExecutionModeEnum => {
  const requestedMode = input.chatExecutionMode || metadata?.chatExecutionMode || metadata?.chat_execution_mode;
  return requestedMode === ChatExecutionModeEnum.Async ? ChatExecutionModeEnum.Async : ChatExecutionModeEnum.Wait;
};

export const resolveChatRuntimeEngine = (_input: QueryChatInput, metadata: ChatRuntimeMetadata | null | undefined): ChatRuntimeEngineEnum =>
  resolveChatRuntimeEngineFromMetadata(metadata);

export const buildChatSessionMetadata = (params: {
  attachments: ChatAttachmentInput[];
  input: QueryChatInput;
  requestedChatExecutionMode: ChatExecutionModeEnum;
}) => ({
  ...((params.input.sessionMetadata || {}) as Record<string, unknown>),
  ...(params.input.agentId ? { agentId: params.input.agentId } : {}),
  ...(params.input.agent_id ? { agent_id: params.input.agent_id } : {}),
  ...(params.attachments.length ? { attachments: params.attachments } : {}),
  ...(params.requestedChatExecutionMode === ChatExecutionModeEnum.Async ? { chatExecutionMode: ChatExecutionModeEnum.Async } : {}),
});

export const buildWorkflowChatRequestPayload = (params: {
  attachments: ChatAttachmentInput[];
  input: QueryChatInput;
  requestedChatExecutionMode: ChatExecutionModeEnum;
  systemPrompt: string | null;
}) => ({
  message: params.input.message,
  system_prompt: params.systemPrompt,
  tag_slugs: params.input.tagSlugs || [],
  subject_query: params.input.subjectQuery || null,
  top_k: params.input.topK || null,
  attachments: params.attachments,
  chat_execution_mode: params.requestedChatExecutionMode,
});
