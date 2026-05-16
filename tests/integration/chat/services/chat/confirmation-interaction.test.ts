import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmationMarkdown, normalizePendingPlan } from '../../../src/services/chat/actions/runtime/confirmation';
import { buildConfirmationInteraction } from '../../../src/services/chat/actions/runtime/interaction';
import type { AgentExecutionPlan } from '@giga/shared/types/contracts/agent.types';

const plan: AgentExecutionPlan = {
  intent: 'Create and execute a hello world workflow.',
  actions: [
    {
      id: 'create-1',
      name: 'create_workflow_from_cypher',
      reason: 'Create a validated workflow.',
      input: {
        cypher: '(start:start {"name":"Start"})',
      },
    },
    {
      id: 'execute-1',
      name: 'execute_workflow',
      reason: 'Run the created workflow.',
      depends_on: ['create-1'],
    },
  ],
};

test('confirmation interaction carries confirm action and collapsed workflow cypher', () => {
  const interaction = buildConfirmationInteraction(plan, {
    workflowCypher: '(start:start {"name":"Start"})',
    workflowValidation: { ok: true },
  });

  assert.equal(interaction.kind, 'confirmation');
  assert.equal(
    interaction.options.some((option) => option.message === 'confirm'),
    true,
  );
  assert.equal(
    interaction.options.some((option) => option.message === 'cancel'),
    true,
  );
  assert.equal(interaction.selection?.mode, 'multi');
  assert.equal((interaction.selection?.options || []).length, 2);
  assert.equal(
    interaction.options.some((option) => option.id === 'expand-plan'),
    false,
  );
  assert.equal(interaction.free_text, null);
  assert.equal(
    interaction.sections?.some((section) => section.id === 'workflow-cypher' && section.default_collapsed === true),
    true,
  );
  assert.equal(
    interaction.sections?.some((section) => section.id === 'workflow-validation' && section.content.includes('"ok": true')),
    true,
  );
});

test('confirmation markdown does not expose workflow cypher', () => {
  const markdown = confirmationMarkdown(plan);

  assert.equal(markdown.includes('```cypher'), false);
  assert.equal(markdown.includes('(start:start'), false);
  assert.match(markdown, /Reply with `confirm`/);
  assert.match(markdown, /`cancel`/);
});

test('confirmation interaction deduplicates identical planned actions', () => {
  const duplicatePlan: AgentExecutionPlan = {
    intent: 'Delete matching channels.',
    actions: [
      {
        id: 'a1',
        name: 'delete_channel',
        reason: { summary: 'Delete channels starting with debug.' } as any,
        input: { name_prefix: 'debug' },
      },
      {
        id: 'a2',
        name: 'delete_channel',
        reason: { summary: 'Delete channels starting with debug.' } as any,
        input: { name_prefix: 'debug' },
      },
    ],
  };
  const normalized = normalizePendingPlan(duplicatePlan);
  const interaction = buildConfirmationInteraction(duplicatePlan);
  const markdown = confirmationMarkdown(duplicatePlan);

  assert.equal(normalized.actions.length, 1);
  assert.equal(interaction.selection?.options.length, 1);
  assert.match(interaction.selection?.options[0]?.label || '', /starting with "debug"/);
  assert.equal(markdown.match(/delete channel/g)?.length, 1);
  assert.equal(markdown.includes('[object Object]'), false);
});
