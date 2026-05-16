import { ChevronRight } from 'lucide-react';

interface ChatThinkingButtonProps {
    duration: number;
    onClick: () => void;
    className?: string;
}

export function ChatThinkingButton({ duration, onClick, className = '' }: ChatThinkingButtonProps) {
    return (
        <button onClick={onClick} className={`flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground dark:text-gray-400 dark:hover:text-gray-200 ${className}`}>
            <span>Thought for {duration}s</span>
            <ChevronRight className="h-4 w-4" />
        </button>
    );
}
