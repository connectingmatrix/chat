import { RotateCcw } from 'lucide-react';
import { InlineConfirmation } from '../InlineConfirmation';
import { MarkdownContent } from '../editors/MarkdownContent';
import type { Attachment } from '../FileAttachmentManager';
import type { ThinkingStep } from '../ActivityPanel';
import { ChatDashboardCard } from './ChatDashboardCard';
import { ChatThinkingButton } from './ChatThinkingButton';

interface ThinkingData {
    duration: number;
    steps: ThinkingStep[];
}
interface ConfirmationData {
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    shown: boolean;
}
interface DashboardMetric {
    label: string;
    value: string;
    change: string;
    trend: 'up' | 'down';
}
interface DashboardData {
    title: string;
    metrics: DashboardMetric[];
}
interface ChatMessageModel {
    id: string;
    type: 'user' | 'ai';
    content: string;
    attachments?: Attachment[];
    thinking?: ThinkingData;
    inlineThinking?: string;
    confirmation?: ConfirmationData;
    dashboard?: DashboardData;
    sendStatus?: 'failed' | 'retrying';
    sendError?: string;
}

interface ChatMessageItemProps {
    message: ChatMessageModel;
    onThinkingClick: (thinking: ThinkingData) => void;
    onRetry: (messageId: string) => void;
    onExportDashboard: (messageId: string, title: string) => void;
}

export function ChatMessageItem({ message, onThinkingClick, onRetry, onExportDashboard }: ChatMessageItemProps) {
    return (
        <div className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`${message.type === 'user' ? 'max-w-2xl' : 'w-full max-w-full'}`}>
                {message.type === 'ai' && message.thinking && <ChatThinkingButton duration={message.thinking.duration} onClick={() => onThinkingClick(message.thinking)} className="mb-3" />}
                {message.type === 'ai' && message.inlineThinking && <div className="mb-3 border-l-2 border-border pl-4 dark:border-[#2a2a2a]"><p className="text-sm italic text-muted-foreground dark:text-gray-400">{message.inlineThinking}</p></div>}
                {message.content && <div className={`mb-4 ${message.type === 'user' ? 'rounded-2xl bg-primary px-4 py-3 text-white' : ''}`}>{message.type === 'ai' ? <MarkdownContent content={message.content} /> : <p className="whitespace-pre-wrap text-base leading-relaxed text-white">{message.content}</p>}</div>}
                {message.type === 'user' && message.sendStatus && (
                    <div className="mb-4 flex justify-end"><div className="flex items-center gap-3 text-xs"><span className={message.sendStatus === 'retrying' ? 'text-muted-foreground dark:text-gray-400' : 'text-destructive'}>{message.sendStatus === 'retrying' ? 'Retrying...' : message.sendError || 'Message failed'}</span>{message.sendStatus === 'failed' && <button type="button" onClick={() => onRetry(message.id)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-foreground transition-colors hover:bg-secondary dark:border-[#2a2a2a] dark:text-gray-200 dark:hover:bg-[#2a2a2a]"><RotateCcw className="h-3 w-3" />Retry</button>}</div></div>
                )}
                {message.type === 'ai' && message.confirmation?.shown && <InlineConfirmation message={message.confirmation.message} onConfirm={message.confirmation.onConfirm} onCancel={message.confirmation.onCancel} />}
                {message.attachments && message.attachments.length > 0 && (
                    <div className="mb-4 flex flex-wrap gap-3">
                        {message.attachments.map((att) => (
                            <div key={att.id}>{att.type === 'image' && att.preview ? <img src={att.preview} alt={att.file.name} className="max-w-sm rounded-lg border border-border dark:border-[#2a2a2a]" /> : <div className="rounded-lg border border-border bg-secondary p-3 text-sm dark:border-[#2a2a2a] dark:bg-[#2a2a2a] dark:text-gray-200">{att.file.name}</div>}</div>
                        ))}
                    </div>
                )}
                {message.dashboard && <ChatDashboardCard messageId={message.id} dashboard={message.dashboard} onExport={onExportDashboard} />}
            </div>
        </div>
    );
}
