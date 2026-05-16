import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupabaseStub } from '@giga/shared/test/supabase-stub';
import { attachQueuedChatWorkflowExecutionArtifacts } from '@connectingmatrix/chat/services/chat/workflow/write/queued-workflow-chat';

test('attachQueuedChatWorkflowExecutionArtifacts preserves executor queue timing metadata', async () => {
  const row: Record<string, any> = {
    id: 'execution-1',
    workflow_id: 'workflow-1',
    status: 'completed',
    response_payload: {
      __workflowQueue: {
        queued_at: '2026-04-25T22:50:32.000Z',
        execution_started_at: '2026-04-25T22:50:33.000Z',
      },
    },
  };
  const supabase = createSupabaseStub({
    ai_workflow_executions: [row],
  });

  await attachQueuedChatWorkflowExecutionArtifacts({
    assistantMessageId: 42,
    executionId: row.id,
    supabase,
    execution: {
      executionId: 'execution-1',
      source: 'user',
      workflowId: 'workflow-1',
      assignmentId: 'assignment-1',
      workflow: { metadata: { id: 'workflow-1', name: 'Workflow 1' }, nodes: [], connections: [] },
      workflowResult: {
        workflow: { metadata: { id: 'workflow-1', name: 'Workflow 1' }, nodes: [], connections: [] },
        logs: [],
        stopped: false,
        runId: 'run-1',
      },
      runId: 'run-1',
      debugState: {
        execution_id: 'execution-1',
        run_id: 'run-1',
        workflow_id: 'workflow-1',
        workflow_source: 'user',
        current_node: { id: 'respond-end-1', name: 'Respond End', modelId: 'respond-end', status: 'passed' },
        current_node_input: { response: { text: 'Hello! How can I assist you today?' } },
        current_node_output: { output: { text: 'Hello! How can I assist you today?' } },
      },
      terminalPayload: { text: 'Hello! How can I assist you today?' },
      text: 'Hello! How can I assist you today?',
      sourceRefs: [],
      retrievedChunks: [],
      tracker: null,
    } as any,
  });

  const saved = (supabase as any).tables.ai_workflow_executions[0];
  assert.equal(saved.assistant_message_id, '42');
  assert.equal(saved.response_payload.__workflowQueue.queued_at, '2026-04-25T22:50:32.000Z');
  assert.equal(saved.response_payload.__workflowQueue.execution_started_at, '2026-04-25T22:50:33.000Z');
  assert.equal(saved.response_payload.text, 'Hello! How can I assist you today?');
  assert.equal(saved.response_payload.execution_id, 'execution-1');
  assert.equal(saved.response_payload.run_id, 'run-1');
  assert.equal(saved.response_payload.workflow_id, 'workflow-1');
  assert.equal(saved.response_payload.workflow_source, 'user');
  assert.equal(saved.response_payload.workflow_debug.current_node.id, 'respond-end-1');
});
