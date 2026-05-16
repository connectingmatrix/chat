import assert from 'node:assert/strict';
import { assertConfirmationText, assertPlainChatResponse } from './chat-giga-live.assertions';
import { sendChatFlow } from './chat-giga-live.requests';
import { logPromptTiming } from './chat-parity-matrix.reporter';
import { readWorkflowExecution } from './chat-parity-matrix.state';
import { CreatedIds, collectAgentIds } from './chat-giga-live.ids';
import { ParitySystemEnum } from './chat-parity-matrix.scope';

export type MatrixContext = {
  caseLabel?: string;
  chatId?: string | null;
  chatRef?: { current: string | null };
  ids: CreatedIds;
  last?: { current: any };
  sessionMetadata?: Record<string, unknown> | null;
  scope: { type: string; id: string; organizationId: null };
  session: any;
  system: string;
  trace: any;
  workflowId: string;
};

export async function runPrompt(params: {
  caseLabel?: string;
  chatId?: string;
  chatRef?: { current: string | null };
  confirmText?: string;
  ids: CreatedIds;
  last?: { current: any };
  message: string;
  requestId?: string;
  sessionMetadata?: Record<string, unknown> | null;
  scope: { type: string; id: string; organizationId: null };
  session: any;
  trace: any;
  workflowId: string;
  system?: string;
  expectConfirmation?: boolean;
}) {
  const caseLabel = params.caseLabel || 'unknown-case';
  let { message } = params;
  let response = await sendChatFlow({
    chatId: params.chatId || params.chatRef?.current || undefined,
    confirmText: params.confirmText,
    expectConfirmation: params.expectConfirmation,
    ids: params.ids,
    message,
    requestId: params.requestId,
    scope: params.scope,
    session: params.session,
    sessionMetadata: params.sessionMetadata || null,
    system: params.system,
  });
  const planningFailureText = String(response.final.answer?.text || '').toLowerCase();
  const needsClarificationRetry =
    params.expectConfirmation !== false &&
    response.pending?.done?.data?.agent?.requires_confirmation !== true &&
    response.final?.agent?.response_format === 'planning_failure' &&
    (planningFailureText.includes('need a little more detail') ||
      planningFailureText.includes('include the exact names') ||
      planningFailureText.includes('exact names, targets, or ids'));
  if (needsClarificationRetry) {
    message = `${params.message} Use these exact names and proceed with a confirmation plan.`;
    response = await sendChatFlow({
      chatId: params.chatId || params.chatRef?.current || undefined,
      confirmText: params.confirmText,
      expectConfirmation: params.expectConfirmation,
      ids: params.ids,
      message,
      requestId: params.requestId,
      scope: params.scope,
      session: params.session,
      sessionMetadata: params.sessionMetadata || null,
      system: params.system,
    });
  }
  const finalText = String(response.final.answer?.text || '').trim();
  const pendingText = String(response.pending?.done?.data?.answer?.text || '').trim();
  const confirmed = response.pending?.done?.data?.agent?.requires_confirmation === true;
  logPromptTiming({
    caseLabel,
    confirmMessageSent: confirmed ? params.confirmText || 'confirm' : null,
    confirmationResponseText: pendingText || null,
    confirmationSeconds: response.timings.confirmation_ms === null ? null : Number((response.timings.confirmation_ms / 1000).toFixed(3)),
    finalResponseText: finalText,
    messageSent: message,
    pendingSeconds: Number((response.timings.pending_ms / 1000).toFixed(3)),
    postConfirmationText: confirmed ? finalText : null,
    system: params.system || '',
    totalSeconds: Number((response.timings.total_ms / 1000).toFixed(3)),
  });
  collectAgentIds(response.final.agent, params.ids);
  if (params.chatRef) params.chatRef.current = String(response.final.chat?.id || params.chatRef.current || '');
  let trace = null;
  if (params.workflowId) {
    const execution = await readWorkflowExecution(params.session, String(response.final.chat?.id || ''), params.workflowId);
    assert.equal(Boolean(execution?.run_id), true, `Expected workflow execution for: ${params.message}`);
    trace = { execution, events: execution?.logs || [] };
  }
  const result = { ...response, trace, text: finalText };
  if (params.last) params.last.current = result;
  return result;
}

export function plainText(response: any) {
  assertPlainChatResponse(response.final);
  return response.text;
}

export function requireConfirmation(response: any) {
  assertConfirmationText(response.pending.done.data);
  assert.equal(response.pending.done.data.agent?.requires_confirmation, true, JSON.stringify(response.pending.done.data, null, 2));
}

export function requireTrace(response: any, system: string) {
  if (system === ParitySystemEnum.ChatOnly) {
    assert.equal(response.trace, null);
    return;
  }
  assert.equal(Boolean(response.trace?.execution?.id), true, JSON.stringify(response.trace, null, 2));
}

export function withTrace(error: unknown, label: string, response: any) {
  const message = error instanceof Error ? error.message : String(error);
  const trace = response?.trace ? `\nTRACE ${JSON.stringify(response.trace, null, 2)}` : '';
  const pending = response?.pending ? `\nPENDING ${JSON.stringify(response.pending.done.data, null, 2)}` : '';
  const final = response?.final ? `\nFINAL ${JSON.stringify(response.final, null, 2)}` : '';
  return new Error(`${label}: ${message}${pending}${final}${trace}`);
}
