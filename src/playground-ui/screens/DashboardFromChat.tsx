import { useEffect, useState } from "react";
import type { ChatState } from "@/orm";
import { Send, BarChart3, ChevronRight } from "lucide-react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { IntelligenceModal } from "../components/IntelligenceModal";
import { useUiDataContext } from "../contexts/AuthSessionContext";
import { loadAppChatState, sendAppChatMessage } from "../data/chat";
import type { ChatRuntimeSelection } from "../data/chat";

type ModelMode = 'standard' | 'extended' | 'creative';

export function DashboardFromChat() {
  const context = useUiDataContext();
  const [chatInput, setChatInput] = useState('');
  const [responseText, setResponseText] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatState, setChatState] = useState<ChatState | null>(null);
  const [showIntelligenceModal, setShowIntelligenceModal] = useState(false);
  const [modelMode, setModelMode] = useState<ModelMode>('extended');
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [runtimeSelection, setRuntimeSelection] = useState<ChatRuntimeSelection>({ chatMode: 'DEFAULT' });

  useEffect(() => {
    loadAppChatState(context)
      .then(setChatState)
      .catch(() => setError('Chat data loader could not initialize.'));
  }, [context]);

  const handleGenerateDashboard = async () => {
    const content = chatInput.trim();
    if (!content || !chatState || isLoading) return;

    setIsLoading(true);
    setError('');
    try {
      const nextState = await sendAppChatMessage(context, chatState, content, runtimeSelection);
      const assistant = nextState.messages[nextState.messages.length - 1];
      setChatState(nextState);
      setResponseText(assistant.content);
      setChatInput('');
    } catch {
      setError('Dashboard chat request failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const getModeLabel = () => {
    switch (modelMode) {
      case 'standard': return 'Standard';
      case 'extended': return 'Extended';
      case 'creative': return 'Creative';
      default: return 'Extended';
    }
  };

  return (
    <div className="flex flex-col h-screen bg-secondary/30 dark:bg-[#0f0f0f]">
      <div className="bg-white dark:bg-[#1a1a1a] border-b border-border dark:border-[#2a2a2a] p-6">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-semibold dark:text-gray-200 mb-4">AI Dashboard Generator</h1>
          <div className="flex gap-3">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleGenerateDashboard()}
              placeholder="Ask AI to generate a dashboard... (e.g., 'Show me a sales performance dashboard')"
              className="flex-1 px-4 py-3 border border-border dark:border-[#2a2a2a] rounded-lg bg-white dark:bg-[#0f0f0f] dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <div className="relative">
              <button
                onClick={() => setShowModeMenu(!showModeMenu)}
                className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground dark:text-gray-400 hover:text-foreground dark:hover:text-gray-200 transition-colors border border-border dark:border-[#2a2a2a] rounded-lg bg-white dark:bg-[#0f0f0f] hover:bg-secondary dark:hover:bg-[#2a2a2a]"
              >
                <span>{getModeLabel()}</span>
                <ChevronRight className={`w-4 h-4 transition-transform ${showModeMenu ? 'rotate-90' : '-rotate-90'}`} />
              </button>

              {showModeMenu && (
                <div className="absolute top-full right-0 mt-2 bg-white dark:bg-[#1a1a1a] border border-border dark:border-[#2a2a2a] rounded-lg shadow-lg py-1 min-w-[120px] z-10">
                  <button onClick={() => { setModelMode('standard'); setShowModeMenu(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors dark:text-gray-200 ${modelMode === 'standard' ? 'bg-primary/10 text-primary dark:bg-primary/20' : ''}`}>Standard</button>
                  <button onClick={() => { setShowIntelligenceModal(true); setShowModeMenu(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors dark:text-gray-200 ${modelMode === 'extended' ? 'bg-primary/10 text-primary dark:bg-primary/20' : ''}`}>Extended</button>
                  <button onClick={() => { setModelMode('creative'); setShowModeMenu(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors dark:text-gray-200 ${modelMode === 'creative' ? 'bg-primary/10 text-primary dark:bg-primary/20' : ''}`}>Creative</button>
                </div>
              )}
            </div>
            <Button onClick={handleGenerateDashboard} disabled={!chatInput.trim() || !chatState || isLoading} className="gap-2">
              <Send className="w-4 h-4" />
              {isLoading ? 'Generating' : 'Generate'}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {responseText ? (
          <div className="max-w-7xl mx-auto space-y-6">
            <Card padding="md" className="bg-primary/5 dark:bg-primary/10 border-l-4 border-l-primary">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-primary text-white rounded-lg flex items-center justify-center">AI</div>
                <p className="text-sm text-muted-foreground dark:text-gray-300 whitespace-pre-wrap">{responseText}</p>
              </div>
            </Card>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto text-center py-20">
            <div className="w-20 h-20 bg-primary/10 rounded-lg mx-auto flex items-center justify-center mb-6">
              <BarChart3 className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-2xl font-semibold dark:text-gray-200 mb-4">Generate AI-Powered Dashboards</h2>
            <p className="text-muted-foreground dark:text-gray-400 mb-8 max-w-2xl mx-auto">
              Describe the dashboard you want to create, and the chat runtime will return the available dashboard plan or data contract.
            </p>
            {error && <p className="text-sm text-destructive dark:text-red-400 mb-4">{error}</p>}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
              {['Show me a sales performance dashboard', 'Create a customer analytics overview', 'Build a marketing metrics dashboard'].map((example) => (
                <button key={example} onClick={() => setChatInput(example)} className="p-4 border border-border dark:border-[#2a2a2a] rounded-lg bg-white dark:bg-[#1a1a1a] dark:text-gray-200 hover:border-primary transition-colors text-sm">
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <IntelligenceModal
        isOpen={showIntelligenceModal}
        onClose={() => setShowIntelligenceModal(false)}
        selection={runtimeSelection}
        onSave={(selection) => setRuntimeSelection(selection)}
      />
    </div>
  );
}
