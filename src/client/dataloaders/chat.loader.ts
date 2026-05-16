import { createRequestId } from '@giga/dataloader/client/legacy/graphql/client';
import { frontendGraphqlRequest } from '@giga/dataloader/client/legacy/orm/graphql';
import { readStoredTokens } from '@giga/dataloader/client/legacy/graphql/helper';
import { ChatSocketClient } from '@giga/dataloader/client/legacy/socket/chat/ChatSocketClient';
import type { AIChatQueryData, AIChatQueryRequest } from '@giga/dataloader/client/legacy/socket/chat/types.socket';
import { chatDebugRoomKey, pushChatDebugEvent, setChatDebugLastMessage, transferChatDebugRoom } from '@giga/dataloader/client/legacy/dataloaders/chat-debug.store';
import { findChatSession, findChatSessions, findEffectiveWorkflowBinding } from '@giga/dataloader/client/legacy/orm';
import type { ChatConfirmation, ChatMessage, ChatState, EntityRecord, JsonObject, ScopeRef, SlashCommand } from '@giga/dataloader/client/legacy/orm';
import type { UiDataContext } from '@giga/dataloader/client/legacy/dataloaders/context';

export const slashCommands: SlashCommand[] = [
    { id: 'workflow-list', command: '/workflow list', title: 'List workflows', description: 'Show workflow catalog.', example: '/workflow list' },
    { id: 'workflow-running', command: '/workflow running', title: 'Running workflows', description: 'Show running workflow executions.', example: '/workflow running' },
    { id: 'workflow-ai-create', command: '/workflow ai create', title: 'Create workflow with AI', description: 'Ask the AI agent to create a workflow.', example: '/workflow ai create "Create nested channels"' },
    { id: 'workflow-debug', command: '/workflow debug', title: 'Debug workflow', description: 'Send logs and chat context to AI.', example: '/workflow debug "Fix failed workflow"' },
    { id: 'node-list', command: '/node list', title: 'List nodes', description: 'Show available workflow nodes.', example: '/node list' },
    { id: 'node-create', command: '/node create', title: 'Create node', description: 'Create a user-defined node package.', example: '/node create "Create a sentiment node"' },
    { id: 'tree', command: '/tree', title: 'Tree help', description: 'Show tree operations.', example: '/tree' },
    { id: 'channel', command: '/channel', title: 'Channel help', description: 'Show channel operations.', example: '/channel' },
    { id: 'categories', command: '/categories', title: 'Category help', description: 'Show category operations.', example: '/categories' },
    { id: 'chart', command: '/chart', title: 'Chart help', description: 'Show chart operations.', example: '/chart' }
];

type SocketChatMessage = { id?: string | number | null; role?: string | null; content?: unknown; created_at?: string | null };
type SocketChatResult = AIChatQueryData & { chat?: { id?: string | null } | null; messages?: { user?: SocketChatMessage | null; assistant?: SocketChatMessage | null } | null };
type SlashExecuteResult = { markdown?: string | null; terminal?: string | null; status: string; error?: string | null; raw?: JsonObject | null; confirmation?: ChatConfirmation | null };
type SlashExecuteResponse = { executeSlashCommand: SlashExecuteResult };
export type ChatMode = 'DEFAULT' | 'AGENT' | 'WORKFLOW' | 'SWARM';
export type ChatRuntimeSelection = { chatMode: ChatMode; agentId?: string | null; workflowId?: string | null; swarmId?: string | null };
export type ChatAttachmentRef = { id?: string | null; file_name?: string | null; mime_type?: string | null; size_bytes?: number | null; drive_path: string; storage_bucket?: string | null; storage_path?: string | null; kind?: string | null; metadata?: JsonObject | null };

let chatClient: ChatSocketClient | null = null;

const textFromObject = (value: Record<string, unknown>): string => {
    const direct = value.content ?? value.text ?? value.markdown ?? value.message ?? value.output ?? value.result ?? value.answer;
    if (typeof direct === 'string') return direct;
    if (direct && typeof direct === 'object') return textFromObject(direct as Record<string, unknown>);
    const response = value.response;
    if (response && typeof response === 'object') return textFromObject(response as Record<string, unknown>);
    return JSON.stringify(value, null, 2);
};

const normalizeChatContent = (value: unknown): string => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return '';
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('\"') && trimmed.endsWith('\"'))) {
            try {
                const parsed = JSON.parse(trimmed) as unknown;
                if (typeof parsed === 'string') return parsed;
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return textFromObject(parsed as Record<string, unknown>);
                if (Array.isArray(parsed)) return JSON.stringify(parsed, null, 2);
            } catch {
                return value;
            }
        }
        return value;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) return textFromObject(value as Record<string, unknown>);
    if (Array.isArray(value)) return JSON.stringify(value, null, 2);
    return value == null ? '' : String(value);
};

const localChatMessage = (role: ChatMessage['role'], content: string, idPrefix = role): ChatMessage => ({
    id: `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date().toISOString()
});

const executeSlashCommandLocal = async (command: string, chatId?: string | null, confirmation?: { confirmed?: boolean; confirmationId?: string | null }): Promise<SlashExecuteResult> => {
    const query = `mutation GigaUiExecuteSlashCommand($input: SlashExecuteInput!) { executeSlashCommand(input: $input) { markdown terminal status error raw confirmation { id reason risk } } }`;
    return (await frontendGraphqlRequest<SlashExecuteResponse>(query, { input: { chatId: chatId || null, command, raw: command, args: {}, confirmed: confirmation?.confirmed === true, confirmationId: confirmation?.confirmationId || null } }, { fetchPolicy: 'no-cache' })).executeSlashCommand;
};

const slashConfirmation = (result: SlashExecuteResult, command: string): ChatConfirmation | null => {
    if (!result.confirmation) return null;
    return {
        id: result.confirmation.id || null,
        reason: result.confirmation.reason || 'Please confirm this action before Giga executes it.',
        risk: result.confirmation.risk || (result.status === 'confirmation_required' ? 'confirmation required' : null),
        command
    };
};

const slashResultText = (result: SlashExecuteResult): string => {
    const body = normalizeChatContent(result.markdown || result.terminal || result.error || result.raw || '');
    if (body.trim()) return body;
    if (result.confirmation) return result.confirmation.reason || 'Please confirm this action before Giga executes it.';
    return `Slash command ${result.status || 'completed'}.`;
};

const client = (): ChatSocketClient => {
    const tokens = readStoredTokens();
    if (!tokens?.accessToken) throw new Error('Chat socket requires an authenticated session.');
    chatClient = chatClient || new ChatSocketClient({ accessToken: tokens.accessToken });
    chatClient.setTokens({ accessToken: tokens.accessToken });
    return chatClient;
};

const messageFromRecord = (row: EntityRecord): ChatMessage => {
    const role = row.data.role;
    const content = normalizeChatContent(row.data.content);
    if (role !== 'user' && role !== 'assistant' && role !== 'system') throw new Error(`ChatMessage ${row.id} returned an unsupported role.`);
    if (!content) throw new Error(`ChatMessage ${row.id} did not include content.`);
    return { id: row.id, role, content, createdAt: row.createdAt };
};

const messageFromSocket = (message: SocketChatMessage | null | undefined, role: ChatMessage['role']): ChatMessage => {
    if (!message?.id) throw new Error(`Chat socket ${role} message did not include an id.`);
    const content = normalizeChatContent(message.content);
    if (!content) throw new Error(`Chat socket ${role} message did not include content.`);
    if (!message.created_at) throw new Error(`Chat socket ${role} message did not include created_at.`);
    return { id: String(message.id), role, content, createdAt: message.created_at };
};
const firstText = (...values: unknown[]): string => {
    for (const value of values) {
        const text = normalizeChatContent(value).trim();
        if (text) return text;
    }
    return '';
};
const assistantText = (result: SocketChatResult): string => {
    const answer = result.answer as { text?: string | null; markdown?: string | null; response?: { text?: string | null } | null } | undefined;
    const agent = result.agent as { markdown?: string | null; response?: { text?: string | null } | null; output?: { text?: string | null } | null } | undefined;
    const top = result as { text?: string | null; markdown?: string | null; response?: { text?: string | null } | null };
    return firstText(result.messages?.assistant?.content, answer?.text, answer?.markdown, answer?.response?.text, agent?.markdown, agent?.response?.text, agent?.output?.text, top.text, top.markdown, top.response?.text);
};
const assistantMessage = (result: SocketChatResult, chatId: string): ChatMessage => {
    if (result.messages?.assistant?.id && result.messages?.assistant?.content && result.messages?.assistant?.created_at) return messageFromSocket(result.messages.assistant, 'assistant');
    const content = assistantText(result);
    if (!content) throw new Error('Chat socket response did not include assistant content.');
    return { id: `assistant-${chatId}-${Date.now()}`, role: 'assistant', content, createdAt: new Date().toISOString() };
};

const scopeInput = (scope: ScopeRef): JsonObject | undefined => {
    if (scope.kind === 'channel') return { type: 'channel', id: scope.id };
    if (scope.kind === 'category') return { type: 'category', id: scope.id };
    if (scope.kind === 'subject') return { type: 'subject', id: scope.id };
    if (scope.kind === 'post') return { type: 'post', id: scope.id };
    return undefined;
};

const scopedSessionKinds = ['channel', 'category', 'subject', 'post'] as const;
const sessionScope = (scope: ScopeRef, session: { scope?: { type?: string | null; id?: string | null } | null; title?: string | null }): ScopeRef => {
    const kind = String(session.scope?.type || '').trim().toLowerCase();
    const id = String(session.scope?.id || '').trim();
    if (id && scopedSessionKinds.includes(kind as (typeof scopedSessionKinds)[number])) return { kind: kind as ScopeRef['kind'], id, title: session.title || scope.title };
    return scope;
};
const loadChatMessages = async (context: UiDataContext, chatId: string, title: string): Promise<ChatMessage[]> =>
    (await context.orm.entity('ChatMessage').list({ first: 50, offset: 0, search: '', scope: { kind: 'chat', id: chatId, title } })).rows.map(messageFromRecord);

export const loadChatState = async (context: UiDataContext, scope: ScopeRef, agentId = 'default-agent'): Promise<ChatState> => {
    const scoped = scopeInput(scope);
    if (!scoped) {
        const latest = (await findChatSessions({ first: 1, offset: 0 })).find((session) => String(session.id || '').trim());
        if (!latest?.id) return { scope, agentId, chatId: null, messages: [], slashCommands };
        const resolvedScope = sessionScope(scope, latest);
        return {
            scope: resolvedScope,
            agentId,
            chatId: latest.id,
            messages: await loadChatMessages(context, latest.id, latest.title || resolvedScope.title),
            slashCommands
        };
    }
    const session = await findChatSession({ scope });
    const chatId = session.id || null;
    const messages = chatId ? await loadChatMessages(context, chatId, scope.title) : [];
    return { scope, agentId, chatId, messages, slashCommands };
};

export const loadChatRuntimeSelection = async (
    context: UiDataContext,
    scope: ScopeRef,
    explicitSelection: ChatRuntimeSelection
): Promise<ChatRuntimeSelection> => {
    if (explicitSelection.chatMode === 'AGENT' || explicitSelection.chatMode === 'WORKFLOW' || explicitSelection.chatMode === 'SWARM') return explicitSelection;
    const organizationId = context.policy.scope.kind === 'organization' ? context.policy.scope.id : context.organizationId;
    const binding = await findEffectiveWorkflowBinding({ organizationId, scope });
    if (!binding?.workflowId) return explicitSelection;
    return { ...explicitSelection, workflowId: binding.workflowId };
};

export const sendChatMessage = async (context: UiDataContext, state: ChatState, message: string, selection: ChatRuntimeSelection = { chatMode: 'DEFAULT' }, attachments: ChatAttachmentRef[] = []): Promise<ChatState> => {
    const requestId = createRequestId();
    const scopeKey = `${state.scope.kind}:${state.scope.id}`;
    const startingRoom = chatDebugRoomKey(state.chatId, scopeKey);
    setChatDebugLastMessage(startingRoom, message);
    pushChatDebugEvent(startingRoom, { requestId, chatId: state.chatId || null, stage: 'input.received', status: 'started', message: 'Message sent to Giga.', meta: { user_message: message } });

    const trimmedMessage = message.trim().replace(/^\/worflow\b/i, '/workflow');
    const confirmMatch = /\s+--confirm(?:=|\s+)?([^\s]+)?/i.exec(trimmedMessage);
    const commandForExecution = confirmMatch ? trimmedMessage.replace(/\s+--confirm(?:=|\s+)?[^\s]*/i, '').trim() : trimmedMessage;
    if (commandForExecution.startsWith('/')) {
        pushChatDebugEvent(startingRoom, { requestId, chatId: state.chatId || null, stage: 'slash.execute', status: 'progress', message: `Executing ${commandForExecution}.` });
        const result = await executeSlashCommandLocal(commandForExecution, state.chatId, { confirmed: Boolean(confirmMatch), confirmationId: confirmMatch?.[1] || null });
        const assistant = { ...localChatMessage('assistant', slashResultText(result), 'slash-assistant'), confirmation: slashConfirmation(result, commandForExecution) };
        pushChatDebugEvent(startingRoom, { requestId, chatId: state.chatId || null, stage: 'slash.done', status: result.status === 'failed' ? 'failed' : 'completed', message: result.error || `Slash command ${result.status}.` });
        return { ...state, messages: [...state.messages, localChatMessage('user', message, 'slash-user'), assistant] };
    }

    client().setHandlers({
        onAck: (event) => pushChatDebugEvent(chatDebugRoomKey(event.chatId || state.chatId, scopeKey), { requestId, chatId: event.chatId || state.chatId || null, stage: 'socket.ack', status: 'progress', message: 'Giga accepted the request.' }),
        onDebug: (event) =>
            pushChatDebugEvent(chatDebugRoomKey(event.chat_id || state.chatId, scopeKey), {
                requestId,
                chatId: event.chat_id || state.chatId || null,
                stage: event.stage,
                status: event.status,
                message: event.message,
                timestamp: event.timestamp,
                meta: event.meta
            }),
        onAssistantDone: (event) => {
            const nextRoom = chatDebugRoomKey(event.chatId || state.chatId, scopeKey);
            transferChatDebugRoom(startingRoom, nextRoom);
            pushChatDebugEvent(nextRoom, { requestId, chatId: event.chatId || state.chatId || null, stage: 'assistant.done', status: 'completed', message: 'Assistant response generated.' });
        },
        onError: (event) => pushChatDebugEvent(chatDebugRoomKey(event.chatId || state.chatId, scopeKey), { requestId, chatId: event.chatId || state.chatId || null, stage: 'chat.error', status: 'failed', message: event.message })
    });

    const selectedAgentId = selection.chatMode === 'AGENT' ? selection.agentId || null : null;
    const selectedWorkflowId = selection.chatMode === 'WORKFLOW' ? selection.workflowId || null : null;
    const selectedSwarmId = selection.chatMode === 'SWARM' ? selection.swarmId || null : null;
    const payload: AIChatQueryRequest = {
        chat_id: state.chatId || null,
        request_id: requestId,
        message,
        chat_mode: selection.chatMode,
        agent_id: selectedAgentId,
        workflow_id: selectedWorkflowId,
        swarm_id: selectedSwarmId,
        attachments
    };
    const scoped = scopeInput(state.scope);
    if (scoped) payload.scope = scoped;
    const result = (await client().sendQuery(payload)) as SocketChatResult;
    const chatId = result.chat?.id || state.chatId;
    if (!chatId) throw new Error('Chat socket response did not include a chat id.');
    const nextRoom = chatDebugRoomKey(chatId, scopeKey);
    transferChatDebugRoom(startingRoom, nextRoom);
    return { ...state, chatId, messages: [...state.messages, assistantMessage(result, chatId)] };
};

export const filterSlashCommands = (query: string): SlashCommand[] => {
    const normalized = query.trim().toLowerCase().replace('/worflow', '/workflow');
    return slashCommands.filter((command) => command.command.toLowerCase().includes(normalized) || command.title.toLowerCase().includes(normalized));
};
