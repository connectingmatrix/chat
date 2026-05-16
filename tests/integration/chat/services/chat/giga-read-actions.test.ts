import test from 'node:test';
import assert from 'node:assert/strict';
import { GIGA_ACTION_CATALOG, getReadOnlyGigaActionCatalog, isGigaAction, isMutatingAction } from '../../../src/services/chat/actions';
import { GIGA_ACTION_NAMES, MUTATING_GIGA_ACTIONS, READ_GIGA_ACTIONS } from '../../../src/services/chat/actions/telemetry/catalog';

const readActions = [
  'fetch_all_workflows',
  'fetch_workflow',
  'fetch_workflow_runs',
  'fetch_workflow_revisions',
  'fetch_workflow_node_catalog',
  'fetch_workflow_node_details',
  'validate_workflow_cypher',
  'read_channel',
  'read_category',
  'read_subject',
  'read_post',
  'read_attachments',
];

test('Giga read actions are cataloged as non-mutating', () => {
  const byName = new Map(GIGA_ACTION_CATALOG.map((action) => [action.name, action]));
  const readOnlyNames = new Set(getReadOnlyGigaActionCatalog().map((action) => action.name));

  for (const name of readActions) {
    assert.equal(Boolean(byName.get(name as any)), true, `${name} missing from catalog`);
    assert.equal(isMutatingAction(name as any), false, `${name} must not be confirmation-gated`);
    assert.equal(readOnlyNames.has(name as any), true, `${name} missing from read-only catalog`);
  }
});

test('Giga workflow execution remains mutating', () => {
  assert.equal(isMutatingAction('execute_workflow'), true);
  assert.equal(
    getReadOnlyGigaActionCatalog().some((action) => action.name === 'execute_workflow'),
    false,
  );
});

test('Giga action detection returns true only for registered actions', () => {
  assert.equal(isGigaAction('read_channel'), true);
  assert.equal(isGigaAction('execute_workflow'), true);
  assert.equal(isGigaAction('not_a_real_action' as never), false);
  assert.equal(READ_GIGA_ACTIONS.size > 0, true);
  assert.equal(MUTATING_GIGA_ACTIONS.size > 0, true);
  assert.equal(GIGA_ACTION_NAMES.has('read_channel'), true);
});
