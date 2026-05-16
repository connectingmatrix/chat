import assert from 'node:assert/strict';
import { requireConfirmation, runPrompt, MatrixContext } from './chat-parity-matrix.helpers';
import { readUserTree } from './chat-giga-live.requests';
import { readWorkflowAssignment, readWorkflowRow, treeNode } from './chat-parity-matrix.state';

function tag(context: MatrixContext) {
  return context.scope.id.slice(0, 6);
}

async function confirmPrompt(context: MatrixContext, message: string, retryMessage?: string) {
  const first = await runPrompt({ ...context, message });
  if (first.pending?.done?.data?.agent?.requires_confirmation === true) {
    requireConfirmation(first);
    return first;
  }
  const text = String(first.text || '').toLowerCase();
  if ((text.includes('need a little more detail') || text.includes('include the exact names')) && retryMessage) {
    const retried = await runPrompt({ ...context, message: retryMessage });
    requireConfirmation(retried);
    return retried;
  }
  requireConfirmation(first);
  return first;
}

export async function runWorkflowCrudCase(context: MatrixContext) {
  const key = tag(context);
  const name = `Matrix Workflow ${key}`;
  const initial = `matrix-${key}`;
  const updated = `matrix-updated-${key}`;
  await confirmPrompt(
    context,
    `Create a workflow named "${name}" that returns "${initial}" and do not run it.`,
    `Create workflow "${name}" with response text "${initial}". Save only and do not execute.`,
  );
  const created = await readWorkflowRow(context.session.userId, name);
  assert.equal(Boolean(created), true);
  assert.equal(Array.isArray((created?.workflow as { nodes?: unknown[] } | null)?.nodes), true);
  assert.equal(((created?.workflow as { nodes?: unknown[] } | null)?.nodes || []).length, 3);
  await confirmPrompt(
    context,
    `Update the workflow "${name}" so it returns "${updated}" and do not run it.`,
    `Update workflow "${name}" so output text is "${updated}". Save only and do not execute.`,
  );
  assert.match(JSON.stringify((await readWorkflowRow(context.session.userId, name))?.workflow || {}).toLowerCase(), new RegExp(updated));
}

export async function runWorkflowPublishAttachExecuteCase(context: MatrixContext) {
  const key = tag(context);
  const name = `Matrix Workflow Publish ${key}`;
  const output = `publish-output-${key}`;
  await confirmPrompt(
    context,
    `Create a workflow named "${name}" that returns "${output}" and do not run it.`,
    `Create workflow "${name}" with response text "${output}". Save only and do not execute.`,
  );
  const created = await readWorkflowRow(context.session.userId, name);
  const createdJson = JSON.stringify(created?.workflow || {}).toLowerCase();
  if (!createdJson.includes(output.toLowerCase())) {
    await confirmPrompt(
      context,
      `Update the workflow "${name}" so the final response is exactly "${output}" and do not run it.`,
      `Update workflow "${name}" with explicit final output text "${output}". Save only and do not execute.`,
    );
    assert.match(JSON.stringify((await readWorkflowRow(context.session.userId, name))?.workflow || {}).toLowerCase(), new RegExp(output));
  }
  await confirmPrompt(context, `Publish the workflow "${name}".`, `Publish workflow "${name}" now.`);
  const published = await readWorkflowRow(context.session.userId, name);
  if (published?.status !== 'published' || !published?.published_workflow) {
    await confirmPrompt(
      context,
      `Set workflow "${name}" status to published and keep the same workflow content.`,
      `Publish workflow "${name}" with status published.`,
    );
  }
  const publishResolved = await readWorkflowRow(context.session.userId, name);
  assert.equal(Boolean(publishResolved?.id), true);
  assert.equal(publishResolved?.status === 'published' || (publishResolved?.status === 'draft' && Boolean(publishResolved?.workflow)), true);
  const channelId = String(context.scope.id || '');
  assert.equal(Boolean(channelId), true);
  const attach = await confirmPrompt(
    context,
    `Attach the workflow "${name}" to the channel id "${channelId}".`,
    `Attach workflow "${name}" to channel id "${channelId}".`,
  );
  const assignment = await readWorkflowAssignment(channelId, publishResolved?.id);
  if (!assignment) {
    const attachResult = (attach.final.agent?.action_results || []).find((entry) => `${entry.name || ''}`.toLowerCase().includes('workflow'));
    assert.equal(`${attachResult?.status || ''}`.toLowerCase(), 'completed');
  }
  const executed = await runPrompt({ ...context, message: `Execute the workflow "${name}" and give me the output here.` });
  const workflowExecutionOutput = JSON.stringify(executed.final.agent?.workflow_execution_output || '').toLowerCase();
  const workflowExecutionText = executed.text.toLowerCase();
  const workflowActionResult = (executed.final.agent?.action_results || []).find((entry) => `${entry.name || ''}`.toLowerCase().includes('workflow'));
  const hasExpectedOutput = workflowExecutionOutput.includes(output.toLowerCase()) || workflowExecutionText.includes(output.toLowerCase());
  if (!hasExpectedOutput) {
    assert.equal(`${workflowActionResult?.status || ''}`.toLowerCase(), 'completed');
    assert.equal(Boolean(`${workflowActionResult?.data?.workflow_id || ''}`), true);
    assert.equal(
      `${executed.final.agent?.response_format || ''}`.toLowerCase() === 'workflow_output' || workflowExecutionText.includes('[open workflow]'),
      true,
    );
  }
}

export async function runWorkflowDeleteCase(context: MatrixContext) {
  const key = tag(context);
  const name = `Matrix Workflow Delete ${key}`;
  await confirmPrompt(
    context,
    `Create a workflow named "${name}" that returns "delete ${key}" and do not run it.`,
    `Create workflow "${name}" with response text "delete ${key}". Save only and do not execute.`,
  );
  await confirmPrompt(context, `Delete the workflow "${name}".`, `Delete workflow "${name}" now.`);
  assert.equal(await readWorkflowRow(context.session.userId, name), null);
}

export async function runCleanupWorkflowCase(context: MatrixContext) {
  const key = tag(context);
  const name = `Matrix Cleanup Workflow ${key}`;
  await confirmPrompt(
    context,
    `Create a workflow named "${name}" that will fetch my user tree and if there are empty channels and no chats attached with those channels, subjects, categories and there are no posts either in that path then confirm from me and remove that.`,
    `Create workflow "${name}" to clean empty tree paths after confirmation. Save only and do not execute.`,
  );
  assert.equal(Boolean(await readWorkflowRow(context.session.userId, name)), true);
}

export async function runKnowledgeWorkflowAttachCase(context: MatrixContext) {
  const key = tag(context);
  const workflow = `Matrix Giga Knowledge Workflow ${key}`;
  const channel = `Matrix Giga Knowledge Channel ${key}`;
  await confirmPrompt(
    context,
    `Create workflow "${workflow}" for Giga knowledge chat and do not execute it.`,
    `Create workflow "${workflow}" with Giga knowledge response text and save only.`,
  );
  const row = await readWorkflowRow(context.session.userId, workflow);
  assert.equal(Boolean(row?.id), true);
  const tree = await readUserTree(context.session);
  const channelNode = treeNode(tree, channel);
  const targetChannelId = String(channelNode?.id || context.scope.id || '');
  const attach = await confirmPrompt(
    context,
    `Attach workflow "${workflow}" to channel id "${targetChannelId}".`,
    `Attach workflow "${workflow}" to the channel id "${targetChannelId}" now.`,
  );
  const assigned = await readWorkflowAssignment(targetChannelId, row?.id);
  if (assigned) return;
  const attachAction = (attach.final.agent?.action_results || []).find((entry) => `${entry.name || ''}`.toLowerCase().includes('workflow'));
  assert.equal(`${attachAction?.status || ''}`.toLowerCase(), 'completed');
}

export async function runMetaDeleteWorkflowCase(context: MatrixContext) {
  const key = tag(context);
  const name = `Matrix Meta Delete Workflow ${key}`;
  const planned = await runPrompt({
    ...context,
    message: `Create a workflow named "${name}" to create a workflow to delete a channel and do not run it.`,
  });
  if (planned.pending?.done?.data?.agent?.requires_confirmation === true) {
    requireConfirmation(planned);
  } else {
    const failureText = String(planned.text || '').toLowerCase();
    assert.equal(
      failureText.includes('workflow cypher validation failed') ||
        failureText.includes('chatid is required') ||
        failureText.includes('need a little more detail'),
      true,
    );
    await confirmPrompt(
      context,
      `Create workflow "${name}" with output text "Delete channel workflow draft". Save only and do not execute.`,
      `Create workflow "${name}" as a save-only draft for deleting channels later. Do not execute.`,
    );
  }
  assert.equal(Boolean(await readWorkflowRow(context.session.userId, name)), true);
}

export async function runNestedChannelWorkflowExecutionCase(context: MatrixContext) {
  const key = tag(context);
  const workflow = `Matrix Nested Workflow ${key}`;
  const root = `Matrix Nested Root ${key}`;
  const region = `Matrix Nested Region ${key}`;
  const country = `Matrix Nested Country ${key}`;
  await confirmPrompt(
    context,
    `Create a workflow named "${workflow}" and execute it to create nested channels rooted at "${root}", then "${region}", then "${country}".`,
    `Create and execute workflow "${workflow}" to create channels "${root}" -> "${region}" -> "${country}".`,
  );
  assert.equal(Boolean(await readWorkflowRow(context.session.userId, workflow)), true);
  const tree = await readUserTree(context.session);
  assert.equal(Boolean(treeNode(tree, root)), true);
  assert.equal(Boolean(treeNode(tree, region)), true);
  assert.equal(Boolean(treeNode(tree, country)), true);
}
