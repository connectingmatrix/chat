import { useState, ReactNode } from "react";
import { User, Bot, ChevronDown, ChevronUp, Check, X, ChevronRight } from "lucide-react";
import { Button } from "./Button";
import { Card } from "./Card";
import { FileListViewer, FileAttachment } from "./FileViewer";
import { AgentOutputPreview } from "./editors/AgentOutputPreview";

// Re-export FileAttachment for convenience
export type { FileAttachment };

export interface ThinkingStep {
  title: string;
  content: string;
  duration?: string;
}

export interface ConfirmationAction {
  question: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface DashboardMetric {
  label: string;
  value: string;
  change: string;
}

export interface Dashboard {
  title: string;
  metrics: DashboardMetric[];
}

interface ChatMessageProps {
  sender: 'user' | 'ai';
  content: string;
  timestamp?: string;
  thinking?: ThinkingStep[];
  showThinking?: boolean;
  inlineThinking?: string;
  confirmation?: ConfirmationAction;
  avatar?: string;
  thinkingDuration?: number;
  onThinkingClick?: () => void;
  dashboard?: Dashboard;
  attachments?: FileAttachment[];
}

export function ChatMessage({
  sender,
  content,
  timestamp,
  thinking,
  showThinking = false,
  inlineThinking,
  confirmation,
  avatar,
  thinkingDuration,
  onThinkingClick,
  dashboard,
  attachments,
}: ChatMessageProps) {
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(showThinking);
  const [showConfirmation, setShowConfirmation] = useState(!!confirmation);

  return (
    <div className={`flex gap-4 ${sender === 'user' ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
        sender === 'user' ? 'bg-primary/10' : 'bg-gradient-to-br from-primary to-primary/80'
      }`}>
        {avatar ? (
          <img src={avatar} alt={sender} className="w-full h-full rounded-full" />
        ) : sender === 'user' ? (
          <User className="w-5 h-5 text-primary" />
        ) : (
          <Bot className="w-5 h-5 text-white" />
        )}
      </div>

      {/* Message Content */}
      <div className={`flex-1 max-w-3xl space-y-3 ${sender === 'user' ? 'items-end' : 'items-start'}`}>
        {/* AI Thinking Duration Link */}
        {sender === 'ai' && thinkingDuration && onThinkingClick && (
          <button
            onClick={onThinkingClick}
            className="flex items-center gap-1 text-xs text-muted-foreground dark:text-gray-400 hover:text-primary dark:hover:text-primary transition-colors"
          >
            <span>Thought for {thinkingDuration}s</span>
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
        {/* Thinking Steps (ChatGPT-like expandable) */}
        {thinking && thinking.length > 0 && (
          <div className="w-full bg-secondary/50 dark:bg-[#1a1a1a] border border-border dark:border-[#2a2a2a] rounded-xl overflow-hidden">
            <button
              onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-secondary dark:hover:bg-[#2a2a2a] transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                <span className="text-sm font-medium dark:text-gray-200">
                  {isThinkingExpanded ? 'Hide thinking' : 'Show thinking'}
                </span>
                <span className="text-xs text-muted-foreground dark:text-gray-400">
                  {thinking.length} {thinking.length === 1 ? 'step' : 'steps'}
                </span>
              </div>
              {isThinkingExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            {isThinkingExpanded && (
              <div className="border-t border-border dark:border-[#2a2a2a] p-4 space-y-3 bg-white dark:bg-[#0f0f0f]">
                {thinking.map((step, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                        {index + 1}
                      </div>
                      <h4 className="text-sm font-medium dark:text-gray-200">{step.title}</h4>
                      {step.duration && (
                        <span className="text-xs text-muted-foreground dark:text-gray-400">({step.duration})</span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground dark:text-gray-400 pl-8">{step.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Inline Thinking (subtle) */}
        {inlineThinking && (
          <div className="w-full px-4 py-2 bg-primary/5 dark:bg-primary/10 border-l-4 border-primary rounded-r-lg">
            <p className="text-xs text-muted-foreground dark:text-gray-400 italic">
              💭 {inlineThinking}
            </p>
          </div>
        )}

        {/* File Attachments */}
        {attachments && attachments.length > 0 && (
          <div className={`w-full ${sender === 'user' ? 'ml-auto' : ''}`}>
            <FileListViewer files={attachments} />
          </div>
        )}

        {/* Main Message */}
        {content && (
          <div className={`rounded-2xl px-4 py-3 ${
            sender === 'user'
              ? 'bg-primary text-white ml-auto'
              : 'bg-white dark:bg-[#1a1a1a] border border-border dark:border-[#2a2a2a]'
          }`}>
            {sender === 'ai' ? (
              <AgentOutputPreview content={content} className="text-sm leading-relaxed dark:text-gray-200" />
            ) : (
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{content}</p>
            )}
          </div>
        )}

        {/* Confirmation Dialog (in message) */}
        {showConfirmation && confirmation && (
          <div className="w-full bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4">
            <p className="text-sm font-medium text-yellow-900 dark:text-yellow-200 mb-3">
              ⚠️ {confirmation.question}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  confirmation.onConfirm();
                  setShowConfirmation(false);
                }}
                className="gap-2"
              >
                <Check className="w-4 h-4" />
                Confirm
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  confirmation.onCancel();
                  setShowConfirmation(false);
                }}
                className="gap-2"
              >
                <X className="w-4 h-4" />
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Dashboard Metrics */}
        {sender === 'ai' && dashboard && (
          <Card className="mt-3">
            <h3 className="font-semibold mb-4 dark:text-gray-100">{dashboard.title}</h3>
            <div className="grid grid-cols-2 gap-4">
              {dashboard.metrics.map((metric, i) => (
                <div
                  key={i}
                  className="p-4 border border-border dark:border-[#2a2a2a] rounded-lg bg-secondary/30 dark:bg-[#0f0f0f]"
                >
                  <div className="text-sm text-muted-foreground dark:text-gray-400">
                    {metric.label}
                  </div>
                  <div className="text-2xl font-bold mt-1 dark:text-gray-100">
                    {metric.value}
                  </div>
                  <div className="text-sm text-green-600 dark:text-green-400 mt-1">
                    {metric.change}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Timestamp */}
        {timestamp && (
          <p className={`text-xs text-muted-foreground dark:text-gray-400 ${
            sender === 'user' ? 'text-right' : 'text-left'
          }`}>
            {timestamp}
          </p>
        )}
      </div>
    </div>
  );
}
