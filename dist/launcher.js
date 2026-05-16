import { nowIso } from './contracts.js';
export function createConnectingmatrixChatStubLauncher(context = {}) {
    return {
        packageName: '@connectingmatrix/chat',
        title: 'Single Chat Launcher',
        mode: 'stub',
        status: 'ready',
        checkedAt: nowIso(),
        summary: 'Launches the single chat owner with queryChat/queryChaat, slash routing, sockets, drive/file attachments and message normalization.',
        healthPath: '/chat/health',
        graphqlNamespace: 'chat',
        routes: [
            { method: 'GET', path: '/chat/health', description: 'Health/status endpoint' },
            { method: 'GET', path: '/chat/launcher', description: 'Stub launcher panel' }
        ],
        owns: {
            ui: ['dataloaders', 'bindWithServer', 'status/launcher UI'],
            backend: ["responder bridge", "slash registry", "attachment uploader"],
            entity: ["Chat", "ChatMessage", "ChatAttachment"],
            migrations: ['migrations/*.sql']
        },
        actions: [
            { name: 'createChat', label: 'createChat', method: 'LOCAL', description: 'Run createChat demo action' },
            { name: 'queryChat', label: 'queryChat', method: 'LOCAL', description: 'Run queryChat demo action' },
            { name: 'attachFile', label: 'attachFile', method: 'LOCAL', description: 'Run attachFile demo action' }
        ],
        sampleData: { context: 'stub-playground', userId: context.userId ?? 'stub-user' },
        context: { userId: context.userId, organizationId: context.organizationId, root: Boolean(context.root), traceId: context.traceId },
        notes: [
            'This launcher is intentionally stub-mode playable so the package can be tested outside giga-ai-backend.',
            'The launcher exposes this package boundary only; cross-package behavior is injected through adapters.'
        ]
    };
}
export const createStubLauncher = createConnectingmatrixChatStubLauncher;
export const Launcher = { open: createConnectingmatrixChatStubLauncher, mode: 'stub' };
export const launcher = createConnectingmatrixChatStubLauncher;
