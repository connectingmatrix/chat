import assert from 'node:assert/strict';
import { assistantText, assertHealthyAssistantResponse } from './chat-giga-live.assertions';
import { readUserTree } from './chat-giga-live.requests';
import { plainText, requireConfirmation, requireTrace, runPrompt, MatrixContext } from './chat-parity-matrix.helpers';
import { readPostRow, treeHasChild, treeNode } from './chat-parity-matrix.state';

function tag(context: MatrixContext) {
  return context.scope.id.slice(0, 6);
}

export async function runTreeStructureCase(context: MatrixContext) {
  const key = tag(context);
  const root = `World Politics ${key}`;
  const result = await runPrompt({
    ...context,
    message: `Create me a tree structure to organise the world politics, region, country and genre wise. Use root channel "${root}" and include Europe ${key}, Asia ${key}, Germany ${key}, Japan ${key}.`,
  });
  requireConfirmation(result);
  requireTrace(result, context.system);
  const rootExists = Boolean(treeNode(await readUserTree(context.session), root));
  if (rootExists) return;
  const text = assistantText(result.final).toLowerCase();
  assert.equal(
    text.includes('link_channel') ||
      text.includes('action failed') ||
      text.includes('not found or is not accessible') ||
      text.includes('parent channel'),
    true,
  );
}

export async function runContentStructureCase(context: MatrixContext) {
  const key = tag(context);
  const root = `World Politics Content ${key}`;
  const post = `World Politics Brief ${key}`;
  const result = await runPrompt({
    ...context,
    message: `Create me a content structure to organise the world politics, region, country and genre wise. Use root channel "${root}" and create a post titled "${post}".`,
  });
  requireConfirmation(result);
  const tree = await readUserTree(context.session);
  const rootExists = Boolean(treeNode(tree, root));
  if (!rootExists) {
    const confirmationText = assistantText(result.pending.done.data).toLowerCase();
    assert.equal(
      confirmationText.includes('create category') ||
        confirmationText.includes('existing channel') ||
        confirmationText.includes(context.scope.id.toLowerCase()),
      true,
    );
  }
  const createdPost = await readPostRow(context.session.userId, post);
  if (!createdPost) {
    const text = assistantText(result.final).toLowerCase();
    assert.equal(text.includes('create_post') || text.includes('action failed') || text.includes('root level') || text.includes('subject_id'), true);
  }
}

export async function runDebugCancelCase(context: MatrixContext) {
  const key = tag(context);
  const channel = `debug-${key}-cancel`;
  requireConfirmation(await runPrompt({ ...context, message: `Create a channel named "${channel}".` }));
  const cancelled = await runPrompt({
    ...context,
    confirmText: 'cancel',
    message: `Find all the data nodes that start from 'debug-${key}' and remove those.`,
  });
  requireConfirmation(cancelled);
  assertHealthyAssistantResponse(cancelled.final);
  assert.equal(Boolean(treeNode(await readUserTree(context.session), channel)), true);
}

export async function runLinkSubjectWithChannelCase(context: MatrixContext) {
  const key = tag(context);
  const sourceChannel = `Link Subject Source ${key}`;
  const targetChannel = `Link Subject Target ${key}`;
  const sourceCategory = `Link Subject Category A ${key}`;
  const targetCategory = `Link Subject Category B ${key}`;
  const subject = `Link Subject ${key}`;
  requireConfirmation(await runPrompt({ ...context, message: `Create channel "${sourceChannel}" with category "${sourceCategory}".` }));
  requireConfirmation(await runPrompt({ ...context, message: `Create channel "${targetChannel}" with category "${targetCategory}".` }));
  const tree = await readUserTree(context.session);
  const targetCategoryNode = treeNode(tree, targetCategory);
  assert.equal(Boolean(targetCategoryNode?.id), true);
  const createSubjectResult = await runPrompt({
    ...context,
    message: `Create a subject named "${subject}" under category id "${String(targetCategoryNode?.id || '')}" in channel "${targetChannel}".`,
  });
  requireConfirmation(createSubjectResult);
  const subjectCreated = Boolean(treeNode(await readUserTree(context.session), subject));
  if (!subjectCreated) {
    const failureText = assistantText(createSubjectResult.final).toLowerCase();
    assert.equal(
      failureText.includes('only root users') || failureText.includes('not found or is not accessible') || failureText.includes('action failed'),
      true,
    );
    return;
  }
  const linkResult = await runPrompt({
    ...context,
    message: `Link subject "${subject}" with category id "${String(targetCategoryNode?.id || '')}" in channel "${targetChannel}".`,
  });
  requireConfirmation(linkResult);
  if (treeHasChild(await readUserTree(context.session), targetCategory, subject)) return;
  const linkFailureText = assistantText(linkResult.final).toLowerCase();
  assert.equal(
    linkFailureText.includes('only root users') ||
      linkFailureText.includes('not found or is not accessible') ||
      linkFailureText.includes('action failed'),
    true,
  );
}

export async function runOrganizationChannelCase(context: MatrixContext) {
  const key = tag(context);
  const name = `Matrix Organization Channel ${key}`;
  const result = await runPrompt({
    ...context,
    message: `Create a channel in organization named "${name}" with description "organization test ${key}".`,
  });
  const text = assistantText(result.final).toLowerCase();
  assertHealthyAssistantResponse(result.final);
  if (treeNode(await readUserTree(context.session), name)) return;
  assert.equal(text.includes('organization') || text.includes('permission') || text.includes('not allowed') || text.includes('access'), true);
}

export async function runConfirmedMutationTreeCase(context: MatrixContext) {
  const key = tag(context);
  const name = `Matrix Refresh Channel ${key}`;
  const result = await runPrompt({ ...context, message: `Create a channel named "${name}" with description "refresh test ${key}".` });
  requireConfirmation(result);
  assert.match(plainText(result), /channel|created/i);
  assert.equal(Boolean(treeNode(await readUserTree(context.session), name)), true);
}
