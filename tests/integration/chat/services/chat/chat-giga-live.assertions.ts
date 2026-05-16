import assert from 'node:assert/strict';
import { CreatedIds, hasNestedSubjects, setList, treeIds } from './chat-giga-live.ids';

const genericActions = new Set(['retrieve_db_chunks_and_analyze', 'search_web_with_tags', 'summarize_recent_messages']);
const genericFailurePatterns = [/sorry, i encountered an error/i, /unexpected error occurred/i, /workflow completed with no output\./i];
const technicalFailurePatterns = [/planner/i, /fallback/i, /research fallback/i, /mutation was executed/i, /could not safely plan/i];

export function assistantText(response: any): string {
  return String(response?.answer?.text || response?.messages?.assistant?.content || '').trim();
}

export function assertHealthyAssistantResponse(response: any): string {
  const text = assistantText(response);
  assert.equal(Boolean(text), true, 'Expected a non-empty assistant response.');
  for (const pattern of genericFailurePatterns) assert.doesNotMatch(text, pattern);
  for (const pattern of technicalFailurePatterns) assert.doesNotMatch(text, pattern);
  return text;
}

export function assertConfirmationAgent(agent: any): void {
  assert.equal(agent?.requires_confirmation, true);
  assert.equal(agent?.response_format, 'confirmation_request');
  assert.equal((agent?.action_results || []).length, 0);
  assert.equal((agent?.pending_actions || []).length > 0, true);
  assert.equal(agent?.interaction?.kind, 'confirmation');
  assert.equal(
    (agent?.interaction?.options || []).some((option: any) => option.message === 'confirm'),
    true,
  );
  assert.equal(
    (agent?.interaction?.options || []).some((option: any) => option.id === 'expand-plan'),
    false,
  );
  assert.equal(agent?.interaction?.free_text, null);
  assert.equal(
    (agent?.pipeline_passes || []).some((pass: any) => pass.response_format === 'confirmation_request'),
    true,
  );

  let createChannel: any = null;
  let hasCategoryCreate = false;
  let hasSubjectCreate = false;
  for (const action of agent.pending_actions || []) {
    assert.equal(genericActions.has(action.name), false, `Unexpected generic action ${action.name}`);
    if (action.name === 'create_channel') createChannel = action;
    if (action.name === 'create_category') hasCategoryCreate = true;
    if (action.name === 'create_subject') hasSubjectCreate = true;
  }

  assert.equal(Boolean(createChannel) || (hasCategoryCreate && hasSubjectCreate), true, 'Expected Giga structure create actions.');
  if (!createChannel) return;
  assert.equal((createChannel.input?.categories || []).length > 0, true, 'Expected nested categories in create_channel input.');
  assert.equal(hasNestedSubjects(createChannel), true, 'Expected nested subjects in create_channel input.');
}

export function assertConfirmationText(response: any): void {
  const text = assertHealthyAssistantResponse(response);
  assert.match(text, /^I can make these Giga changes after you confirm:/);
  assert.match(text, /Reply with `confirm` to execute these actions(?: or `cancel` to abort)?\./);
}

export function assertCompletedAgent(agent: any): void {
  assert.equal(agent?.requires_confirmation, false);
  assert.equal(agent?.response_format, 'action_summary');
  assert.equal(agent?.pending_actions, null);
  assert.equal((agent?.action_results || []).length > 0, true);
  assert.equal(
    (agent?.pipeline_passes || []).some((pass: any) => pass.kind === 'confirmation_execution'),
    true,
  );

  for (const result of agent.action_results || []) {
    assert.equal(result.status, 'completed', result.error || result.summary);
  }
}

export function assertTreeHasCreated(tree: any, ids: CreatedIds): void {
  const present = treeIds(tree);
  for (const id of [...setList(ids.channels), ...setList(ids.categories), ...setList(ids.subjects)]) {
    assert.equal(present.has(id), true, `Expected live tree to contain ${id}`);
  }
}

export function assertPlainChatResponse(response: any): void {
  const text = assertHealthyAssistantResponse(response);
  assert.notEqual(response?.agent?.requires_confirmation, true);
  assert.notEqual(response?.agent?.response_format, 'workflow_output');
  assert.doesNotMatch(text, /^\s*\{/);
  assert.doesNotMatch(text, /"command"\s*:\s*null/i);
}

export function assertUnsupportedPostLinkResponse(response: any): string {
  const text = assertHealthyAssistantResponse(response);
  assert.notEqual(response?.agent?.requires_confirmation, true);
  assert.equal(response?.agent?.response_format === 'planning_failure' || response?.agent?.response_format === 'action_summary', true);
  assert.equal(
    /posts support create, read, update, and delete only/i.test(text) ||
      /need a little more detail/i.test(text) ||
      /include the exact names, targets, or ids/i.test(text) ||
      /action failed: read_post/i.test(text) ||
      /read post/i.test(text),
    true,
  );
  return text;
}
