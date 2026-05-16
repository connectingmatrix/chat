import { parseRecordValue } from 'giga-ai-helper/workflow';
import { EntityRequestContext } from '@connectingmatrix/orm/orm/request-entity-context';
import { executeSharedAgentRuntime } from '@connectingmatrix/workflow-driver/services/workflow/agent';
import type { QueryChatInput } from '@connectingmatrix/chat/services/chat/contracts/types';
import type { WorkflowNodeHandlerContext } from '@connectingmatrix/workflow-driver/services/workflow/contracts/types';

const text = (value: unknown): string => String(value ?? '').trim();
const record = (value: unknown): Record<string, unknown> => parseRecordValue(value);

const createSyntheticWorkflowContext = async (input: QueryChatInput): Promise<WorkflowNodeHandlerContext> => {
  const current = EntityRequestContext.maybeCurrent();
  const request = (input.request || { headers: {} }) as { [key: string]: unknown; headers?: Record<string, unknown>; lifecycleState?: unknown };
  const entityContext =
    current || (await EntityRequestContext.fromRequest({ request, supabase: input.supabase }, () => EntityRequestContext.current()));
  return {
    credential: null,
    hostContext: {},
    input: {
      message: input.message,
      chatId: input.chatId || null,
      scope: input.scope || null,
      subjectIds: input.subjectIds || [],
      postIds: input.postIds || [],
      tagSlugs: input.tagSlugs || [],
    },
    node: {
      id: 'chat-ai-agent',
      modelId: 'ai-agent',
      name: 'Chat AI Agent',
      properties: {},
      runtime: { message: input.message, chatId: input.chatId || null },
    } as never,
    requestContext: { request, supabase: input.supabase, userId: entityContext.caller?.id || '' } as never,
    settings: {
      graphqlUrl: process.env.GQL_URL || process.env.GRAPHQL_URL || 'http://localhost:3001/api/v2/graphql',
      authMode: 'auto-from-current-session',
    },
    signal: undefined,
    workflow: {
      metadata: {
        id: input.chatId || 'chat-agent',
        name: 'Chat Agent Runtime',
        chatId: input.chatId || null,
        message: input.message,
        scope: input.scope || null,
        requestId: input.debug?.requestId || null,
      },
      nodeModels: {},
    } as never,
  };
};

export const queryChatWithSharedNodeAgent = async (input: QueryChatInput) => {
  const workflowContext = await createSyntheticWorkflowContext(input);
  const output = await executeSharedAgentRuntime(workflowContext, {
    confirmed: record(input.sessionMetadata).confirmed === true,
    context: {
      chatId: input.chatId || null,
      request: record(input.request),
      scope: input.scope || null,
      subjectIds: input.subjectIds || [],
      postIds: input.postIds || [],
      tagSlugs: input.tagSlugs || [],
    },
    knowledge: text(record(input.sessionMetadata).knowledge || record(input.sessionMetadata).knowledgeText) || null,
    attachments: Array.isArray(input.attachments) ? (input.attachments as never) : [],
    maxActionsPerPass: Number(record(input.sessionMetadata).maxActionsPerPass || 10),
    maxPasses: Number(record(input.sessionMetadata).maxPasses || 8),
    message: input.message,
    pendingPlan: record(input.sessionMetadata).pendingPlan as never,
    requestId: input.debug?.requestId || null,
    systemPrompt: input.systemPrompt || null,
    tools: [],
    surface: 'chat',
    outputFormatSeed: text(record(input.sessionMetadata).outputFormatSeed) || null,
  });
  return output;
};
