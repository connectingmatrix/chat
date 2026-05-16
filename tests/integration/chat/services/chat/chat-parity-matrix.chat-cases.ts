import assert from 'node:assert/strict';
import { readUserTree } from './chat-giga-live.requests';
import { plainText, requireConfirmation, requireTrace, runPrompt, MatrixContext } from './chat-parity-matrix.helpers';
import { readPostRow, treeNode } from './chat-parity-matrix.state';

export async function runHelloCase(context: MatrixContext) {
  const hello = await runPrompt({ ...context, message: 'Hello', expectConfirmation: false });
  requireTrace(hello, context.system);
  plainText(hello);
}

export async function runHiCase(context: MatrixContext) {
  plainText(await runPrompt({ ...context, message: 'Hi', expectConfirmation: false }));
}

export async function runGeneralCase(context: MatrixContext) {
  const question = await runPrompt({ ...context, message: 'What can you help me with inside Giga Chat?', expectConfirmation: false });
  assert.equal(plainText(question).length > 0, true);
}

export async function runGigaCase(context: MatrixContext) {
  const giga = await runPrompt({
    ...context,
    message: 'How does Giga Chat help me organize channels, categories, subjects, posts, and workflows?',
    expectConfirmation: false,
  });
  assert.equal(plainText(giga).length > 0, true);
}

export async function runAdvancedCases(context: MatrixContext) {
  const tag = context.scope.id.slice(0, 6);
  const treeRoot = `World Politics ${tag}`;
  const contentRoot = `World Politics Content ${tag}`;
  const contentPost = `World Politics Brief ${tag}`;
  const treeCase = await runPrompt({
    ...context,
    message: `Create me a tree structure to organise the world politics, region, country and genre wise. Use root channel "${treeRoot}" and include Europe ${tag}, Asia ${tag}, Germany ${tag}, Japan ${tag}.`,
  });
  requireConfirmation(treeCase);
  requireTrace(treeCase, context.system);
  assert.equal(Boolean(treeNode(await readUserTree(context.session), treeRoot)), true);

  const contentCase = await runPrompt({
    ...context,
    message: `Create me a content structure to organise the world politics, region, country and genre wise. Use root channel "${contentRoot}" and create a post titled "${contentPost}".`,
  });
  requireConfirmation(contentCase);
  assert.equal(Boolean(treeNode(await readUserTree(context.session), contentRoot)), true);
  assert.equal(Boolean(await readPostRow(context.session.userId, contentPost)), true);
}
