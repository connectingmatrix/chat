import test from 'node:test';
import assert from 'node:assert/strict';
import { openai } from '@giga/shared/services/common/openai-client';
import { createWorkflowAuthoringPlan } from '../../../src/services/chat/runtime/workflow-plan';
import type { AgentActionDefinition } from '@giga/shared/types/contracts/agent.types';

const workflowActions: AgentActionDefinition[] = [
  { name: 'create_workflow_from_cypher' as any, description: 'Create from Cypher.', input_schema: {}, mutating: true },
  { name: 'execute_workflow' as any, description: 'Execute workflow.', input_schema: {}, mutating: true },
];

test('workflow authoring repairs empty planning results without canned workflow output', async () => {
  const originalCreate = openai.responses.create;
  const calls: string[] = [];
  (openai.responses as any).create = async (input: any) => {
    calls.push(String(input.input || ''));
    if (calls.length === 1) return { output_text: '{"intent":"No action","actions":[]}' };
    return {
      output_text: JSON.stringify({
        intent: 'Create and run requested workflow.',
        actions: [
          {
            id: 'a1',
            name: 'create_workflow_from_cypher',
            reason: 'Create workflow from the user request.',
            input: {
              name: 'Requested Workflow',
              cypher:
                '(start:start {"name":"Start","runtime":{}})\n(code:code {"name":"Build Output","runtime":{"code":"return { text: \\"ready\\" };"}})\n(end:respond-end {"name":"Respond End","runtime":{"response":"{{code.output}}"}})\n(start)-[:CONNECT {"source":"out:output","target":"in:input"}]->(code)\n(code)-[:CONNECT {"source":"out:output","target":"in:input"}]->(end)',
            },
          },
          { id: 'a2', name: 'execute_workflow', reason: 'Run the created workflow.', input: { workflow_action_id: 'a1' }, depends_on: ['a1'] },
        ],
      }),
    };
  };

  try {
    const plan = await createWorkflowAuthoringPlan({
      message: 'Publish the recent workflow after adding a response node for my request',
      availableActions: workflowActions,
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[1].includes('Repair reason: No valid workflow action was selected.'), true);
    assert.equal(plan.actions[0].name, 'create_workflow_from_cypher');
    assert.equal(plan.actions[1].name, 'execute_workflow');
    assert.equal(String(plan.actions[0].input?.cypher || '').includes('World Politics'), false);
  } finally {
    openai.responses.create = originalCreate;
  }
});
