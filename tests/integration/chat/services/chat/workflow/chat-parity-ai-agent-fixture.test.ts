import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { WORKFLOW_GROUPED_ACTION_NODE_ACTIONS } from '@connectingmatrix/nodes/services/workflow/nodes/runtime/action-node-registry';
import { chatParityFixturePath } from '../../../../src/services/chat/workflow/runtime/chat-parity-fixtures';

const readCompiled = () => JSON.parse(readFileSync(chatParityFixturePath('ai-agent', 'compiled'), 'utf8')).workflow;

test('chat parity AI Agent fixture exposes the worker-owned AI Agent graph', () => {
  const workflow = readCompiled();
  const nodes = workflow.nodes as Array<{ id: string; modelId: string; name: string; runtime?: Record<string, any> }>;
  const edges = workflow.connections as Array<{ from: string; to: string; sourceHandle: string; targetHandle: string }>;
  const json = JSON.stringify(workflow);
  const byName = (name: string) => nodes.find((node) => node.name === name);
  const byModel = (modelId: string) => nodes.find((node) => node.modelId === modelId);
  const linked = (from: string, to: string, sourceHandle?: string, targetHandle?: string) =>
    edges.some(
      (edge) =>
        edge.from === byName(from)?.id &&
        edge.to === byName(to)?.id &&
        (!sourceHandle || edge.sourceHandle === sourceHandle) &&
        (!targetHandle || edge.targetHandle === targetHandle),
    );
  const actionIds = Object.keys(WORKFLOW_GROUPED_ACTION_NODE_ACTIONS);

  for (const modelId of [
    'start',
    'current-chat',
    'text-analysis',
    'if-else',
    'ai-agent',
    'action-router',
    'merge',
    'respond-end',
    'workflow',
    'execute-workflow',
    'chart',
    'openai',
  ]) {
    assert.equal(Boolean(byModel(modelId)), true, `${modelId} is missing`);
  }
  for (const modelId of actionIds) assert.equal(Boolean(byModel(modelId)), true, `${modelId} is missing`);
  for (const modelId of ['ai-governor', 'chat-plan-policy', 'validate-workflow-cypher', 'output-format', 'serp-search']) {
    assert.equal(Boolean(byModel(modelId)), false, `${modelId} should not be present`);
  }

  assert.deepEqual(byName('Chat State')?.runtime?.mode, ['input', 'pending']);
  assert.equal(byName('Chat State')?.runtime?.chatId, '{{workflow.input.chatId}}');
  assert.equal(byName('Chat State')?.runtime?.message, '{{workflow.input.message}}');
  assert.equal(byName('Text Analysis')?.runtime?.context, '{{current-chat-2.context}}');
  assert.equal(byName('Text Analysis')?.runtime?.pendingPlan, '{{current-chat-2.pendingPlan}}');
  assert.equal(byName('AI Agent')?.runtime?.executionMode, 'plan-and-run');
  assert.equal(byName('AI Agent')?.runtime?.confirmationPolicy, 'mutations-only');
  assert.equal(byName('AI Agent')?.runtime?.modelActionPolicy, 'prefer-direct-replies');
  assert.equal(byName('AI Agent')?.runtime?.context, '{{text-analysis-3.context}}');
  assert.equal(byName('AI Agent')?.runtime?.pendingPlan, '{{text-analysis-3.pendingPlan}}');
  assert.equal(byName('Workflow')?.runtime?.definitionSource, 'cypher');
  assert.equal(byName('Store Pending Plan')?.runtime?.pendingAction, 'store');
  assert.equal(byName('Store Pending Plan')?.runtime?.chatId, '{{workflow.input.chatId}}');
  assert.equal(byName('Clear Pending Plan')?.runtime?.pendingAction, 'clear');
  assert.equal(byName('Clear Pending Plan')?.runtime?.chatId, '{{workflow.input.chatId}}');
  assert.equal(byName('Store Pending Plan?')?.runtime?.value, '{{ai-agent-4}}');
  assert.equal(byName('Store Pending Plan?')?.runtime?.leftPath, 'agent.requires_confirmation');
  assert.equal(byName('Store Pending Plan')?.runtime?.plan, '{{if-else-6.agent.plan}}');
  assert.equal(Boolean(byName('Store Pending Plan')?.runtime?.responseText), false);
  assert.equal(byName('Subject')?.runtime?.subjectIds, '{{workflow.input.subjectIds}}');
  assert.equal(byName('Post')?.runtime?.postIds, '{{workflow.input.postIds}}');
  assert.equal(byName('Chart')?.runtime?.outputMode, 'both');
  assert.equal(byName('Respond End')?.runtime?.response, '{{merge-9}}');
  assert.match(String(byName('AI Agent')?.runtime?.selectionPromptMd || ''), /commandToolSpec/i);
  assert.match(String(byName('AI Agent')?.runtime?.selectionPromptMd || ''), /workflow requests/i);
  assert.match(String(byName('AI Agent')?.runtime?.selectionPromptMd || ''), /execute\/publish\/attach only through connected tools/i);
  assert.match(
    String(byName('AI Agent')?.runtime?.selectionPromptMd || ''),
    /For charts\/maps, preserve labels, values, legends, and \[chart\] markup/i,
  );
  assert.doesNotMatch(String(byName('AI Agent')?.runtime?.selectionPromptMd || ''), /input\.cypher|input\.parameters|input\.workflowPrompt/i);
  assert.equal(json.includes('greeting_workflow_patch'), false);

  for (const routerName of ['Channel Actions', 'Category Actions', 'Subject Actions', 'Post Actions', 'User Tree Actions', 'Chat Actions']) {
    assert.ok(linked(routerName, 'AI Agent', 'cmd:command', 'cmd:tools'));
  }
  assert.ok(linked('Chat Start', 'Chat State'));
  assert.ok(linked('Chat State', 'Text Analysis'));
  assert.ok(linked('Text Analysis', 'AI Agent'));
  assert.ok(linked('Workflow', 'AI Agent', 'cmd:command', 'cmd:workflow'));
  assert.ok(linked('Execute Workflow', 'AI Agent', 'cmd:command', 'cmd:workflow'));
  assert.ok(linked('Chart', 'AI Agent', 'cmd:command', 'cmd:tools'));
  assert.ok(linked('AI Model', 'AI Agent', 'cmd:command', 'cmd:llm'));
  assert.ok(linked('AI Model', 'Workflow', 'cmd:command', 'cmd:llm'));
  assert.ok(linked('AI Model', 'Chart', 'cmd:command', 'cmd:llm'));
  assert.ok(linked('AI Agent', 'Store Pending Plan?'));
  assert.ok(linked('AI Agent', 'Merge Final Response', 'out:output', 'in:input1'));
  assert.ok(linked('Store Pending Plan?', 'Store Pending Plan', 'out:true', 'in:input'));
  assert.ok(linked('Store Pending Plan?', 'Clear Pending Plan', 'out:false', 'in:input'));
  assert.ok(linked('Store Pending Plan', 'Merge Final Response', 'out:output', 'in:input2'));
  assert.ok(linked('Clear Pending Plan', 'Merge Final Response', 'out:output', 'in:input3'));
  assert.ok(linked('Merge Final Response', 'Respond End', 'out:output', 'in:input'));
  assert.equal(Boolean(byName('Build Final Response')), false);
  assert.equal(Boolean(byName('Merge Agent Input')), false);
  assert.equal(Boolean(byName('Merge Final Response')), true);
});
