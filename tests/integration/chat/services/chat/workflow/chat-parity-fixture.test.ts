import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { WORKFLOW_GROUPED_ACTION_NODE_ACTIONS } from '@connectingmatrix/nodes/services/workflow/nodes/runtime/action-node-registry';

const readCompiled = () =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'packages/apps/chat/src/services/chat/workflow/chat-parity/chat-parity-workflow.compiled.json'), 'utf8'),
  ).workflow;

test('chat parity workflow fixture exposes the workflow-native chat graph', () => {
  const workflow = readCompiled();
  const nodes = workflow.nodes as Array<{ id: string; modelId: string; name: string; runtime?: Record<string, any> }>;
  const edges = workflow.connections as Array<{ from: string; to: string; sourceHandle: string; targetHandle: string }>;
  const json = JSON.stringify(workflow);
  const byName = (name: string) => nodes.find((node) => node.name === name);
  const byModel = (modelId: string) => nodes.find((node) => node.modelId === modelId);
  const linked = (from?: string, to?: string, sourceHandle?: string) =>
    edges.some((edge) => edge.from === from && edge.to === to && (!sourceHandle || edge.sourceHandle === sourceHandle));
  const actionIds = Object.keys(WORKFLOW_GROUPED_ACTION_NODE_ACTIONS);

  for (const modelId of [
    'start',
    'current-chat',
    'text-analysis',
    'code',
    'if-else',
    'ai-governor',
    'chat-plan-policy',
    'action-router',
    'validate-workflow-cypher',
    'merge',
    'output-format',
    'respond-end',
    'serp-search',
    'workflow',
    'execute-workflow',
  ]) {
    assert.equal(Boolean(byModel(modelId)), true, `${modelId} is missing`);
  }
  for (const modelId of actionIds) assert.equal(Boolean(byModel(modelId)), true, `${modelId} is missing`);
  for (const modelId of [
    'agent-runtime',
    'giga-context',
    'create-post',
    'create-subject',
    'code-multiple',
    'load-subject-with-tags',
    'supabase-rpc-retrieval',
  ]) {
    assert.equal(Boolean(byModel(modelId)), false, `${modelId} should not be present`);
  }

  const chatInput = byName('Chat Input');
  const textAnalysis = byName('Text Analysis');
  const governorInput = byName('Build Governor Input');
  const pendingPlan = byName('Pending Plan');
  const pendingStore = byName('Store Pending Plan');
  const pendingClear = byName('Clear Pending Plan');
  const planner = byName('Planner');
  const confirmedPlanner = byName('Confirmed Planner');
  const validateCypher = byName('Validate Workflow Cypher');
  const normalizeActions = byName('Normalize Planned Actions');
  const executeGovernor = byName('Execute Approved Plan');
  const workflowTool = byName('Workflow');
  const executeWorkflowTool = byName('Execute Workflow');
  const responseContext = byName('Build Response Context');
  const responseDraft = byName('Build Response Draft');
  const formatInput = byName('Build Format Input');
  const formatGate = byName('Use AI Response Formatting?');
  const prepareAiFormat = byName('Prepare AI Format Input');
  const mergeResponsePayload = byName('Merge Response Payload');
  const responseFormat = byName('Giga Chat Response');
  const governor = byName('Chat Planner');
  const referenceGate = byName('Reference Sync?');
  const readSubject = byName('Subject Read For SERP');
  const buildSubjectUpdate = byName('Build Subject Reference Update');

  assert.deepEqual(chatInput?.runtime?.mode, ['input', 'context']);
  assert.deepEqual(pendingPlan?.runtime?.mode, ['pending']);
  assert.equal(pendingStore?.runtime?.pendingAction, 'store');
  assert.equal(pendingClear?.runtime?.pendingAction, 'clear');
  assert.equal(planner?.runtime?.confirmationPolicy, 'mutations-only');
  assert.equal(confirmedPlanner?.runtime?.confirmedWithoutPendingBehavior, 'no-pending');
  assert.equal(validateCypher?.runtime?.cypherInputSource, 'plan-action');
  assert.equal(workflowTool?.runtime?.definitionSource, 'cypher');
  assert.equal(governor?.runtime?.executionMode, 'plan-only');
  assert.equal(executeGovernor?.runtime?.executionMode, 'execute-plan');
  assert.equal(Boolean(byName('Intent')), false);
  assert.equal(json.includes('analyze_chat_history_intent'), false);
  assert.equal(json.includes('loop-over-items'), false);

  assert.match(
    String(governor?.runtime?.selectionPromptMd || ''),
    /Requests to create a workflow and run it, including typo-heavy variants like ouput\/output, must plan Workflow followed by Execute Workflow/i,
  );
  assert.match(String(governor?.runtime?.selectionPromptMd || ''), /put the full executable Workflow Cypher in input\.cypher/i);
  assert.doesNotMatch(String(governor?.runtime?.selectionPromptMd || ''), /input\.workflowPrompt/i);
  assert.match(String(responseContext?.runtime?.code || ''), /workflow_output/);
  assert.match(String(responseDraft?.runtime?.code || ''), /Return the executed workflow output exactly as provided/);

  assert.ok(textAnalysis);
  assert.ok(governorInput);
  assert.ok(referenceGate);
  assert.ok(readSubject);
  assert.ok(buildSubjectUpdate);
  assert.ok(normalizeActions);
  assert.ok(executeGovernor);
  assert.ok(workflowTool);
  assert.ok(executeWorkflowTool);
  assert.ok(responseFormat);
  assert.ok(linked(chatInput?.id, byName('Build Planner Message Correction Input')?.id));
  assert.ok(linked(byName('Chat Input')?.id, byName('Merge Chat Analysis Input')?.id));
  assert.ok(linked(byName('Merge Chat Analysis Input')?.id, textAnalysis?.id));
  assert.ok(linked(textAnalysis?.id, byName('Confirmed?')?.id));
  assert.ok(linked(byName('Confirmed?')?.id, pendingPlan?.id, 'out:true'));
  assert.ok(linked(referenceGate?.id, readSubject?.id, 'out:true'));
  assert.ok(linked(referenceGate?.id, governorInput?.id, 'out:false'));
  assert.ok(linked(governorInput?.id, governor?.id));
  assert.ok(linked(governor?.id, byName('Repair Planned Workflow Cypher')?.id));
  assert.ok(linked(byName('Repair Planned Workflow Cypher')?.id, byName('Merge Planned Branches')?.id));
  assert.ok(linked(validateCypher?.id, byName('Merge Plan And Validation')?.id));
  assert.ok(linked(byName('Merge Execution Routes')?.id, normalizeActions?.id));
  assert.ok(linked(normalizeActions?.id, executeGovernor?.id));
  assert.ok(linked(executeGovernor?.id, pendingClear?.id));
  assert.ok(linked(responseContext?.id, responseDraft?.id));
  assert.ok(linked(responseDraft?.id, formatInput?.id));
  assert.ok(linked(formatInput?.id, formatGate?.id));
  assert.ok(linked(formatGate?.id, prepareAiFormat?.id, 'out:true'));
  assert.ok(linked(prepareAiFormat?.id, responseFormat?.id));
  assert.ok(linked(formatGate?.id, mergeResponsePayload?.id, 'out:false'));
  assert.ok(linked(responseFormat?.id, mergeResponsePayload?.id));

  for (const modelId of actionIds) {
    assert.ok(
      edges.some(
        (edge) =>
          nodes.find((node) => node.id === edge.from)?.modelId === modelId &&
          nodes.find((node) => node.id === edge.to)?.modelId === 'action-router' &&
          edge.targetHandle === 'cmd:actions',
      ),
      `${modelId} must be exposed to an Action Router`,
    );
  }
  for (const routerName of ['Channel Actions', 'Category Actions', 'Subject Actions', 'Post Actions', 'User Tree Actions', 'Chat Actions']) {
    const router = byName(routerName);
    assert.ok(router, `${routerName} is missing`);
    assert.ok(linked(router?.id, governor?.id, 'cmd:command'));
    assert.ok(linked(router?.id, executeGovernor?.id, 'cmd:command'));
  }
  assert.ok(linked(workflowTool?.id, governor?.id, 'cmd:command'));
  assert.ok(linked(workflowTool?.id, executeGovernor?.id, 'cmd:command'));
  assert.ok(linked(executeWorkflowTool?.id, governor?.id, 'cmd:command'));
  assert.ok(linked(executeWorkflowTool?.id, executeGovernor?.id, 'cmd:command'));
  assert.equal(Boolean(byName('Greeting Workflow Request?')), false);
  assert.equal(Boolean(byName('Build Greeting Workflow Plan')), false);
  assert.equal(json.includes('greeting_workflow_patch'), false);
});
