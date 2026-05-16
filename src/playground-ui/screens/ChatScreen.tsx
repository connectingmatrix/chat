import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { RotateCcw, Send, Sparkles } from 'lucide-react';
import type { ChatState } from '@/orm';
import { Button } from '../components/Button';
import { ErrorState } from '../components/ErrorState';
import { SlashCommandInput } from '../components/SlashCommandInput';
import { useUiDataContext } from '../contexts/AuthSessionContext';
import { loadAppChatState, sendAppChatMessage } from '../data/chat';

export function ChatScreen() {
    const { contextType, contextId } = useParams();
    const [chatState, setChatState] = useState<ChatState | null>(null);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [failedMessage, setFailedMessage] = useState('');
    const context = useUiDataContext();

    const contextName = chatState?.scope.title || 'Loading';
    const messages = chatState ? chatState.messages : [];

    const loadChat = async () => {
        setIsLoading(true);
        setError('');
        try {
            setChatState(await loadAppChatState(context, contextType, contextId));
        } catch {
            setError('Chat data loader could not initialize for this context.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void loadChat();
    }, [contextType, contextId]);

    const handleSend = async () => {
        const content = input.trim();
        if (!content || isLoading || !chatState) return;
        setInput('');
        setIsLoading(true);
        setError('');
        try {
            setChatState(await sendAppChatMessage(context, chatState, content));
            setFailedMessage('');
        } catch {
            setFailedMessage(content);
            setError('Chat socket request failed.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleRetry = () => {
        setInput(failedMessage);
        setError('');
    };

    return (
        <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-secondary/30 dark:bg-[#0f0f0f]">
            <header className="flex flex-shrink-0 items-center justify-between border-b border-border bg-white px-6 py-4 dark:border-[#2a2a2a] dark:bg-[#1a1a1a]">
                <div>
                    <h1 className="flex items-center gap-2 font-semibold">
                        <Sparkles className="h-5 w-5 text-primary" />
                        GIGA AI
                    </h1>
                    <div className="mt-0.5 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Context:</span>
                        <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{contextName}</span>
                    </div>
                </div>
                <Button variant="ghost" size="sm" className="gap-2" onClick={loadChat}>
                    <RotateCcw className="h-4 w-4" />
                    New Chat
                </Button>
            </header>

            <div className="giga-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-6">
                <div className="mx-auto max-w-3xl space-y-6">
                    {messages.map((message) => (
                        <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {message.role !== 'user' && (
                                <div className="mr-3 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary">
                                    <Sparkles className="h-5 w-5 text-white" />
                                </div>
                            )}
                            <div className="max-w-2xl">
                                <div className={`rounded-2xl px-4 py-3 ${message.role === 'user' ? 'bg-primary text-white' : 'border border-border bg-white dark:border-[#2a2a2a] dark:bg-[#1a1a1a]'}`}>
                                    <p className="whitespace-pre-wrap text-sm leading-relaxed break-words dark:text-gray-200">{message.content}</p>
                                    <p className={`mt-2 text-xs ${message.role === 'user' ? 'text-white/70' : 'text-muted-foreground dark:text-gray-400'}`}>{new Date(message.createdAt).toLocaleTimeString()}</p>
                                </div>
                            </div>
                            {message.role === 'user' && <div className="ml-3 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">U</div>}
                        </div>
                    ))}

                    {error && <ErrorState inline title="Chat unavailable" message={error} onRetry={failedMessage ? handleRetry : loadChat} />}

                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="mr-3 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary">
                                <Sparkles className="h-5 w-5 text-white" />
                            </div>
                            <div className="rounded-2xl border border-border bg-white px-4 py-3 dark:border-[#2a2a2a] dark:bg-[#1a1a1a]">
                                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                                    <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                                    <span>Thinking...</span>
                                </div>
                                <div className="flex gap-1">
                                    <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" />
                                    <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                                    <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-shrink-0 border-t border-border bg-white px-6 py-4 dark:border-[#2a2a2a] dark:bg-[#1a1a1a]">
                <div className="relative mx-auto max-w-3xl">
                    <div className="flex gap-3">
                        <SlashCommandInput value={input} onChange={setInput} onSubmit={() => void handleSend()} disabled={isLoading || !chatState} placeholder="Ask a question or type / for commands..." className="rounded-xl px-4 py-3" />
                        <Button onClick={handleSend} size="lg" className="gap-2" disabled={isLoading || !input.trim() || !chatState}>
                            {isLoading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" /> : <Send className="h-4 w-4" />}
                        </Button>
                    </div>
                    <p className="mt-2 text-center text-xs text-muted-foreground dark:text-gray-400">
                        AI answers are contextual to <span className="font-medium">{contextName}</span>. Responses may contain errors.
                    </p>
                </div>
            </div>
        </div>
    );
}
