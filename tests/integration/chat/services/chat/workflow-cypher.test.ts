import test from 'node:test';
import assert from 'node:assert/strict';
import { Executor } from '@workflow/executor';
import { executeWorkflow } from '@connectingmatrix/nodes/services/workflow/executor';
import { GIGA_ACTION_CATALOG, getReadOnlyGigaActionCatalog, isMutatingAction } from '../../../src/services/chat/actions';
import { hasWorkflowEditIntent, isWorkflowAuthoringMessage } from '../../../src/services/chat/runtime/workflow-plan';

const helloCypher = [
  '(start:start {"name":"Start","runtime":{}})',
  '(hello:code {"name":"Hello World","runtime":{"code":"return \\"hello world\\";"}})',
  '(end:respond-end {"name":"Respond End","runtime":{"response":"{{hello.output}}"}})',
  '(start)-[:CONNECT {"source":"out:output","target":"in:input"}]->(hello)',
  '(hello)-[:CONNECT {"source":"out:output","target":"in:input"}]->(end)',
].join('\n');

const governorCypher = [
  '(start:start {"name":"Start","runtime":{}})',
  '(governor:ai-governor {"name":"AI Governor","runtime":{"selectionPromptMd":"Ask the connected LLM to return hello from ai governor."}})',
  '(openai:openai {"name":"OpenAI","runtime":{"model":"gpt-4.1-mini","prompt":"Return exactly: hello from ai governor","temperature":0}})',
  '(end:respond-end {"name":"Respond End","runtime":{"response":"{{governor.output}}"}})',
  '(start)-[:CONNECT {"source":"out:output","target":"in:input"}]->(governor)',
  '(governor)-[:CONNECT {"source":"out:output","target":"in:input"}]->(end)',
  '(openai)-[:CONNECT {"source":"cmd:command","target":"cmd:llm"}]->(governor)',
].join('\n');

test('workflow cypher compiles a connected hello world workflow', () => {
  const result = Executor.compileWorkflowCypher({ cypher: helloCypher, name: 'Hello World' });
  assert.equal(result.validation.ok, true);
  assert.deepEqual(
    result.workflow.nodes.map((node) => node.modelId),
    ['start', 'code', 'respond-end'],
  );
  assert.equal(result.workflow.connections.length, 2);
  assert.equal(Boolean(result.workflow.nodeModels?.code), true);
  assert.equal(Boolean(result.workflow.NODE_EXECUTORS?.code), true);
});

test('workflow cypher hello world executes through respond-end', async () => {
  const compiled = Executor.compileWorkflowCypher({ cypher: helloCypher, name: 'Hello World' });
  const result = await executeWorkflow(
    compiled.workflow as any,
    {
      settings: { graphqlUrl: '', authMode: 'none', manualHeaders: {} },
      hostContext: {},
      logger: { entries: [], push() {} },
      requestContext: { request: { headers: {} } as any, supabase: {} as any, userId: 'test-user' },
    } as any,
  );
  const endNode = result.workflow.nodes.find((node: any) => node.modelId === 'respond-end') as any;
  assert.equal(endNode?.ports?.out?.output, 'hello world');
});

test('workflow cypher rejects unsupported AI Governor node models', () => {
  assert.throws(() => Executor.compileWorkflowCypher({ cypher: governorCypher, name: 'AI Governor Hello' }), /Unknown node model "ai-governor"/i);
});

test('workflow cypher rejects missing terminal node', () => {
  const result = Executor.compileWorkflowCypher({
    cypher: ['(start:start {"runtime":{}})', '(hello:code {"runtime":{"code":"return 1;"}})', '(start)-[:CONNECT]->(hello)'].join('\n'),
    name: 'Missing End',
  });
  assert.equal(result.validation.ok, false);
  assert.equal(
    result.validation.errors.some((error) => error.includes('respond-end')),
    true,
  );
});

test('workflow cypher rejects runtime artifacts', () => {
  const result = Executor.compileWorkflowCypher({
    cypher: [
      '(start:start {"runtime":{}})',
      '(hello:code {"runtime":{"code":"return 1;","NODE_EXECUTORS":{}}})',
      '(end:respond-end {"runtime":{"response":"{{hello.output}}"}})',
      '(start)-[:CONNECT]->(hello)',
      '(hello)-[:CONNECT]->(end)',
    ].join('\n'),
    name: 'Artifacts',
  });
  assert.equal(result.validation.ok, false);
  assert.equal(
    result.validation.errors.some((error) => error.includes('NODE_EXECUTORS')),
    true,
  );
});

test('workflow cypher actions are cataloged with the correct mutability', () => {
  const names = new Set(GIGA_ACTION_CATALOG.map((action) => action.name));
  const readOnly = new Set(getReadOnlyGigaActionCatalog().map((action) => action.name));
  assert.equal(readOnly.has('fetch_workflow_node_catalog'), true);
  assert.equal(readOnly.has('fetch_workflow_node_details'), true);
  assert.equal(readOnly.has('validate_workflow_cypher'), true);
  assert.equal(names.has('create_workflow_from_cypher'), true);
  assert.equal(names.has('create_workflow'), false);
  assert.equal(isMutatingAction('create_workflow_from_cypher'), true);
});

test('workflow edit and execute prompt routes to authoring instead of execution-only follow-up', () => {
  const message = 'can you write a fibonacci code in the recent workflow and execute it and give me output';
  assert.equal(hasWorkflowEditIntent(message), true);
  assert.equal(isWorkflowAuthoringMessage(message), true);
});
