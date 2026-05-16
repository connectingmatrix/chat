import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, X, Plus, ChevronRight, Mic, FileDown, MicOff, Bot, Zap, Settings, Network } from 'lucide-react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useToast } from '../components/Toast';
import { FileAttachmentManager } from '../components/FileAttachmentManager';
import { ActivityPanel, ThinkingStep } from '../components/ActivityPanel';
import { IntelligenceModal } from '../components/IntelligenceModal';
import { InlineConfirmation } from '../components/InlineConfirmation';
import { SlashCommandInput } from '../components/SlashCommandInput';
import { MarkdownContent } from '../components/editors/MarkdownContent';
import { useSearchParams } from 'react-router';
import { useUiDataContext } from '../contexts/AuthSessionContext';
import { loadAppChatRuntimeSelection, loadAppChatState, sendAppChatMessage } from '../data/chat';
import { uploadChatAttachmentToDrive } from '@giga/dataloader/client/legacy/dataloaders/chat-attachments.loader';
import type { UploadedChatAttachment } from '@giga/dataloader/client/legacy/dataloaders/chat-attachments.loader';
import type { ChatRuntimeSelection } from '../data/chat';
import type { ChatState } from '@giga/dataloader/client/legacy/orm';
import { chatDebugRoomKey, useChatDebugRoom, type ChatDebugTimeline } from '@giga/dataloader/client/legacy/dataloaders/chat-debug.store';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface Attachment {
    id: string;
    file: File;
    preview?: string;
    type: 'image' | 'file';
    uploaded?: UploadedChatAttachment;
}

interface ConfirmationData {
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    shown: boolean;
}

interface Message {
    id: string;
    type: 'user' | 'ai';
    content: string;
    attachments?: Attachment[];
    timestamp: string;
    dashboard?: DashboardData;
    thinking?: ThinkingData;
    inlineThinking?: string;
    confirmation?: ConfirmationData;
}

interface ThinkingData {
    duration: number;
    steps: ThinkingStep[];
}

interface DashboardData {
    title: string;
    metrics: Array<{
        label: string;
        value: string;
        change: string;
        trend: 'up' | 'down';
    }>;
}

type AttachmentType = 'agent' | 'workflow' | 'swarm' | 'default';
const attachmentTypeForSelection = (selection: ChatRuntimeSelection): AttachmentType =>
    selection.chatMode === 'AGENT' ? 'agent' : selection.chatMode === 'WORKFLOW' ? 'workflow' : selection.chatMode === 'SWARM' ? 'swarm' : 'default';
const normalizeChatMode = (value: string | null | undefined): ChatRuntimeSelection['chatMode'] | null =>
    value === 'AGENT' || value === 'WORKFLOW' || value === 'SWARM' || value === 'DEFAULT' ? value : null;
const runtimeSelectionFromQuery = (chatMode: string | null, agentId?: string, workflowId?: string, swarmId?: string): ChatRuntimeSelection =>
    normalizeChatMode(chatMode) === 'AGENT'
        ? { chatMode: 'AGENT', agentId: agentId || null }
        : normalizeChatMode(chatMode) === 'WORKFLOW'
          ? { chatMode: 'WORKFLOW', workflowId: workflowId || null }
          : normalizeChatMode(chatMode) === 'SWARM'
            ? { chatMode: 'SWARM', swarmId: swarmId || null }
            : normalizeChatMode(chatMode) === 'DEFAULT'
              ? { chatMode: 'DEFAULT' }
              : agentId
                ? { chatMode: 'AGENT', agentId }
                : workflowId
                  ? { chatMode: 'WORKFLOW', workflowId }
                  : swarmId
                    ? { chatMode: 'SWARM', swarmId }
                    : { chatMode: 'DEFAULT' };

export function UnifiedChat() {
    const { showToast } = useToast();
    const context = useUiDataContext();
    const [searchParams] = useSearchParams();
    const scopeType = searchParams.get('scopeType') || undefined;
    const scopeId = searchParams.get('scopeId') || undefined;
    const scopeTitle = searchParams.get('scopeTitle') || undefined;
    const initialMessage = searchParams.get('message') || '';
    const chatMode = searchParams.get('chatMode');
    const agentId = searchParams.get('agentId') || undefined;
    const workflowId = searchParams.get('workflowId') || undefined;
    const swarmId = searchParams.get('swarmId') || undefined;
    const autoSentKey = useRef('');

    const [input, setInput] = useState('');
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [chatState, setChatState] = useState<ChatState | null>(null);
    const [attachmentType, setAttachmentType] = useState<AttachmentType>('default');
    const [runtimeSelection, setRuntimeSelection] = useState<ChatRuntimeSelection>({ chatMode: 'DEFAULT' });
    const [showModeMenu, setShowModeMenu] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [showFileManager, setShowFileManager] = useState(false);
    const [showActivity, setShowActivity] = useState(false);
    const [activeThinking, setActiveThinking] = useState<ThinkingData | null>(null);
    const [showIntelligenceModal, setShowIntelligenceModal] = useState(false);
    const [isChatLoading, setIsChatLoading] = useState(true);
    const [isHistoryReady, setIsHistoryReady] = useState(false);
    const showToastRef = useRef(showToast);
    const messagesViewportRef = useRef<HTMLDivElement | null>(null);
    const contextKey = `${context.policy.role}:${context.policy.scope.kind}:${context.policy.scope.id}:${context.userId}`;
    const scopeKey = chatState ? `${chatState.scope.kind}:${chatState.scope.id}` : `${context.policy.scope.kind}:${context.policy.scope.id}`;
    const queryRuntimeSelection = useMemo(() => runtimeSelectionFromQuery(chatMode, agentId, workflowId, swarmId), [agentId, chatMode, workflowId, swarmId]);
    const debugRoom = useChatDebugRoom(chatDebugRoomKey(chatState?.chatId, scopeKey));
    const activeDebugTimeline = debugRoom.requests.find((request) => request.requestId === debugRoom.activeRequestId) || null;
    const debugIsProcessing = Boolean(activeDebugTimeline && !activeDebugTimeline.isCompleted);
    const lastAiMessageId = useMemo(() => [...messages].reverse().find((message) => message.type === 'ai')?.id || null, [messages]);
    const currentThinking = useMemo(() => {
        if (!activeDebugTimeline) return null;
        return {
            duration: Math.max(1, Math.round((Date.parse(activeDebugTimeline.updatedAt) - Date.parse(activeDebugTimeline.startedAt)) / 1000)),
            steps: activeDebugTimeline.events.map((event) => ({
                type: event.stage.includes('code') || event.stage.includes('cypher') || event.stage.includes('sql') ? 'code' : 'thinking',
                content: `${event.stage} • ${event.message}`,
                language: event.stage.includes('cypher') ? 'cypher' : event.stage.includes('sql') ? 'sql' : undefined
            }))
        } satisfies ThinkingData;
    }, [activeDebugTimeline]);
    useEffect(() => {
        showToastRef.current = showToast;
    }, [showToast]);

    const activityThinking = showActivity && currentThinking ? currentThinking : activeThinking;
    const pendingThinking = currentThinking || {
        duration: 1,
        steps: [{ type: 'thinking' as const, content: 'Analyzing request and preparing response.' }]
    };

    useEffect(() => {
        let active = true;
        setIsChatLoading(true);
        setIsHistoryReady(false);
        loadAppChatState(context, scopeType, scopeId, scopeTitle)
            .then(async (state) => {
                if (!active) return;
                const selection = await loadAppChatRuntimeSelection(context, state.scope, queryRuntimeSelection);
                if (!active) return;
                setChatState(state);
                setRuntimeSelection(selection);
                setAttachmentType(attachmentTypeForSelection(selection));
                setMessages(state.messages.map((message) => ({ id: message.id, type: message.role === 'user' ? 'user' : 'ai', content: message.content, timestamp: new Date(message.createdAt).toLocaleTimeString() })));
                setIsHistoryReady(true);
                setIsChatLoading(false);
            })
            .catch((error: Error) => {
                if (!active) return;
                showToastRef.current('error', error.message || 'Chat data loader could not initialize');
                setRuntimeSelection(queryRuntimeSelection);
                setAttachmentType(attachmentTypeForSelection(queryRuntimeSelection));
                setIsHistoryReady(true);
                setIsChatLoading(false);
            });
        return () => {
            active = false;
        };
    }, [contextKey, queryRuntimeSelection, scopeType, scopeId, scopeTitle]);

    useEffect(() => {
        if (!isHistoryReady) return;
        const viewport = messagesViewportRef.current;
        if (!viewport) return;
        viewport.scrollTop = viewport.scrollHeight;
    }, [isHistoryReady, messages.length]);

    const removeAttachment = (id: string) => {
        setAttachments(attachments.filter((a) => a.id !== id));
    };

    const handleSend = async (overrideContent?: string, overrideState?: ChatState) => {
        const content = (overrideContent || input).trim();
        if (!content && attachments.length === 0) return;
        if (runtimeSelection.chatMode === 'AGENT' && !runtimeSelection.agentId) {
            setAttachmentType('agent');
            setShowIntelligenceModal(true);
            showToast('error', 'Select an AI Agent before sending in Agent mode');
            return;
        }
        if (runtimeSelection.chatMode === 'WORKFLOW' && !runtimeSelection.workflowId) {
            setAttachmentType('workflow');
            setShowIntelligenceModal(true);
            showToast('error', 'Select a Workflow before sending in Workflow mode');
            return;
        }

        const activeState = overrideState || chatState;
        if (!activeState) {
            showToast('error', 'Chat data loader is not ready');
            return;
        }

        const userMessage: Message = {
            id: Date.now().toString(),
            type: 'user',
            content,
            timestamp: new Date().toLocaleTimeString()
        };

        setMessages((current) => [...current, userMessage]);
        if (!overrideContent) setInput('');
        setAttachments([]);
        setIsSending(true);
        try {
            const uploadedAttachments = await Promise.all(attachments.map(async (attachment) => attachment.uploaded || uploadChatAttachmentToDrive(attachment.file, activeState.scope)));
            const nextState = await sendAppChatMessage(context, activeState, content, runtimeSelection, uploadedAttachments);
            const assistant = nextState.messages[nextState.messages.length - 1];
            const aiMessageId = assistant.id;
            const pendingConfirmation = assistant.confirmation
                ? {
                      message: `${assistant.confirmation.reason || 'Please confirm this action before Giga executes it.'}${assistant.confirmation.risk ? ` Risk: ${assistant.confirmation.risk}.` : ''}`,
                      shown: true,
                      onConfirm: () => {
                          setMessages((current) => current.map((message) => (message.id === aiMessageId && message.confirmation ? { ...message, confirmation: { ...message.confirmation, shown: false } } : message)));
                          const confirmSuffix = assistant.confirmation?.id ? ` --confirm ${assistant.confirmation.id}` : ' --confirm';
                          void handleSend(`${assistant.confirmation?.command || content}${confirmSuffix}`, nextState);
                      },
                      onCancel: () => {
                          setMessages((current) => current.map((message) => (message.id === aiMessageId && message.confirmation ? { ...message, confirmation: { ...message.confirmation, shown: false } } : message)));
                          showToast('info', 'Cancelled pending action.');
                      }
                  }
                : undefined;
            const aiMessage: Message = {
                id: aiMessageId,
                type: 'ai',
                content: assistant.content,
                timestamp: new Date(assistant.createdAt).toLocaleTimeString(),
                confirmation: pendingConfirmation
            };
            setChatState(nextState);
            setMessages((current) => [...current, aiMessage]);
        } catch (error) {
            showToast('error', error instanceof Error ? error.message : 'Chat socket request failed');
        } finally {
            setIsSending(false);
        }
    };

    useEffect(() => {
        const key = chatState && initialMessage.trim() ? `${chatState.scope.kind}:${chatState.scope.id}:${initialMessage.trim()}` : '';
        if (!chatState || !key || autoSentKey.current === key) return;
        autoSentKey.current = key;
        void handleSend(initialMessage, chatState);
    }, [chatState, initialMessage]);

    const handleVoiceRecord = async () => {
        setIsRecording(false);
        showToast('error', 'Voice transcription needs an existing runtime loader before recording');
    };

    const handleFileAttach = (files: Attachment[]) => {
        setAttachments(files);
    };

    const handleThinkingClick = (thinking: ThinkingData) => {
        setActiveThinking(thinking);
        setShowActivity(true);
    };

    const exportToPDF = async (elementRef: HTMLDivElement | null, filename: string = 'dashboard') => {
        if (!elementRef) return;

        try {
            const canvas = await html2canvas(elementRef, {
                scale: 2,
                backgroundColor: '#ffffff'
            });

            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({
                orientation: 'landscape',
                unit: 'px',
                format: [canvas.width, canvas.height]
            });

            pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
            pdf.save(`${filename}-${Date.now()}.pdf`);

            showToast('success', 'Exported to PDF successfully');
        } catch (error) {
            showToast('error', 'Failed to export PDF');
        }
    };

    const getModeLabel = () => {
        switch (attachmentType) {
            case 'agent':
                return 'AI Agent';
            case 'workflow':
                return 'Workflow';
            case 'swarm':
                return 'Swarm';
            case 'default':
                return 'Default';
            default:
                return 'Default';
        }
    };

    const getModeIcon = () => {
        switch (attachmentType) {
            case 'agent':
                return <Bot className="w-4 h-4" />;
            case 'workflow':
                return <Zap className="w-4 h-4" />;
            case 'swarm':
                return <Network className="w-4 h-4" />;
            case 'default':
                return null;
            default:
                return null;
        }
    };
    const openModeSelector = (type: AttachmentType) => {
        setAttachmentType(type);
        setShowIntelligenceModal(true);
        setShowModeMenu(false);
    };
    const showSkeleton = isChatLoading;
    const showEmptyState = !showSkeleton && messages.length === 0;
    const pendingTyping = isSending || debugIsProcessing;
    const skeletonChatRows = [
        { type: 'assistant', width: 'w-4/6' },
        { type: 'user', width: 'w-60' },
        { type: 'assistant', width: 'w-5/6' },
        { type: 'user', width: 'w-72' },
        { type: 'assistant', width: 'w-3/6' },
        { type: 'user', width: 'w-64' },
        { type: 'assistant', width: 'w-4/6' },
        { type: 'user', width: 'w-56' },
    ];

    return (
        <div className="flex h-full min-h-0 bg-white dark:bg-[#0f0f0f] overflow-hidden">
            {/* Main Content Area */}
            {showSkeleton ? (
                <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                    <div className="flex-1 px-4 py-8 sm:px-8 md:px-16">
                        <div className="mx-auto max-w-4xl space-y-8">
                            <div className="h-12 w-72 animate-pulse rounded-xl bg-secondary/40 dark:bg-[#2a2a2a]" />
                            {skeletonChatRows.map((row, index) =>
                                row.type === 'assistant' ? (
                                    <div key={`sk-assistant-${index}`} className="space-y-3 rounded-2xl border border-border bg-white p-5 dark:border-[#2a2a2a] dark:bg-[#1a1a1a]">
                                        <div className={`h-4 ${row.width} animate-pulse rounded bg-secondary/50 dark:bg-[#2a2a2a]`} />
                                        <div className="h-4 w-5/6 animate-pulse rounded bg-secondary/50 dark:bg-[#2a2a2a]" />
                                        <div className="h-4 w-3/6 animate-pulse rounded bg-secondary/50 dark:bg-[#2a2a2a]" />
                                    </div>
                                ) : (
                                    <div key={`sk-user-${index}`} className={`ml-auto h-12 ${row.width} animate-pulse rounded-2xl bg-primary/20`} />
                                ),
                            )}
                        </div>
                    </div>
                    <div className="border-t border-border px-4 py-4 dark:border-[#2a2a2a] sm:px-8 md:px-16">
                        <div className="mx-auto h-14 max-w-4xl animate-pulse rounded-full border border-border bg-secondary/30 dark:border-[#2a2a2a] dark:bg-[#1a1a1a]" />
                    </div>
                </div>
            ) : showEmptyState ? (
                /* Empty State */
                <div className="flex-1 min-w-0 flex flex-col items-center justify-center px-4">
                    <h1 className="text-3xl font-semibold mb-12 text-center dark:text-gray-100">What's on the agenda today?</h1>

                    {/* Input */}
                    <div className="w-full max-w-3xl mb-6">
                        <div className="relative flex items-center gap-3 border border-border dark:border-[#2a2a2a] rounded-full px-4 py-3 shadow-sm bg-white dark:bg-[#1a1a1a] transition-all">
                            <button onClick={() => setShowFileManager(true)} className="p-1 hover:bg-secondary dark:hover:bg-[#2a2a2a] rounded-lg transition-colors flex-shrink-0 dark:text-gray-200" title="Attach files">
                                <Plus className="w-5 h-5" />
                            </button>

                            <div className="relative flex-1">
                                <SlashCommandInput
                                    value={input}
                                    onChange={setInput}
                                    onSubmit={() => void handleSend()}
                                    suppressFocusRing
                                    placeholder="Ask anything"
                                    className="border-0 bg-transparent px-0 text-base shadow-none focus:border-transparent focus:ring-0 focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent"
                                />
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                                <div className="relative">
                                    <button onClick={() => setShowModeMenu(!showModeMenu)} className="flex items-center gap-1 text-sm text-muted-foreground dark:text-gray-400 hover:text-foreground dark:hover:text-gray-200 transition-colors">
                                        {getModeIcon()}
                                        <span>{getModeLabel()}</span>
                                        <ChevronRight className={`w-4 h-4 transition-transform ${showModeMenu ? 'rotate-90' : '-rotate-90'}`} />
                                    </button>

                                    {showModeMenu && (
                                        <div className="absolute bottom-full right-0 mb-2 bg-white dark:bg-[#1a1a1a] border border-border dark:border-[#2a2a2a] rounded-lg shadow-lg py-1 min-w-[140px] z-10">
                                            <button
                                                onClick={() => openModeSelector('agent')}
                                                className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors dark:text-gray-200 flex items-center gap-2 ${attachmentType === 'agent' ? 'bg-primary/10 text-primary' : ''}`}
                                            >
                                                <Bot className="w-4 h-4" />
                                                AI Agent
                                            </button>
                                            <button
                                                onClick={() => openModeSelector('workflow')}
                                                className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors dark:text-gray-200 flex items-center gap-2 ${attachmentType === 'workflow' ? 'bg-primary/10 text-primary' : ''}`}
                                            >
                                                <Zap className="w-4 h-4" />
                                                Workflow
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setAttachmentType('swarm');
                                                    setRuntimeSelection({ chatMode: 'SWARM', swarmId: null });
                                                    setShowModeMenu(false);
                                                }}
                                                className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors dark:text-gray-200 flex items-center gap-2 ${attachmentType === 'swarm' ? 'bg-primary/10 text-primary' : ''}`}
                                            >
                                                <Network className="w-4 h-4" />
                                                Swarm
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setAttachmentType('default');
                                                    setRuntimeSelection({ chatMode: 'DEFAULT' });
                                                    setShowModeMenu(false);
                                                }}
                                                className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors dark:text-gray-200 ${attachmentType === 'default' ? 'bg-primary/10 text-primary' : ''}`}
                                            >
                                                Default
                                            </button>
                                            <div className="border-t border-border dark:border-[#2a2a2a] my-1"></div>
                                            <button
                                                onClick={() => {
                                                    setShowIntelligenceModal(true);
                                                    setShowModeMenu(false);
                                                }}
                                                className="w-full text-left px-3 py-2 text-sm hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors dark:text-gray-200 flex items-center gap-2"
                                            >
                                                <Settings className="w-4 h-4" />
                                                Configure
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={handleVoiceRecord}
                                    className={`p-1.5 hover:bg-secondary dark:hover:bg-[#2a2a2a] rounded-lg transition-colors dark:text-gray-200 ${isRecording ? 'bg-red-100 text-red-600 dark:bg-red-900/20' : ''}`}
                                    title={isRecording ? 'Stop recording' : 'Record voice'}
                                >
                                    {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                                </button>

                                <button
                                    onClick={() => void handleSend()}
                                    disabled={isSending || (!input.trim() && attachments.length === 0)}
                                    className={`p-2 rounded-lg transition-colors ${input.trim() || attachments.length > 0 ? 'bg-primary text-white hover:bg-primary/90' : 'bg-secondary text-muted-foreground'}`}
                                >
                                    <Send className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Attachments Preview */}
                        {attachments.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-3">
                                {attachments.map((att) => (
                                    <div key={att.id} className="relative group">
                                        {att.type === 'image' && att.preview ? (
                                            <div className="relative">
                                                <img src={att.preview} alt={att.file.name} className="w-16 h-16 object-cover rounded border border-border" />
                                                <button
                                                    onClick={() => removeAttachment(att.id)}
                                                    className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="relative">
                                                <div className="w-16 h-16 bg-secondary rounded border border-border flex items-center justify-center p-1">
                                                    <span className="text-xs text-center truncate">{att.file.name.split('.').pop()}</span>
                                                </div>
                                                <button
                                                    onClick={() => removeAttachment(att.id)}
                                                    className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Suggestion Pills */}
                    <div className="flex flex-wrap gap-3 justify-center">
                        <button onClick={() => setInput('Show sales performance')} className="px-4 py-2 border border-border dark:border-[#2a2a2a] rounded-full hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors text-sm dark:text-gray-200">
                            📊 Create a dashboard
                        </button>
                        <button onClick={() => setInput('Analyze user engagement')} className="px-4 py-2 border border-border dark:border-[#2a2a2a] rounded-full hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors text-sm dark:text-gray-200">
                            ✏️ Analyze data
                        </button>
                        <button onClick={() => setInput('Generate revenue report')} className="px-4 py-2 border border-border dark:border-[#2a2a2a] rounded-full hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors text-sm dark:text-gray-200">
                            🌐 Generate report
                        </button>
                    </div>
                </div>
            ) : (
                /* Messages View */
                <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                    {/* Messages */}
                    <div ref={messagesViewportRef} className="giga-scrollbar relative flex-1 overflow-y-auto px-4 sm:px-8 md:px-16">
                        <div className="max-w-4xl mx-auto py-8 space-y-6">
                            {messages.map((message) => (
                                <div key={message.id} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`${message.type === 'user' ? 'max-w-2xl' : 'w-full max-w-full'}`}>
                                        {/* Thinking Section (for AI messages only, shown before content) */}
                                        {message.type === 'ai' && (message.thinking || (message.id === lastAiMessageId ? currentThinking : null)) && (
                                            <button
                                                onClick={() => handleThinkingClick((message.thinking || currentThinking)!)}
                                                className="flex items-center gap-1 text-sm text-muted-foreground dark:text-gray-400 hover:text-foreground dark:hover:text-gray-200 transition-colors mb-3"
                                            >
                                                <span>Thought for {(message.thinking || currentThinking)!.duration}s</span>
                                                <ChevronRight className="w-4 h-4" />
                                            </button>
                                        )}

                                        {/* Inline Thinking (for AI messages only) */}
                                        {message.type === 'ai' && message.inlineThinking && (
                                            <div className="mb-3 pl-4 border-l-2 border-border dark:border-[#2a2a2a]">
                                                <p className="text-sm text-muted-foreground dark:text-gray-400 italic">{message.inlineThinking}</p>
                                            </div>
                                        )}

                                        {/* Text Content */}
                                        {message.content && (
                                            <div className={`mb-4 ${message.type === 'user' ? 'rounded-2xl bg-primary px-4 py-3 text-white' : ''}`}>
                                                {message.type === 'ai' ? <MarkdownContent content={message.content} /> : <p className="whitespace-pre-wrap text-base leading-relaxed text-white">{message.content}</p>}
                                            </div>
                                        )}

                                        {/* Inline Confirmation */}
                                        {message.type === 'ai' && message.confirmation && message.confirmation.shown && (
                                            <InlineConfirmation message={message.confirmation.message} onConfirm={message.confirmation.onConfirm} onCancel={message.confirmation.onCancel} />
                                        )}

                                        {/* Attachments */}
                                        {message.attachments && message.attachments.length > 0 && (
                                            <div className="flex flex-wrap gap-3 mb-4">
                                                {message.attachments.map((att) => (
                                                    <div key={att.id}>
                                                        {att.type === 'image' && att.preview ? (
                                                            <img src={att.preview} alt={att.file.name} className="max-w-sm rounded-lg border border-border dark:border-[#2a2a2a]" />
                                                        ) : (
                                                            <div className="p-3 bg-secondary dark:bg-[#2a2a2a] rounded-lg border border-border dark:border-[#2a2a2a] text-sm dark:text-gray-200">{att.file.name}</div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Dashboard */}
                                        {message.dashboard && (
                                            <div className="w-full mb-4" id={`dashboard-${message.id}`}>
                                                <Card padding="md">
                                                    <div className="space-y-4">
                                                        <div className="flex items-center justify-between">
                                                            <h3 className="text-lg font-semibold">{message.dashboard.title}</h3>
                                                            <Button
                                                                variant="icon"
                                                                iconOnly
                                                                size="sm"
                                                                onClick={() => {
                                                                    const element = document.getElementById(`dashboard-${message.id}`);
                                                                    exportToPDF(element as HTMLDivElement, message.dashboard!.title.replace(/\s+/g, '-').toLowerCase());
                                                                }}
                                                                title="Download as PDF"
                                                            >
                                                                <FileDown className="w-4 h-4" />
                                                            </Button>
                                                        </div>

                                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                                            {message.dashboard.metrics.map((metric, index) => (
                                                                <div key={index} className="p-4 border border-border dark:border-[#2a2a2a] rounded-lg bg-secondary/30 dark:bg-[#2a2a2a]/50">
                                                                    <div className="text-sm text-muted-foreground dark:text-gray-400 mb-1">{metric.label}</div>
                                                                    <div className="text-2xl font-bold mb-1 dark:text-gray-100">{metric.value}</div>
                                                                    <div className={`text-sm ${metric.trend === 'up' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{metric.change}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </Card>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {pendingTyping && (
                                <div className="flex justify-start">
                                    <div className="w-full max-w-full">
                                        <button onClick={() => handleThinkingClick(pendingThinking)} className="mb-3 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground dark:text-gray-400 dark:hover:text-gray-200">
                                            <span>Thought for {pendingThinking.duration}s</span>
                                            <ChevronRight className="h-4 w-4" />
                                        </button>
                                        <div className="inline-flex items-center gap-1 rounded-2xl border border-border bg-white px-4 py-3 dark:border-[#2a2a2a] dark:bg-[#1a1a1a]">
                                            <span className="h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:0ms]" />
                                            <span className="h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
                                            <span className="h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Input Area (sticky bottom) */}
                    <div className="border-t border-border dark:border-[#2a2a2a] px-4 sm:px-8 md:px-16 py-4 bg-white dark:bg-[#0f0f0f]">
                        <div className="max-w-4xl mx-auto">
                            <div className="relative flex items-center gap-3 border border-border dark:border-[#2a2a2a] rounded-full px-4 py-3 shadow-sm bg-white dark:bg-[#1a1a1a] transition-all">
                                <button onClick={() => setShowFileManager(true)} className="p-1 hover:bg-secondary dark:hover:bg-[#2a2a2a] rounded-lg transition-colors flex-shrink-0 dark:text-gray-200" title="Attach files">
                                    <Plus className="w-5 h-5" />
                                </button>

                                <div className="relative flex-1">
                                    <SlashCommandInput
                                        value={input}
                                        onChange={setInput}
                                        onSubmit={() => void handleSend()}
                                        suppressFocusRing
                                        placeholder="Ask anything"
                                        className="border-0 bg-transparent px-0 text-base shadow-none focus:border-transparent focus:ring-0 focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent"
                                    />
                                </div>

                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <div className="relative">
                                        <button onClick={() => setShowModeMenu(!showModeMenu)} className="flex items-center gap-1 text-sm text-muted-foreground dark:text-gray-400 hover:text-foreground dark:hover:text-gray-200 transition-colors">
                                            {getModeIcon()}
                                            <span>{getModeLabel()}</span>
                                            <ChevronRight className={`w-4 h-4 transition-transform ${showModeMenu ? 'rotate-90' : '-rotate-90'}`} />
                                        </button>

                                        {showModeMenu && (
                                            <div className="absolute bottom-full right-0 mb-2 bg-white dark:bg-[#1a1a1a] border border-border dark:border-[#2a2a2a] rounded-lg shadow-lg py-1 min-w-[140px] z-10">
                                                <button
                                                    onClick={() => openModeSelector('agent')}
                                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors dark:text-gray-200 flex items-center gap-2 ${attachmentType === 'agent' ? 'bg-primary/10 text-primary' : ''}`}
                                                >
                                                    <Bot className="w-4 h-4" />
                                                    AI Agent
                                                </button>
                                                <button
                                                    onClick={() => openModeSelector('workflow')}
                                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors dark:text-gray-200 flex items-center gap-2 ${attachmentType === 'workflow' ? 'bg-primary/10 text-primary' : ''}`}
                                                >
                                                    <Zap className="w-4 h-4" />
                                                    Workflow
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setAttachmentType('swarm');
                                                        setRuntimeSelection({ chatMode: 'SWARM', swarmId: null });
                                                        setShowModeMenu(false);
                                                    }}
                                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors dark:text-gray-200 flex items-center gap-2 ${attachmentType === 'swarm' ? 'bg-primary/10 text-primary' : ''}`}
                                                >
                                                    <Network className="w-4 h-4" />
                                                    Swarm
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setAttachmentType('default');
                                                        setRuntimeSelection({ chatMode: 'DEFAULT' });
                                                        setShowModeMenu(false);
                                                    }}
                                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors dark:text-gray-200 ${attachmentType === 'default' ? 'bg-primary/10 text-primary' : ''}`}
                                                >
                                                    Default
                                                </button>
                                                <div className="border-t border-border dark:border-[#2a2a2a] my-1"></div>
                                                <button
                                                    onClick={() => {
                                                        setShowIntelligenceModal(true);
                                                        setShowModeMenu(false);
                                                    }}
                                                    className="w-full text-left px-3 py-2 text-sm hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors dark:text-gray-200 flex items-center gap-2"
                                                >
                                                    <Settings className="w-4 h-4" />
                                                    Configure
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    <button
                                        onClick={handleVoiceRecord}
                                        className={`p-1.5 hover:bg-secondary dark:hover:bg-[#2a2a2a] rounded-lg transition-colors dark:text-gray-200 ${isRecording ? 'bg-red-100 text-red-600 dark:bg-red-900/20' : ''}`}
                                        title={isRecording ? 'Stop recording' : 'Record voice'}
                                    >
                                        {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                                    </button>

                                    <button
                                        onClick={() => void handleSend()}
                                        disabled={isSending || (!input.trim() && attachments.length === 0)}
                                        className={`p-2 rounded-lg transition-colors flex-shrink-0 ${input.trim() || attachments.length > 0 ? 'bg-primary text-white hover:bg-primary/90' : 'bg-secondary text-muted-foreground'}`}
                                    >
                                        <Send className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Attachments Preview */}
                            {attachments.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-3">
                                    {attachments.map((att) => (
                                        <div key={att.id} className="relative group">
                                            {att.type === 'image' && att.preview ? (
                                                <div className="relative">
                                                    <img src={att.preview} alt={att.file.name} className="w-16 h-16 object-cover rounded border border-border dark:border-[#2a2a2a]" />
                                                    <button
                                                        onClick={() => removeAttachment(att.id)}
                                                        className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="relative">
                                                    <div className="w-16 h-16 bg-secondary dark:bg-[#2a2a2a] rounded border border-border dark:border-[#2a2a2a] flex items-center justify-center">
                                                        <span className="text-xs dark:text-gray-200">{att.file.name.split('.').pop()}</span>
                                                    </div>
                                                    <button
                                                        onClick={() => removeAttachment(att.id)}
                                                        className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showActivity && activityThinking && (
                <>
                    <div className="hidden lg:block">
                        <ActivityPanel
                            isOpen={showActivity}
                            onClose={() => setShowActivity(false)}
                            duration={activityThinking.duration}
                            steps={activityThinking.steps}
                            mode="docked"
                        />
                    </div>
                    <div className="lg:hidden">
                        <ActivityPanel
                            isOpen={showActivity}
                            onClose={() => setShowActivity(false)}
                            duration={activityThinking.duration}
                            steps={activityThinking.steps}
                            mode="overlay"
                        />
                    </div>
                </>
            )}

            {/* File Attachment Manager Modal */}
            <FileAttachmentManager isOpen={showFileManager} onClose={() => setShowFileManager(false)} onAttach={handleFileAttach} existingAttachments={attachments} />

            {/* Intelligence Modal */}
            <IntelligenceModal
                isOpen={showIntelligenceModal}
                onClose={() => setShowIntelligenceModal(false)}
                selection={runtimeSelection}
                onSave={(selection) => {
                    setRuntimeSelection(selection);
                    setAttachmentType(selection.chatMode === 'AGENT' ? 'agent' : selection.chatMode === 'WORKFLOW' ? 'workflow' : selection.chatMode === 'SWARM' ? 'swarm' : 'default');
                }}
            />
        </div>
    );
}
