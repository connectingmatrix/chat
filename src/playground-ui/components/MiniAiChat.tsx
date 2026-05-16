import { useEffect, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import type { ChatState } from '@/orm';
import { Button } from './Button';
import { ErrorState } from './ErrorState';
import { Input } from './client/Input';
import { useUiDataContext } from '../contexts/AuthSessionContext';
import { loadAppChatState, sendAppChatMessage } from '../data/chat';

type MiniAiChatProps = {
    agentId?: string | null;
    contextId: string;
    seedPrompt?: string;
    title: string;
};

export function MiniAiChat({ agentId, contextId, seedPrompt, title }: MiniAiChatProps) {
    const context = useUiDataContext();
    const [state, setState] = useState<ChatState | null>(null);
    const [input, setInput] = useState(seedPrompt || '');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const load = async () => {
        setError('');
        try {
            setState(await loadAppChatState(context, 'chat', contextId, title));
        } catch (event) {
            setError(event instanceof Error ? event.message : 'AI chat could not initialize.');
        }
    };

    useEffect(() => {
        void load();
    }, [contextId, title]);

    const send = async () => {
        const content = input.trim();
        if (!content || !state || loading) return;
        setInput('');
        setLoading(true);
        setError('');
        try {
            setState(await sendAppChatMessage(context, state, content, agentId ? { chatMode: 'AGENT', agentId } : { chatMode: 'DEFAULT' }));
        } catch (event) {
            setInput(content);
            setError(event instanceof Error ? event.message : 'AI chat socket request failed.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="rounded-xl border border-border bg-white p-4 dark:border-[#2a2a2a] dark:bg-[#111111]">
            <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h3 className="font-semibold dark:text-gray-100">{title}</h3>
            </div>
            <div className="giga-scrollbar mb-3 max-h-56 min-h-24 overflow-y-auto rounded-lg bg-secondary/40 p-3 dark:bg-[#0a0a0a]">
                {state?.messages.length ? (
                    <div className="space-y-3">
                        {state.messages.map((message) => (
                            <div key={message.id} className={message.role === 'user' ? 'text-right' : 'text-left'}>
                                <span className={`inline-block max-w-[90%] rounded-xl px-3 py-2 text-sm ${message.role === 'user' ? 'bg-primary text-white' : 'bg-white dark:bg-[#1a1a1a] dark:text-gray-200'}`}>{message.content}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">Send a prompt to test this configuration through the chat socket.</p>
                )}
            </div>
            {error && <ErrorState inline title="Test chat unavailable" message={error} onRetry={load} />}
            <div className="mt-3 flex gap-2">
                <Input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void send()} placeholder="Test the AI behavior..." disabled={loading || !state} />
                <Button onClick={send} disabled={loading || !state || !input.trim()}>
                    {loading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" /> : <Send className="h-4 w-4" />}
                </Button>
            </div>
        </div>
    );
}
