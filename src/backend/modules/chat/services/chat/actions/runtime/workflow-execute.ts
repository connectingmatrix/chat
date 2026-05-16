import { cloneJson } from 'giga-ai-helper';
import { createRunId } from 'giga-ai-helper/workflow';
import { readWorkflowRuntimeLimitsDirect } from '@giga/plan-policy/services/plan-policy/runtime/enforcement';
import { AgentActionRuntime } from '@giga/shared/types/contracts/agent.types';
import { WorkflowNodeKindEnum, WorkflowNodeStatusEnum } from '@connectingmatrix/workflow-driver/services/workflow/contracts/types';
import { GigaActionOutput, emptyActionArtifacts } from '../contracts/types';
import { loadChatWorkflowState, saveChatWorkflowState, workflowEditorUrl, workflowShape } from '../auth/workflow-session';
import { optionalText, requireCapability } from './helpers';
import { workflowFromInput, workflowRecordFromInput } from './workflow';
import { persistChatWorkflowExecution } from './workflow-execution-record';
import { extractWorkflowTerminalOutput, workflowOutputText } from './workflow-terminal';
import type { WorkflowDefinition } from '@giga/shared/types/contracts/workflow.types';

function baseUrl(request: any) {
  const headers = request?.headers || {};
  const origin = String(headers.origin || '').trim();
  if (origin) return origin.replace(/\/+$/g, '');
  const host = String(headers['x-forwarded-host'] || headers.host || '').trim();
  if (!host) return 'http://localhost:4000';
  const protocol = String(headers['x-forwarded-proto'] || request?.protocol || 'http').trim();
  return `${protocol}://${host}`.replace(/\/+$/g, '');
}

function workflowSettings(runtime: AgentActionRuntime, limits: any) {
  const url = baseUrl(runtime.request);
  return {
    graphqlUrl: `${url}/api/v2/graphql`,
    httpBaseUrl: `${url}/api/v2`,
    authMode: 'auto-from-current-session',
    manualHeaders: {},
    maxConcurrentExecutionsPerUser: limits.maxConcurrentExecutionsPerUser,
    maxExecutionSeconds: limits.maxExecutionSeconds,
  };
}

function workflowBroadcast(runtime: AgentActionRuntime, input: any) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const broadcastId = String(source.broadcast_id || runtime.userId || '').trim();
  const broadcastChannelName = String(source.broadcast_channel_name || 'workflow-socket').trim();
  if (!broadcastId || !broadcastChannelName) {
    throw new Error('Workflow execution requires broadcast_id and broadcast_channel_name.');
  }
  return {
    broadcast_id: broadcastId,
    broadcast_channel_name: broadcastChannelName,
  };
}

function executableWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  const nodes = workflow.nodes || [];
  const connections = workflow.connections || [];
  const hasStart = nodes.some((node) => String(node?.modelId || '').trim() === 'start');
  const hasRespondEnd = nodes.some((node) => String(node?.modelId || '').trim() === 'respond-end');
  if (hasStart && hasRespondEnd && connections.length) return workflow;
  if (nodes.length !== 1) return workflow;
  const entry = nodes[0];
  const modelId = String(entry.modelId || entry.type || '').trim();
  if (modelId !== 'response.emit' && modelId !== 'response' && modelId !== 'respond-end') return workflow;
  const runtime = entry.runtime || {};
  const parameters = runtime.parameters as Record<string, unknown>;
  const response = String(runtime.response || parameters?.output || '').trim() || 'Done.';
  const endId = String(entry.id || 'respond-end-1').trim() || 'respond-end-1';
  const startNode: WorkflowDefinition['nodes'][number] = {
    id: 'start-1',
    gigaId: 'start-1',
    modelId: 'start',
    type: 'workflowStep',
    name: 'Start',
    description: 'Start node.',
    kind: WorkflowNodeKindEnum.Process,
    status: WorkflowNodeStatusEnum.Stopped,
    position: { x: 0, y: 0 },
    runtime: {},
    ports: { in: { input: {} }, out: { output: {} } },
  };
  const endNode: WorkflowDefinition['nodes'][number] = {
    id: endId,
    gigaId: endId,
    modelId: 'respond-end',
    type: 'workflowStep',
    name: String(entry.name || 'Respond End'),
    description: 'End node.',
    kind: WorkflowNodeKindEnum.Output,
    status: WorkflowNodeStatusEnum.Stopped,
    position: { x: 260, y: 0 },
    runtime: { response },
    ports: { in: { input: {} }, out: { output: {} } },
  };
  return {
    ...workflow,
    nodes: [startNode, endNode],
    connections: [
      { id: `start-1-${endId}`, name: 'start->respond-end', from: 'start-1', to: endId, sourceHandle: 'out:output', targetHandle: 'in:input' },
    ],
  };
}

export async function runExecuteWorkflow(runtime: AgentActionRuntime, input: any): Promise<GigaActionOutput> {
  await requireCapability(runtime, 'CAN_EXECUTE_WORKFLOW', 'workflow execute');
  const startedAt = Date.now();
  const runId = optionalText(input, 'request_id') || createRunId('run');
  const workflowRecord = await workflowRecordFromInput(runtime, input);
  const workflow = executableWorkflow(cloneJson(workflowRecord.workflow) as WorkflowDefinition);
  workflow.metadata = { ...(workflow.metadata || { name: workflowRecord.name || 'Workflow' }), id: workflowRecord.id || workflow.metadata?.id || '' };
  const limits = await readWorkflowRuntimeLimitsDirect(runtime.supabase, { userId: runtime.userId });
  const broadcast = workflowBroadcast(runtime, input);
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const { executeWorkflowMutation } = require('@connectingmatrix/workflow-driver/services/workflow/runtime/service');
  let result;
  try {
    result = await executeWorkflowMutation({
      input: {
        workflow: cloneJson(workflow) as WorkflowDefinition,
        settings: workflowSettings(runtime, limits),
        mode: 'WAIT',
        request_id: runId,
        ...broadcast,
      },
      requestContext: { request: (runtime.request || { headers: {} }) as any, supabase: runtime.supabase, userId: runtime.userId },
    });
  } catch (error) {
    const message = String((error as any)?.message || 'Workflow execution failed.');
    const executionRecord = await persistChatWorkflowExecution(runtime, {
      actionInput: input,
      error: message,
      runId,
      startedAt,
      workflow,
      workflowId: workflowRecord.id,
    });
    const executionId = executionRecord?.id ? String(executionRecord.id) : null;
    await saveChatWorkflowState(runtime, {
      workflow_id: workflowRecord.id,
      workflow_name: workflowRecord.name,
      workflow,
      run_id: runId,
      execution_id: executionId,
      output: { error: message },
    });
    throw error;
  }
  const output = extractWorkflowTerminalOutput(result.workflow as WorkflowDefinition);
  const text = workflowOutputText(output);
  const executionRecord = await persistChatWorkflowExecution(runtime, {
    actionInput: input,
    output,
    result,
    runId,
    startedAt,
    workflow: result.workflow as WorkflowDefinition,
    workflowId: workflowRecord.id,
  });
  const executionId = executionRecord?.id ? String(executionRecord.id) : null;
  await saveChatWorkflowState(runtime, {
    workflow_id: workflowRecord.id,
    workflow_name: workflowRecord.name,
    workflow: result.workflow as WorkflowDefinition,
    run_id: result.run_id || runId,
    execution_id: executionId,
    output,
  });
  const shape = workflowShape(result.workflow as WorkflowDefinition);
  return {
    summary: `Executed workflow${workflowRecord.name ? ` "${workflowRecord.name}"` : ''}. [Open workflow](${workflowEditorUrl(workflowRecord.id)}).`,
    data: {
      execution: result,
      execution_id: executionId,
      output,
      text,
      workflow_id: workflowRecord.id,
      editor_url: workflowEditorUrl(workflowRecord.id),
      ...shape,
    },
    ...emptyActionArtifacts,
  };
}

export async function runGetWorkflowOutput(runtime: AgentActionRuntime, input: any): Promise<GigaActionOutput> {
  const state = await loadChatWorkflowState(runtime.supabase, runtime.chatId, runtime.userId);
  if (!optionalText(input, 'workflow_id') && state.last_workflow_output !== undefined && state.last_workflow_output !== null) {
    const editorUrl = state.last_workflow_url || workflowEditorUrl(String(state.last_workflow_id || ''));
    return {
      summary: `Extracted latest workflow output. [Open workflow](${editorUrl}).`,
      data: {
        output: state.last_workflow_output,
        text: workflowOutputText(state.last_workflow_output),
        workflow_id: state.last_workflow_id || null,
        editor_url: editorUrl,
      },
      ...emptyActionArtifacts,
    };
  }
  const workflow = await workflowFromInput(runtime, input);
  const output = extractWorkflowTerminalOutput(workflow);
  return { summary: 'Extracted workflow output.', data: { output, text: workflowOutputText(output) }, ...emptyActionArtifacts };
}
