import assert from 'node:assert/strict';
import { assertUnsupportedPostLinkResponse } from './chat-giga-live.assertions';
import { readUserTree } from './chat-giga-live.requests';
import { plainText, requireConfirmation, requireTrace, runPrompt, MatrixContext } from './chat-parity-matrix.helpers';
import { readPostRow, treeHasChild, treeNode } from './chat-parity-matrix.state';

function tag(context: MatrixContext) {
  return context.scope.id.slice(0, 6);
}

export async function runChannelCrudCase(context: MatrixContext) {
  const key = tag(context);
  const parent = `Matrix Channel Parent ${key}`;
  const child = `Matrix Channel Child ${key}`;
  const updated = `Matrix Channel Updated ${key}`;
  requireConfirmation(await runPrompt({ ...context, message: `Create a channel named "${parent}" with description "channel test ${key}".` }));
  const created = await runPrompt({ ...context, message: `Create a channel named "${child}" with description "child test ${key}".` });
  requireConfirmation(created);
  requireTrace(created, context.system);
  assert.match(
    plainText(await runPrompt({ ...context, message: `Tell me about the channel named "${parent}".`, expectConfirmation: false })),
    new RegExp(parent),
  );
  requireConfirmation(await runPrompt({ ...context, message: `Rename the channel "${child}" to "${updated}".` }));
  assert.equal(Boolean(treeNode(await readUserTree(context.session), updated)), true);
  requireConfirmation(await runPrompt({ ...context, message: `Delete the channel "${updated}".` }));
  assert.equal(Boolean(treeNode(await readUserTree(context.session), updated)), false);
}

export async function runChannelUnlinkCase(context: MatrixContext) {
  const key = tag(context);
  const parent = `Matrix Channel Link Parent ${key}`;
  const child = `Matrix Channel Link Child ${key}`;
  requireConfirmation(await runPrompt({ ...context, message: `Create a channel named "${parent}".` }));
  requireConfirmation(await runPrompt({ ...context, message: `Create a channel named "${child}".` }));
  requireConfirmation(await runPrompt({ ...context, message: `Link the channel "${child}" under the channel "${parent}".` }));
  assert.equal(treeHasChild(await readUserTree(context.session), parent, child), true);
  requireConfirmation(await runPrompt({ ...context, message: `Unlink the channel "${child}" from the channel "${parent}".` }));
  assert.equal(treeHasChild(await readUserTree(context.session), parent, child), false);
}

export async function runCategoryCrudCase(context: MatrixContext) {
  const key = tag(context);
  const channel = `Matrix Category Channel ${key}`;
  const category = `Matrix Category ${key}`;
  const updated = `Matrix Category Updated ${key}`;
  requireConfirmation(await runPrompt({ ...context, message: `Create a channel named "${channel}".` }));
  const channelNode = treeNode(await readUserTree(context.session), channel);
  const channelId = String(channelNode?.id || '');
  assert.equal(Boolean(channelId), true);
  requireConfirmation(
    await runPrompt({ ...context, message: `Create a category named "${category}" under channel id "${channelId}" (channel "${channel}").` }),
  );
  assert.match(
    plainText(await runPrompt({ ...context, message: `What is the category named "${category}"?`, expectConfirmation: false })),
    new RegExp(category),
  );
  requireConfirmation(await runPrompt({ ...context, message: `Rename the category "${category}" to "${updated}".` }));
  requireConfirmation(await runPrompt({ ...context, message: `Delete the category "${updated}".` }));
  assert.equal(Boolean(treeNode(await readUserTree(context.session), updated)), false);
}

export async function runCategoryUnlinkCase(context: MatrixContext) {
  const key = tag(context);
  const channelA = `Matrix Category Channel A ${key}`;
  const channelB = `Matrix Category Channel B ${key}`;
  const category = `Matrix Category Link ${key}`;
  requireConfirmation(await runPrompt({ ...context, message: `Create a channel named "${channelA}".` }));
  requireConfirmation(await runPrompt({ ...context, message: `Create a channel named "${channelB}".` }));
  const createdTree = await readUserTree(context.session);
  const channelANode = treeNode(createdTree, channelA);
  const channelBNode = treeNode(createdTree, channelB);
  const channelAId = String(channelANode?.id || '');
  const channelBId = String(channelBNode?.id || '');
  assert.equal(Boolean(channelAId), true);
  assert.equal(Boolean(channelBId), true);
  requireConfirmation(
    await runPrompt({
      ...context,
      message: `Create a category named "${category}" under channel id "${channelAId}" (channel "${channelA}").`,
    }),
  );
  const categoryNode = treeNode(await readUserTree(context.session), category);
  const categoryId = String(categoryNode?.id || '');
  assert.equal(Boolean(categoryId), true);
  requireConfirmation(
    await runPrompt({
      ...context,
      message: `Link category id "${categoryId}" ("${category}") to channel id "${channelBId}" ("${channelB}").`,
    }),
  );
  assert.equal(treeHasChild(await readUserTree(context.session), channelB, category), true);
  requireConfirmation(
    await runPrompt({
      ...context,
      message: `Unlink category id "${categoryId}" ("${category}") from channel id "${channelBId}" ("${channelB}").`,
    }),
  );
  assert.equal(treeHasChild(await readUserTree(context.session), channelB, category), false);
}

export async function runSubjectCrudCase(context: MatrixContext) {
  const key = tag(context);
  const channel = `Matrix Subject Channel ${key}`;
  const category = `Matrix Subject Category ${key}`;
  const subject = `Matrix Subject ${key}`;
  const updated = `Matrix Subject Updated ${key}`;
  requireConfirmation(await runPrompt({ ...context, message: `Create a channel named "${channel}".` }));
  const channelNode = treeNode(await readUserTree(context.session), channel);
  const channelId = String(channelNode?.id || '');
  assert.equal(Boolean(channelId), true);
  requireConfirmation(
    await runPrompt({ ...context, message: `Create a category named "${category}" under channel id "${channelId}" (channel "${channel}").` }),
  );
  const categoryNode = treeNode(await readUserTree(context.session), category);
  const categoryId = String(categoryNode?.id || '');
  assert.equal(Boolean(categoryId), true);
  requireConfirmation(
    await runPrompt({ ...context, message: `Create a subject named "${subject}" under category id "${categoryId}" (category "${category}").` }),
  );
  assert.match(
    plainText(await runPrompt({ ...context, message: `Read the subject named "${subject}".`, expectConfirmation: false })),
    new RegExp(subject),
  );
  requireConfirmation(await runPrompt({ ...context, message: `Rename the subject "${subject}" to "${updated}".` }));
  requireConfirmation(await runPrompt({ ...context, message: `Delete the subject "${updated}".` }));
  assert.equal(Boolean(treeNode(await readUserTree(context.session), updated)), false);
}

export async function runSubjectUnlinkCase(context: MatrixContext) {
  const key = tag(context);
  const channel = `Matrix Subject Link Channel ${key}`;
  const categoryA = `Matrix Subject Link Category A ${key}`;
  const categoryB = `Matrix Subject Link Category B ${key}`;
  const subject = `Matrix Subject Link ${key}`;
  requireConfirmation(await runPrompt({ ...context, message: `Create a channel named "${channel}".` }));
  const channelNode = treeNode(await readUserTree(context.session), channel);
  const channelId = String(channelNode?.id || '');
  assert.equal(Boolean(channelId), true);
  requireConfirmation(
    await runPrompt({ ...context, message: `Create a category named "${categoryA}" under channel id "${channelId}" (channel "${channel}").` }),
  );
  requireConfirmation(
    await runPrompt({ ...context, message: `Create a category named "${categoryB}" under channel id "${channelId}" (channel "${channel}").` }),
  );
  const treeAfterCategories = await readUserTree(context.session);
  const categoryANode = treeNode(treeAfterCategories, categoryA);
  const categoryBNode = treeNode(treeAfterCategories, categoryB);
  const categoryAId = String(categoryANode?.id || '');
  const categoryBId = String(categoryBNode?.id || '');
  assert.equal(Boolean(categoryAId), true);
  assert.equal(Boolean(categoryBId), true);
  requireConfirmation(
    await runPrompt({ ...context, message: `Create a subject named "${subject}" under category id "${categoryAId}" (category "${categoryA}").` }),
  );
  const subjectNode = treeNode(await readUserTree(context.session), subject);
  const subjectId = String(subjectNode?.id || '');
  assert.equal(Boolean(subjectId), true);
  requireConfirmation(
    await runPrompt({ ...context, message: `Link subject id "${subjectId}" ("${subject}") to category id "${categoryBId}" ("${categoryB}").` }),
  );
  assert.equal(treeHasChild(await readUserTree(context.session), categoryB, subject), true);
  requireConfirmation(
    await runPrompt({ ...context, message: `Unlink subject id "${subjectId}" ("${subject}") from category id "${categoryBId}" ("${categoryB}").` }),
  );
  assert.equal(treeHasChild(await readUserTree(context.session), categoryB, subject), false);
}

export async function runPostCrudCase(context: MatrixContext) {
  const key = tag(context);
  const channel = `Matrix Post Channel ${key}`;
  const category = `Matrix Post Category ${key}`;
  const subjectA = `Matrix Post Subject A ${key}`;
  const subjectB = `Matrix Post Subject B ${key}`;
  const post = `Matrix Post ${key}`;
  const updated = `Matrix Post Updated ${key}`;
  requireConfirmation(await runPrompt({ ...context, message: `Create a channel named "${channel}".` }));
  const channelNode = treeNode(await readUserTree(context.session), channel);
  const channelId = String(channelNode?.id || '');
  assert.equal(Boolean(channelId), true);
  requireConfirmation(
    await runPrompt({ ...context, message: `Create a category named "${category}" under channel id "${channelId}" (channel "${channel}").` }),
  );
  const categoryNode = treeNode(await readUserTree(context.session), category);
  const categoryId = String(categoryNode?.id || '');
  assert.equal(Boolean(categoryId), true);
  requireConfirmation(
    await runPrompt({ ...context, message: `Create a subject named "${subjectA}" under category id "${categoryId}" (category "${category}").` }),
  );
  requireConfirmation(
    await runPrompt({ ...context, message: `Create a subject named "${subjectB}" under category id "${categoryId}" (category "${category}").` }),
  );
  const treeAfterSubjects = await readUserTree(context.session);
  const subjectANode = treeNode(treeAfterSubjects, subjectA);
  const subjectBNode = treeNode(treeAfterSubjects, subjectB);
  const subjectAId = String(subjectANode?.id || '');
  const subjectBId = String(subjectBNode?.id || '');
  assert.equal(Boolean(subjectAId), true);
  assert.equal(Boolean(subjectBId), true);
  requireConfirmation(
    await runPrompt({
      ...context,
      message: `Create a post titled "${post}" under subject id "${subjectAId}" (subject "${subjectA}") with narrative "post test ${key}".`,
    }),
  );
  assert.equal(Boolean(await readPostRow(context.session.userId, post)), true);
  assert.match(plainText(await runPrompt({ ...context, message: `Read the post titled "${post}".`, expectConfirmation: false })), new RegExp(post));
  requireConfirmation(
    await runPrompt({ ...context, message: `Rename the post titled "${post}" to "${updated}" and change the narrative to "updated ${key}".` }),
  );
  requireConfirmation(
    await runPrompt({ ...context, message: `Move the post titled "${updated}" to subject id "${subjectBId}" (subject "${subjectB}").` }),
  );
  assert.equal(String((await readPostRow(context.session.userId, updated))?.subject_id || '').length > 0, true);
  requireConfirmation(await runPrompt({ ...context, message: `Delete the post titled "${updated}".` }));
  assert.equal(Boolean(await readPostRow(context.session.userId, updated)), false);
}

export async function runPostUnsupportedLinkCase(context: MatrixContext) {
  const key = tag(context);
  const subjectA = `Matrix Post Link Subject A ${key}`;
  const subjectB = `Matrix Post Link Subject B ${key}`;
  const post = `Matrix Post Link ${key}`;
  assertUnsupportedPostLinkResponse(
    (
      await runPrompt({
        ...context,
        message: `Link the post titled "${post}" to the subject "${subjectB}". This operation is unsupported for posts; do not perform mutations.`,
        expectConfirmation: false,
      })
    ).final,
  );
  assertUnsupportedPostLinkResponse(
    (
      await runPrompt({
        ...context,
        message: `Unlink the post titled "${post}" from the subject "${subjectA}". This operation is unsupported for posts; do not perform mutations.`,
        expectConfirmation: false,
      })
    ).final,
  );
}
