import { EnvLoader } from '@giga/shared/lib/env';
import { AgentConversationContext, AgentPipelinePass } from '@giga/shared/types/contracts/agent.types';

const DEFAULT_LIMIT = 28000;
const DEFAULT_RESULT_LIMIT = 4000;
const DEFAULT_ACTION_LIMIT = 8;

function envNumber(key: string, fallback: number) {
  const value = Number(EnvLoader.get(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clip(value: unknown, limit: number) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function compactPasses(passes: AgentPipelinePass[], resultLimit: number, actionLimit: number) {
  return passes.map((pass) => ({
    kind: pass.kind,
    response_format: pass.response_format || null,
    intent: pass.plan.intent,
    actions: pass.plan.actions.slice(0, actionLimit).map((action) => ({
      id: action.id,
      name: action.name,
      reason: clip(action.reason, 400),
      input: action.input || {},
      depends_on: action.depends_on || [],
    })),
    action_results: pass.action_results.slice(0, actionLimit).map((result) => ({
      id: result.id,
      name: result.name,
      status: result.status,
      summary: clip(result.summary, 700),
      error: result.error || null,
      data_excerpt: result.data ? clip(result.data, resultLimit) : null,
    })),
  }));
}

export function compactFinalContext(input: { context: AgentConversationContext; message: string; passes: AgentPipelinePass[] }) {
  const limit = envNumber('CHAT_FINALIZER_MAX_CONTEXT_CHARS', DEFAULT_LIMIT);
  const resultLimit = envNumber('CHAT_FINALIZER_MAX_RESULT_CHARS', DEFAULT_RESULT_LIMIT);
  const actionLimit = envNumber('CHAT_FINALIZER_MAX_ACTIONS', DEFAULT_ACTION_LIMIT);
  const payload = {
    message: clip(input.message, 2000),
    context: {
      scope: input.context.scope,
      subjects: input.context.subjects.slice(0, actionLimit),
      posts: input.context.posts.slice(0, actionLimit),
      recent_chat_messages: input.context.recent_chat_messages.slice(-6),
    },
    passes: compactPasses(input.passes, resultLimit, actionLimit),
  };
  const text = JSON.stringify(payload, null, 2);
  return { text, exceeded: text.length > limit };
}
