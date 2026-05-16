import { safeJsonParse, sanitizeActionName } from 'giga-ai-helper';
import { Executor } from '@workflow/executor';
import { getScopedLogger } from '@connectingmatrix/logger/lib/logger';
import {
  AgentActionDefinition,
  AgentActionName,
  AgentActionResult,
  AgentConversationContext,
  AgentExecutionPlan,
} from '@giga/shared/types/contracts/agent.types';
import { SourceReference } from '@giga/shared/types/contracts/graphql.types';
import { openai } from '@giga/shared/services/common/openai-client';
import { openAIResponsesModelProfile } from '@connectingmatrix/ai-agents/services/ai-agents/io/model-profile';
import { formatKnowledgeChunks, readGigaKnowledgeForMessage } from './knowledge';

const logger = getScopedLogger('agent-planner-service');
const MAX_PLAN_ACTIONS = 12;
const MAX_SYNTHESIS_RESULTS = 10;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string => String(value || '').trim();
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const lower = (value: unknown) => text(value).toLowerCase();

function shortContext(context: AgentConversationContext) {
  return {
    scope: context.scope,
    chat_agent_state: context.chat_agent_state || null,
    subjects: context.subjects
      .slice(0, 20)
      .map((subject) => ({ id: subject.id, name: subject.name, tags: subject.tags, summary_line: subject.summary_line })),
    posts: context.posts
      .slice(0, 20)
      .map((post) => ({ id: post.id, subject_id: post.subject_id, title: post.title, narrative_excerpt: post.narrative_excerpt })),
    recent_chat_messages: context.recent_chat_messages.slice(-12),
  };
}

function actionCatalogForPrompt(actions: AgentActionDefinition[]) {
  return actions.map((action) => ({
    name: action.name,
    description: action.description,
    input_schema: action.input_schema,
    mutating: action.mutating === true,
  }));
}

function directReplyPlan(message: string): AgentExecutionPlan | null {
  if (/^\s*(hello|hi|hey|thanks|thank you|ok|okay|cool|great)[!.\s]*$/i.test(message)) {
    return { intent: 'Respond directly to a common chat message.', actions: [] };
  }
  if (/\b(what is giga chat|how does giga chat work|what can you do|help me understand giga)\b/i.test(message)) {
    return { intent: 'Answer a Giga Chat question using local Giga knowledge when available.', actions: [] };
  }
  return null;
}

function deterministicFallback(actions: AgentActionDefinition[], message: string): AgentExecutionPlan {
  const available = new Set(actions.map((action) => action.name));
  const m = lower(message);
  const planned: AgentExecutionPlan['actions'] = [];
  const push = (name: AgentActionName, reason: string, input: Record<string, unknown> = {}) => {
    if (!available.has(name)) return;
    planned.push({ id: `a${planned.length + 1}`, name, reason, input, depends_on: planned.length ? [planned[planned.length - 1].id] : [] });
  };
  if (/\b(chart|map|graph|plot|visuali[sz]e|dashboard)\b/.test(m)) push('create_chart', 'Create the requested chart output.', { prompt: message });
  if (/\b(workflow|cypher|execute|run|publish|attach)\b/.test(m)) {
    if (/\b(run|execute)\b/.test(m)) push('execute_workflow', 'Execute the referenced workflow.', { prompt: message });
    else push('create_workflow_from_cypher', 'Create a workflow from the requested behavior.', { prompt: message });
  }
  if (/\b(tree|channel|category|subject|post|debug-|link|unlink|cleanup|remove|delete|create|update)\b/.test(m))
    push('fetch_user_tree', 'Read the current tree before planning safe Giga changes.', { include_empty_paths: true });
  if (!planned.length && available.has('retrieve_db_chunks_and_analyze'))
    push('retrieve_db_chunks_and_analyze', 'Ground the answer in scoped Giga knowledge.', { top_k: 12 });
  return {
    intent: planned.length ? 'Use available Giga tools to satisfy the request.' : 'Reply directly.',
    actions: planned.slice(0, MAX_PLAN_ACTIONS),
  };
}

function plannerRules(input: { message: string; systemPrompt?: string | null }) {
  return [
    'You are Giga AI Planner. Return strict JSON only.',
    'JSON shape: {"intent":"...","actions":[{"id":"a1","name":"action_name","reason":"...","input":{},"depends_on":[]}]}',
    'Use only action names from the provided action catalog. Do not invent action names.',
    'Do not hardcode data. Extract names, ids, prefixes, counts, scopes, chart options, and workflow requirements from the user message and context.',
    'Common greetings, thanks, and short general chat should return zero actions.',
    'Questions about Giga, Giga Chat, Giga knowledge, MCP, node rules, backend, workflows, or agents should use local Giga knowledge when relevant.',
    'Tree/content operations must use the action catalog for channels, categories, subjects, posts, and user tree. Posts can be read/create/update/delete but cannot be linked or unlinked.',
    'For duplicate-safe tree creation, create reusable nodes once and then link existing nodes where possible. Use read/list actions before destructive operations.',
    'For delete debug-* requests, plan read/find first and destructive actions second. The confirmation layer decides whether to execute or cancel.',
    'Organization operations must include organization scope/id/name when the user asks for organisation/organization work. Permission failures are expected and should not be bypassed.',
    'Workflow requests may create workflows, create workflows that create workflows, execute workflows, publish workflows, attach workflows, and create nested workflows when asked.',
    'Use multiple actions when a task needs multiple tool passes. Dependencies must point to prior action ids.',
    'For chart/map requests, select chart actions and include prompt, title, labels, feature values, color scale, and map geography hints. US/Pakistan maps with population distribution should request blue shade maps with labels.',
    'For RCM requests, plan shared-space file creation, workflow creation, channel/workflow attachment, training/analysis execution, and final reporting using available tools only.',
    input.systemPrompt ? `User custom system prompt: ${input.systemPrompt}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function parsePlannerJson(content: string): Record<string, unknown> {
  const raw = text(content)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  return record(safeJsonParse(raw));
}

function normalizePlan(raw: Record<string, unknown>, actions: AgentActionDefinition[], fallback: AgentExecutionPlan): AgentExecutionPlan {
  const available = new Set(actions.map((action) => action.name));
  const normalized: AgentExecutionPlan['actions'] = [];
  for (const item of list(raw.actions).slice(0, MAX_PLAN_ACTIONS)) {
    const action = record(item);
    const name = sanitizeActionName(text(action.name), available as Set<AgentActionName>);
    if (!name) continue;
    const id = text(action.id) || `a${normalized.length + 1}`;
    normalized.push({
      id,
      name,
      reason: text(action.reason) || `Run ${name}.`,
      input: record(action.input),
      depends_on: list(action.depends_on)
        .map((entry) => text(entry))
        .filter(Boolean),
    });
  }
  return { intent: text(raw.intent) || fallback.intent, actions: normalized.length ? normalized : fallback.actions };
}

export async function createPlan(input: {
  message: string;
  context: AgentConversationContext;
  availableActions: AgentActionDefinition[];
  executionContext?: string | null;
  strict?: boolean;
  systemPrompt?: string | null;
}): Promise<AgentExecutionPlan> {
  const startedAt = Date.now();
  const direct = directReplyPlan(input.message);
  if (direct) return direct;
  const fallback = deterministicFallback(input.availableActions, input.message);
  try {
    const knowledge = readGigaKnowledgeForMessage(input.message, { maxChunks: 10 });
    const executorContext = (() => {
      try {
        return Executor.readWorkflowPlannerContext(input.message);
      } catch (_error) {
        return '';
      }
    })();
    const prompt = [
      plannerRules({ message: input.message, systemPrompt: input.systemPrompt || null }),
      `User message:\n${input.message}`,
      `Conversation context:\n${JSON.stringify(shortContext(input.context), null, 2)}`,
      `Available action catalog:\n${JSON.stringify(actionCatalogForPrompt(input.availableActions), null, 2)}`,
      input.executionContext ? `Execution context:\n${input.executionContext}` : '',
      executorContext ? `Workflow node rules and catalog:\n${executorContext}` : '',
      knowledge.length ? `Local Giga knowledge chunks:\n${formatKnowledgeChunks(knowledge)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const response = await openai.responses.create({
      ...openAIResponsesModelProfile(),
      input: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    });
    const content = text(response.output_text);
    const plan = normalizePlan(parsePlannerJson(content), input.availableActions, fallback);
    logger.info('agent.plan.completed', { duration_ms: Date.now() - startedAt, actions: plan.actions.length });
    return plan;
  } catch (error) {
    logger.warn('agent.plan.fallback', { duration_ms: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error || '') });
    if (input.strict) throw error;
    return fallback;
  }
}

export async function synthesizeMarkdown(input: {
  message: string;
  intent: string;
  context: AgentConversationContext;
  actionResults: AgentActionResult[];
  sources: SourceReference[];
  systemPrompt?: string | null;
}): Promise<string> {
  const knowledge = readGigaKnowledgeForMessage(input.message, { maxChunks: 6 });
  const prompt = [
    'Write the final Giga Chat answer in markdown.',
    'Use the action results as the source of truth. Be honest about failed or skipped actions.',
    'Do not fabricate ids, links, files, workflow outputs, chart data, or permission results.',
    'For Giga questions, use provided local Giga knowledge chunks when relevant.',
    input.systemPrompt ? `User custom system prompt: ${input.systemPrompt}` : '',
    `User message: ${input.message}`,
    `Intent: ${input.intent}`,
    `Action results: ${JSON.stringify(input.actionResults.slice(0, MAX_SYNTHESIS_RESULTS), null, 2)}`,
    `Sources: ${JSON.stringify(input.sources.slice(0, 12), null, 2)}`,
    knowledge.length ? `Local Giga knowledge chunks:\n${formatKnowledgeChunks(knowledge)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  try {
    const response = await openai.responses.create({
      ...openAIResponsesModelProfile(),
      input: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });
    return text(response.output_text) || 'Done.';
  } catch (error) {
    logger.warn('agent.synthesis.fallback', { error: error instanceof Error ? error.message : String(error || '') });
    const summaries = input.actionResults.map((result) => result.summary).filter(Boolean);
    return summaries.length ? summaries.join('\n\n') : 'Done.';
  }
}
