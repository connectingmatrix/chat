import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SupabaseClientAdmin } from '@giga/general/decorators/integration/supabase-admin-client';
import { CHAT_PARITY_VARIANTS, chatParityVariant, type ChatParityVariant } from '@connectingmatrix/chat/services/chat/workflow/runtime/chat-parity-fixtures';
import { closeLiveSession, LiveSession, openChatSocket, readLiveSession, socketChat } from './chat-giga-live.fixture';
import { createdIds } from './chat-giga-live.ids';
import { sendChatSend } from './chat-giga-live.requests';
import { LIVE_CHAT_PORT } from './chat-giga-live.queries';

export const DEBUG_CHAT_PARITY_EMAIL = 'rich@gigaintelligence.com';
export const DEBUG_CHAT_PARITY_CHANNEL_ID = 'be15f071-c3b9-41b9-84bb-0e51d3d46ade';
export const DEBUG_CHAT_PARITY_AI_AGENT_CHANNEL_ID = 'f45712dd-8bad-4ac8-8101-38c346ea6dd0';
export const DEBUG_CHAT_PARITY_MESSAGE =
  'Create me workflow that will greet me hello rich how are you and run that workflow and give me the ouput here';
export const DEBUG_CHAT_PARITY_WORKFLOW_NAME = CHAT_PARITY_VARIANTS.legacy.workflowName;
export const DEBUG_CHAT_PARITY_AI_AGENT_WORKFLOW_NAME = CHAT_PARITY_VARIANTS['ai-agent'].workflowName;

const hasWorkflowName = (value: unknown): boolean =>
  String(value || '')
    .toLowerCase()
    .includes('workflow');

const createdWorkflowIds = (agent: any): string[] =>
  (agent?.action_results || [])
    .filter((result: any) => hasWorkflowName(result?.name))
    .map((result: any) => String(result?.data?.workflow?.workflowId || result?.data?.workflow?.id || result?.data?.workflow_id || ''))
    .filter(Boolean);

const reportActionResults = (agent: any) =>
  (agent?.action_results || []).map((result: any) => ({
    id: String(result?.id || ''),
    name: String(result?.name || ''),
    status: String(result?.status || ''),
    summary: String(result?.summary || ''),
    error: String(result?.error || '').trim() || null,
  }));

const editorUrl = (agent: any): string | null =>
  String((agent?.action_results || []).find((result: any) => result?.data?.editor_url)?.data?.editor_url || '').trim() || null;

const assistantText = (data: any): string => String(data?.answer?.text || '').trim();
const workflowOutput = (data: any) => data?.agent?.workflow_execution_output || null;

async function cleanupWorkflowIds(ids: string[]) {
  if (!ids.length) return;
  const admin = SupabaseClientAdmin();
  await admin.from('ai_workflow_assignments').delete().in('workflow_id', ids);
  await admin.from('ai_workflow_executions').delete().in('workflow_id', ids);
  await admin.from('ai_workflows').delete().in('id', ids);
}

async function readAssignment(userId: string, channelId: string, bootstrapKey: string) {
  const admin = SupabaseClientAdmin();
  const assignments = await admin
    .from('ai_workflow_assignments')
    .select('id,workflow_id,scope_id,organization_id,metadata')
    .eq('scope_type', 'CHANNEL')
    .eq('user_id', userId);
  if (assignments.error) throw assignments.error;
  const rows = assignments.data || [];
  const assignment = channelId
    ? rows.find((entry: any) => String(entry?.scope_id || '').trim() === channelId)
    : rows.find((entry: any) => String(entry?.metadata?.bootstrap_key || '').trim() === bootstrapKey);
  if (!assignment?.workflow_id) {
    throw new Error(channelId ? `No workflow assignment found for channel ${channelId}.` : `No workflow assignment found for ${bootstrapKey}.`);
  }
  const workflow = await admin.from('ai_workflows').select('id,name').eq('id', assignment.workflow_id).maybeSingle();
  if (workflow.error) throw workflow.error;
  if (!workflow.data?.id) throw new Error(`Assigned workflow ${assignment.workflow_id} was not found.`);
  return {
    assignmentId: String(assignment.id),
    channelId: String(assignment.scope_id || ''),
    organizationId: String(assignment.organization_id || '').trim() || null,
    workflowId: String(workflow.data.id),
    workflowName: String(workflow.data.name || ''),
  };
}

export async function runDebugChatParityLiveCheck(
  options: {
    variant?: ChatParityVariant;
    email?: string;
    channelId?: string;
    chatId?: string;
    message?: string;
    port?: number;
    session?: LiveSession;
    cleanupWorkflows?: boolean;
    transport?: 'graphql' | 'socket';
  } = {},
) {
  const variant = chatParityVariant(options.variant);
  const config = CHAT_PARITY_VARIANTS[variant];
  const email = options.email || DEBUG_CHAT_PARITY_EMAIL;
  const requestedChannelId = String(options.channelId || '').trim() || (variant === 'legacy' ? DEBUG_CHAT_PARITY_CHANNEL_ID : '');
  const message = options.message || DEBUG_CHAT_PARITY_MESSAGE;
  const port = options.port || LIVE_CHAT_PORT + 4;
  const transport = options.transport || 'socket';
  const workflowIds: string[] = [];
  const ownsSession = !options.session;
  const session = options.session || (await readLiveSession(port, email));
  try {
    const assignment = await readAssignment(session.userId, requestedChannelId, config.bootstrapKey);
    const channelId = requestedChannelId || assignment.channelId;
    assert.equal(
      assignment.workflowName,
      config.workflowName,
      `Expected ${config.workflowName} on channel ${channelId}, got ${assignment.workflowName || '(empty)'}.`,
    );
    const existingChatId = String(options.chatId || '').trim() || null;
    const socket = transport === 'socket' ? await openChatSocket(port, session.sessionHeader) : null;
    const sendMessage = async (payload: Record<string, unknown>) =>
      transport === 'graphql'
        ? sendChatSend({
            chatId: String(payload.chat_id || '').trim() || undefined,
            ids: createdIds(),
            message: String(payload.message || ''),
            requestId: String(payload.request_id || '').trim() || undefined,
            scope: (payload.scope as any) || { type: 'CHANNEL', id: channelId, organizationId: assignment.organizationId },
            session,
          })
        : socketChat(socket as any, payload);
    try {
      const pending = await sendMessage(
        existingChatId
          ? { request_id: `chat-${randomUUID()}`, chat_id: existingChatId, message, top_k: 10 }
          : {
              request_id: `chat-${randomUUID()}`,
              scope: { type: 'CHANNEL', id: channelId, organizationId: assignment.organizationId },
              message,
              top_k: 10,
            },
      );
      const pendingData = pending.done.data;
      assert.equal(pending.ack.status, 'accepted');
      if (pendingData.agent?.response_format === 'workflow_output') {
        const text = assistantText(pendingData);
        const workflowExecutionOutput = workflowOutput(pendingData);
        workflowIds.push(...createdWorkflowIds(pendingData.agent));
        assert.match(JSON.stringify(workflowExecutionOutput).toLowerCase(), /hello rich|how are you/);
        assert.doesNotMatch(text, /Workflow completed with no output\./i);
        assert.match(text.toLowerCase(), /hello rich|how are you/);
        return {
          assignmentId: assignment.assignmentId,
          assignedWorkflowId: assignment.workflowId,
          chatId: String(pendingData.chat?.id || existingChatId || '').trim(),
          editorUrl: editorUrl(pendingData.agent),
          workflowId: workflowIds[0] || null,
          startedWithExistingChat: Boolean(existingChatId),
          assistantText: text,
          workflowExecutionOutput,
          actionResults: reportActionResults(pendingData.agent),
        };
      }
      assert.equal(pendingData.agent?.requires_confirmation, true, JSON.stringify(pendingData, null, 2));
      assert.equal(
        (pendingData.agent?.pending_actions || []).some((action: any) => hasWorkflowName(action?.name)),
        true,
        JSON.stringify(pendingData.agent?.pending_actions || [], null, 2),
      );
      const chatId = String(pendingData.chat?.id || existingChatId || '').trim();
      assert.equal(Boolean(chatId), true, 'Expected a chat id before confirmation.');
      const confirmed = await sendMessage({ request_id: `chat-${randomUUID()}`, chat_id: chatId, message: 'confirm', top_k: 10 });
      const confirmedData = confirmed.done.data;
      if (confirmedData.agent?.response_format !== 'workflow_output') process.stderr.write(`${JSON.stringify(confirmedData, null, 2)}\n`);
      assert.equal(confirmedData.agent?.response_format, 'workflow_output', JSON.stringify(confirmedData, null, 2));
      for (const result of confirmedData.agent?.action_results || [])
        assert.equal(result?.status, 'completed', result?.error || result?.summary || result?.name);
      workflowIds.push(...createdWorkflowIds(confirmedData.agent));
      const text = assistantText(confirmedData);
      const workflowExecutionOutput = workflowOutput(confirmedData);
      assert.match(JSON.stringify(workflowExecutionOutput).toLowerCase(), /hello rich|how are you/);
      assert.doesNotMatch(text, /Workflow completed with no output\./i);
      assert.match(text.toLowerCase(), /hello rich|how are you/);
      return {
        assignmentId: assignment.assignmentId,
        assignedWorkflowId: assignment.workflowId,
        chatId,
        editorUrl: editorUrl(confirmedData.agent),
        workflowId: workflowIds[0] || null,
        startedWithExistingChat: Boolean(existingChatId),
        assistantText: text,
        workflowExecutionOutput,
        actionResults: reportActionResults(confirmedData.agent),
      };
    } finally {
      socket?.close();
    }
  } finally {
    if (options.cleanupWorkflows) await cleanupWorkflowIds(workflowIds);
    if (ownsSession) await closeLiveSession(session);
  }
}
