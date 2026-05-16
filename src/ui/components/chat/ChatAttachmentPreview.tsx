import { X } from 'lucide-react';
import type { Attachment } from '../FileAttachmentManager';

interface ChatAttachmentPreviewProps {
    attachments: Attachment[];
    onRemove: (id: string) => void;
}

export function ChatAttachmentPreview({ attachments, onRemove }: ChatAttachmentPreviewProps) {
    if (!attachments.length) return null;
    return (
        <div className="mt-3 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
                <div key={attachment.id} className="group relative">
                    {attachment.type === 'image' && attachment.preview ? (
                        <div className="relative">
                            <img src={attachment.preview} alt={attachment.file.name} className="h-16 w-16 rounded border border-border object-cover dark:border-[#2a2a2a]" />
                            <button onClick={() => onRemove(attachment.id)} className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white opacity-0 transition-opacity group-hover:opacity-100">
                                <X className="h-3 w-3" />
                            </button>
                        </div>
                    ) : (
                        <div className="relative">
                            <div className="flex h-16 w-16 items-center justify-center rounded border border-border bg-secondary dark:border-[#2a2a2a] dark:bg-[#2a2a2a]">
                                <span className="text-xs dark:text-gray-200">{attachment.file.name.split('.').pop()}</span>
                            </div>
                            <button onClick={() => onRemove(attachment.id)} className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white opacity-0 transition-opacity group-hover:opacity-100">
                                <X className="h-3 w-3" />
                            </button>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
