import { cloneJson } from 'giga-ai-helper';
import { Executor } from '@workflow/executor';
import { ChatEntity, ChatMessageEntity } from '@connectingmatrix/orm/repositories/entities';
import { AgentActionRuntime } from '@giga/shared/types/contracts/agent.types';
import type { WorkflowDefinition } from '@giga/shared/types/contracts/workflow.types';

const MAX_STORED_OUTPUT_CHARS = 4000;
const MAX_RECENT_WORKFLOWS = 8;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function metadataRecord(value: any) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function boundedOutput(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  if (text.length <= MAX_STORED_OUTPUT_CHARS) return value;
  return `${text.slice(0, MAX_STORED_OUTPUT_CHARS)}...`;
}

function inferredWorkflowIdFromMessages(rows: Array<{ content?: string | null }> | null | undefined) {
  for (const row of rows || []) {
    const text = String(row?.content || '');
    if (!/workflow/i.test(text)) continue;
    const found = text.match(UUID_PATTERN);
    if (found?.[0]) return found[0];
  }
  return '';
}

export const workflowEditorUrl = (workflowId?: string | null) => Executor.readWorkflowEditorUrl(workflowId);

export const workflowShape = (workflow: WorkflowDefinition | null | undefined) => Executor.readWorkflowShape(workflow);

export async function loadChatWorkflowState(supabase: any, chatId: string, userId: string) {
  const data = await ChatEntity.readMetadataRow(chatId, userId);
  const state = metadataRecord(metadataRecord(data?.metadata).chat_agent_state);
  const existingWorkflowId = String(state.last_workflow_id || '').trim();
  if (existingWorkflowId) return state;
  const messages = await ChatMessageEntity.listAssistantMessageContent(chatId, 20);
  const inferredWorkflowId = inferredWorkflowIdFromMessages(messages);
  if (!inferredWorkflowId) return state;
  return {
    ...state,
    last_workflow_id: inferredWorkflowId,
    last_workflow_url: workflowEditorUrl(inferredWorkflowId),
  };
}

export async function saveChatWorkflowState(
  runtime: AgentActionRuntime,
  patch: {
    workflow_id?: string | null;
    workflow_name?: string | null;
    workflow?: WorkflowDefinition | null;
    run_id?: string | null;
    execution_id?: string | null;
    output?: unknown;
    cypher?: string | null;
  },
) {
  const data = await ChatEntity.readMetadataRow(runtime.chatId, runtime.userId);
  const metadata = metadataRecord(data?.metadata);
  const current = metadataRecord(metadata.chat_agent_state);
  const workflowId = patch.workflow_id || String(current.last_workflow_id || '').trim() || null;
  const recent = [workflowId, ...(Array.isArray(current.recent_workflow_ids) ? current.recent_workflow_ids : [])]
    .filter(Boolean)
    .filter((id, index, list) => list.indexOf(id) === index)
    .slice(0, MAX_RECENT_WORKFLOWS);
  const shape = workflowShape(patch.workflow || null);
  const next = {
    ...current,
    last_workflow_id: workflowId,
    last_workflow_name: patch.workflow_name || current.last_workflow_name || null,
    last_workflow_url: workflowEditorUrl(workflowId),
    last_workflow_node_count: patch.workflow ? shape.node_count : current.last_workflow_node_count || null,
    last_workflow_connection_count: patch.workflow ? shape.connection_count : current.last_workflow_connection_count || null,
    last_workflow_run_id: patch.run_id || current.last_workflow_run_id || null,
    last_workflow_execution_id: patch.execution_id || current.last_workflow_execution_id || null,
    last_workflow_output: patch.output === undefined ? current.last_workflow_output ?? null : boundedOutput(patch.output),
    last_workflow_cypher: patch.cypher || current.last_workflow_cypher || null,
    recent_workflow_ids: recent,
    updated_at: new Date().toISOString(),
  };
  await ChatEntity.updateMetadataRow(runtime.chatId, runtime.userId, {
    ...metadata,
    chat_agent_state: cloneJson(next),
  });
  return next;
}
