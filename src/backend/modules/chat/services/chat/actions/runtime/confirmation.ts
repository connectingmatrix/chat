import { inferPlanActionDependencies } from '@workflow/nodes/nodes/ai-agent/giga-plan-dependencies';
import { ChatEntity } from '@connectingmatrix/orm/repositories/entities';
import { AgentExecutionPlan, AgentPlanAction } from '@giga/shared/types/contracts/agent.types';
import { compactActionValue } from '@connectingmatrix/chat/services/chat/runtime/action-value';

const CONFIRM_RE = /^(yes|y|confirm|confirmed|approve|approved|proceed|go ahead|do it|run it|execute|confirm all changes)$/i;
const CANCEL_RE = /^(no|n|cancel|cancelled|canceled|stop|abort|never mind|nevermind|do not proceed)$/i;

function metadataRecord(value: any) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function pendingFromMetadata(metadata: any): AgentExecutionPlan | null {
  const pending = metadataRecord(metadata).pending_agent_actions;
  if (!pending || typeof pending !== 'object') return null;
  const actions = Array.isArray((pending as any).actions) ? ((pending as any).actions as AgentPlanAction[]) : [];
  if (!actions.length) return null;
  return normalizePendingPlan({
    intent: String((pending as any).intent || 'Execute pending actions.'),
    actions,
  });
}

export function pendingPlanStateFromMetadata(metadata: Record<string, any> | null | undefined) {
  const currentMetadata = metadataRecord(metadata);
  return { metadata: currentMetadata, plan: pendingFromMetadata(currentMetadata) };
}

export function isConfirmationMessage(message: string) {
  return CONFIRM_RE.test(String(message || '').trim());
}

export function isCancelMessage(message: string) {
  return CANCEL_RE.test(String(message || '').trim());
}

export async function loadPendingPlan(supabase: any, chatId: string, userId: string): Promise<AgentExecutionPlan | null> {
  return (await loadPendingPlanState(supabase, chatId, userId)).plan;
}

export async function loadPendingPlanState(
  supabase: any,
  chatId: string,
  userId: string,
): Promise<{ metadata: Record<string, any>; plan: AgentExecutionPlan | null }> {
  const data = await ChatEntity.readMetadataRow(chatId, userId);
  return pendingPlanStateFromMetadata(data?.metadata);
}

export async function storePendingPlan(
  supabase: any,
  input: {
    chatId: string;
    currentMetadata?: Record<string, any> | null;
    message: string;
    plan: AgentExecutionPlan;
    userId: string;
  },
) {
  let metadata = input.currentMetadata === undefined ? null : metadataRecord(input.currentMetadata);
  if (input.currentMetadata === undefined) {
    const data = await ChatEntity.readMetadataRow(input.chatId, input.userId);
    metadata = metadataRecord(data?.metadata);
  }
  const plan = normalizePendingPlan(input.plan);
  await ChatEntity.updateMetadataRow(input.chatId, input.userId, {
    ...metadata,
    pending_agent_actions: {
      intent: plan.intent,
      actions: plan.actions,
      requested_message: input.message,
      created_at: new Date().toISOString(),
    },
  });
}

export async function clearPendingPlan(supabase: any, chatId: string, userId: string) {
  const state = await loadPendingPlanState(supabase, chatId, userId);
  await clearPendingPlanFromMetadata(supabase, chatId, userId, state.metadata);
}

export async function clearPendingPlanFromMetadata(supabase: any, chatId: string, userId: string, currentMetadata: Record<string, any>) {
  const metadata = { ...metadataRecord(currentMetadata) };
  delete metadata.pending_agent_actions;
  await ChatEntity.updateMetadataRow(chatId, userId, metadata);
}

const readableActionName = (name: string): string => String(name || 'action').replace(/_/g, ' ');

const words = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const reasonText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  return words(record.summary) || words(record.reason) || words(record.message) || words(record.description);
};

const inputText = (input: Record<string, unknown> | null | undefined, keys: string[]): string => {
  const record = metadataRecord(input);
  for (const key of keys) {
    const value = words(record[key]);
    if (value) return value;
  }
  return '';
};

const targetText = (action: AgentPlanAction): string => {
  const input = action.input || {};
  const prefix = inputText(input, ['name_prefix', 'channel_name_prefix', 'category_name_prefix', 'subject_name_prefix', 'post_title_prefix']);
  if (prefix) return `starting with "${prefix}"`;
  const name = inputText(input, ['name', 'channel_name', 'category_name', 'subject_name', 'post_title', 'title', 'workflow_name']);
  if (name) return `"${name}"`;
  return '';
};

export function actionReasonText(action: AgentPlanAction): string {
  return reasonText(action.reason) || targetText(action) || 'Planned Giga change.';
}

export function actionDisplayLabel(action: AgentPlanAction): string {
  const actionName = readableActionName(action.name);
  const target = targetText(action);
  return target ? `${actionName} ${target}` : actionName;
}

const stableInput = (value: unknown): string => {
  const compact = compactActionValue(value);
  if (!compact || typeof compact !== 'object' || Array.isArray(compact)) return JSON.stringify(compact ?? null);
  return JSON.stringify(
    Object.entries(compact as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .reduce((record, [key, entry]) => ({ ...record, [key]: entry }), {} as Record<string, unknown>),
  );
};

const routeControlKeys = new Set(['action', 'actionInput', 'parameters']);

const assignParameter = (target: Record<string, unknown>, key: string, value: unknown) => {
  if (!key.trim()) return;
  const parts = key
    .split('.')
    .map((entry) => entry.trim())
    .filter(Boolean);
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const current = metadataRecord(cursor[part]);
    cursor[part] = current;
    cursor = current;
  }
  cursor[parts[parts.length - 1]] = value;
};

const parameterRecord = (value: unknown): Record<string, unknown> => {
  const record = metadataRecord(value);
  if (Object.keys(record).length) return record;
  if (!Array.isArray(value)) return {};
  return value.reduce((next, entry) => {
    const item = metadataRecord(entry);
    assignParameter(next, words(item.key || item.name || item.label || item.id), item.value ?? item.id);
    return next;
  }, {} as Record<string, unknown>);
};

const backendActionPlan = (action: AgentPlanAction): AgentPlanAction => {
  const input = metadataRecord(action.input);
  const routedAction = words(input.action);
  if (!routedAction) return action;
  const rest = Object.entries(input).reduce<Record<string, unknown>>((next, [key, value]) => {
    if (!routeControlKeys.has(key)) next[key] = value;
    return next;
  }, {});
  return {
    ...action,
    name: routedAction as AgentPlanAction['name'],
    input: { ...rest, ...parameterRecord(input.actionInput), ...parameterRecord(input.parameters) },
  };
};

export function normalizePendingPlan(plan: AgentExecutionPlan): AgentExecutionPlan {
  const seen = new Map<string, AgentPlanAction>();
  const idRedirect = new Map<string, string>();
  for (const action of plan.actions || []) {
    const executableAction = backendActionPlan(action);
    const key = `${executableAction.name}:${stableInput(executableAction.input || {})}`;
    const existing = seen.get(key);
    if (existing) {
      idRedirect.set(executableAction.id, existing.id);
      continue;
    }
    seen.set(key, { ...executableAction, reason: actionReasonText(executableAction) });
  }
  const actions = inferPlanActionDependencies(
    Array.from(seen.values()).map((action) => ({
      ...action,
      depends_on: (action.depends_on || [])
        .map((id) => idRedirect.get(id) || id)
        .filter((id, index, ids) => id !== action.id && ids.indexOf(id) === index && ids.some((candidate) => candidate === id)),
    })),
  );
  const ids = new Set(actions.map((action) => action.id));
  return {
    intent: words(plan.intent) || 'Execute planned Giga changes.',
    actions: actions.map((action) => ({ ...action, depends_on: (action.depends_on || []).filter((id) => ids.has(id)) })),
  };
}

export function confirmationMarkdown(plan: AgentExecutionPlan) {
  const normalized = normalizePendingPlan(plan);
  const lines = ['I can make these Giga changes after you confirm:', ''];
  for (const action of normalized.actions) {
    lines.push(`- ${actionDisplayLabel(action)}: ${actionReasonText(action)}`);
  }
  lines.push('', 'Reply with `confirm` to execute these actions or `cancel` to abort.');
  return lines.join('\n');
}
