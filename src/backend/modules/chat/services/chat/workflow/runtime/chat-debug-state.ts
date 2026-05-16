import { cloneJson } from 'giga-ai-helper';
import type { WorkflowDefinition, WorkflowRunLogEvent } from '@giga/shared/types/contracts/workflow.types';

const recordValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const textValue = (value: unknown): string => String(value || '').trim();
const cloneValue = (value: unknown): unknown => (value === null || typeof value === 'undefined' ? null : cloneJson(value as any));

const workflowNode = (workflow: WorkflowDefinition | null | undefined, nodeId: string) => {
  for (const node of workflow?.nodes || []) {
    if (textValue(node?.id) === nodeId) return recordValue(node);
  }
  return null;
};

const logNode = (log: WorkflowRunLogEvent, workflow?: WorkflowDefinition | null) => {
  const node = recordValue(recordValue(log.data).node);
  if (Object.keys(node).length) return node;
  const nodeId = textValue(log.nodeId);
  return nodeId ? workflowNode(workflow, nodeId) : null;
};

export const resolveWorkflowCurrentNode = (logs: WorkflowRunLogEvent[] | null | undefined, workflow?: WorkflowDefinition | null) => {
  const entries = Array.isArray(logs) ? logs : [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const node = logNode(entries[index], workflow);
    if (node) return node;
  }
  for (let index = (workflow?.nodes || []).length - 1; index >= 0; index -= 1) {
    const node = recordValue((workflow?.nodes || [])[index]);
    const status = textValue(node.status).toLowerCase();
    if (status === 'failed' || status === 'running' || status === 'passed' || status === 'warning') return node;
  }
  return null;
};

export const buildWorkflowChatDebugState = (params: {
  executionId: string;
  logs?: WorkflowRunLogEvent[] | null;
  runId: string;
  workflow?: WorkflowDefinition | null;
  workflowId: string;
  workflowSource?: string | null;
}) => {
  const currentNode = resolveWorkflowCurrentNode(params.logs, params.workflow);
  const ports = recordValue(currentNode && currentNode.ports);
  const currentNodeInput = currentNode ? cloneValue(currentNode.input || recordValue(ports.in).input || ports.in || null) : null;
  const currentNodeOutput = currentNode ? cloneValue(currentNode.output || ports.out || null) : null;

  return {
    execution_id: params.executionId,
    run_id: params.runId,
    workflow_id: params.workflowId,
    workflow_source: textValue(params.workflowSource) || null,
    current_node: currentNode ? cloneValue(currentNode) : null,
    current_node_id: currentNode ? textValue(currentNode.id) || null : null,
    current_node_name: currentNode ? textValue(currentNode.name) || null : null,
    current_node_model_id: currentNode ? textValue(currentNode.modelId) || null : null,
    current_node_status: currentNode ? textValue(currentNode.status) || null : null,
    current_node_input: currentNodeInput,
    current_node_output: currentNodeOutput,
  };
};
