import { Bot, ChevronRight, Mic, MicOff, Network, Plus, Send, Settings, Zap } from 'lucide-react';
import type { Attachment } from '../FileAttachmentManager';
import { SlashCommandInput } from '../SlashCommandInput';
import { ChatAttachmentPreview } from './ChatAttachmentPreview';
import { useState } from 'react';

interface UnifiedChatBarProps {
    attachments: Attachment[];
    input: string;
    isRecording: boolean;
    isSending: boolean;
    mode: 'agent' | 'workflow' | 'swarm' | 'default';
    onAttachClick: () => void;
    onChangeInput: (value: string) => void;
    onOpenModeSelector: (mode: 'agent' | 'workflow' | 'swarm') => void;
    onOpenSettings: () => void;
    onRemoveAttachment: (id: string) => void;
    onSend: () => void;
    onSetDefaultMode: () => void;
    onVoiceRecord: () => void;
}

const modeLabel = (mode: UnifiedChatBarProps['mode']) => (mode === 'agent' ? 'AI Agent' : mode === 'workflow' ? 'Workflow' : mode === 'swarm' ? 'Swarm' : 'Default');
const modeIcon = (mode: UnifiedChatBarProps['mode']) => (mode === 'agent' ? <Bot className="h-4 w-4" /> : mode === 'workflow' ? <Zap className="h-4 w-4" /> : mode === 'swarm' ? <Network className="h-4 w-4" /> : null);

export function UnifiedChatBar({ attachments, input, isRecording, isSending, mode, onAttachClick, onChangeInput, onOpenModeSelector, onOpenSettings, onRemoveAttachment, onSend, onSetDefaultMode, onVoiceRecord }: UnifiedChatBarProps) {
    const [showModeMenu, setShowModeMenu] = useState(false);
    const selectableClass = (selected: boolean) => `w-full text-left px-3 py-2 text-sm transition-colors dark:text-gray-200 ${selected ? 'bg-primary/10 text-primary' : 'hover:bg-secondary dark:hover:bg-[#2a2a2a]'}`;
    return (
        <>
            <div className="relative flex items-center gap-3 rounded-full border border-border bg-white px-4 py-3 shadow-sm transition-all dark:border-[#2a2a2a] dark:bg-[#1a1a1a]">
                <button onClick={onAttachClick} className="flex-shrink-0 rounded-lg p-1 transition-colors hover:bg-secondary dark:text-gray-200 dark:hover:bg-[#2a2a2a]" title="Attach files"><Plus className="h-5 w-5" /></button>
                <div className="relative flex-1">
                    <SlashCommandInput value={input} onChange={onChangeInput} onSubmit={onSend} suppressFocusRing placeholder="Ask anything" className="border-0 bg-transparent px-0 text-base shadow-none focus:border-transparent focus:ring-0 focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent" />
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                    <div className="relative">
                        <button onClick={() => setShowModeMenu((value) => !value)} className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground dark:text-gray-400 dark:hover:text-gray-200">
                            {modeIcon(mode)}
                            <span>{modeLabel(mode)}</span>
                            <ChevronRight className={`h-4 w-4 transition-transform ${showModeMenu ? 'rotate-90' : '-rotate-90'}`} />
                        </button>
                        {showModeMenu ? (
                            <div className="absolute bottom-full right-0 z-10 mb-2 min-w-[140px] rounded-lg border border-border bg-white py-1 shadow-lg dark:border-[#2a2a2a] dark:bg-[#1a1a1a]">
                                <button onClick={() => { onOpenModeSelector('agent'); setShowModeMenu(false); }} className={`${selectableClass(mode === 'agent')} flex items-center gap-2`}><Bot className="h-4 w-4" />AI Agent</button>
                                <button onClick={() => { onOpenModeSelector('workflow'); setShowModeMenu(false); }} className={`${selectableClass(mode === 'workflow')} flex items-center gap-2`}><Zap className="h-4 w-4" />Workflow</button>
                                <button onClick={() => { onOpenModeSelector('swarm'); setShowModeMenu(false); }} className={`${selectableClass(mode === 'swarm')} flex items-center gap-2`}><Network className="h-4 w-4" />Swarm</button>
                                <button onClick={() => { onSetDefaultMode(); setShowModeMenu(false); }} className={selectableClass(mode === 'default')}>Default</button>
                                <div className="my-1 border-t border-border dark:border-[#2a2a2a]" />
                                <button onClick={() => { onOpenSettings(); setShowModeMenu(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary dark:text-gray-200 dark:hover:bg-[#2a2a2a]"><Settings className="h-4 w-4" />Configure</button>
                            </div>
                        ) : null}
                    </div>
                    <button onClick={onVoiceRecord} className={`rounded-lg p-1.5 transition-colors hover:bg-secondary dark:text-gray-200 dark:hover:bg-[#2a2a2a] ${isRecording ? 'bg-red-100 text-red-600 dark:bg-red-900/20' : ''}`} title={isRecording ? 'Stop recording' : 'Record voice'}>
                        {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                    </button>
                    <button onClick={onSend} disabled={isSending || (!input.trim() && attachments.length === 0)} className={`rounded-lg p-2 transition-colors ${input.trim() || attachments.length > 0 ? 'bg-primary text-white hover:bg-primary/90' : 'bg-secondary text-muted-foreground'}`}>
                        <Send className="h-4 w-4" />
                    </button>
                </div>
            </div>
            <ChatAttachmentPreview attachments={attachments} onRemove={onRemoveAttachment} />
        </>
    );
}
