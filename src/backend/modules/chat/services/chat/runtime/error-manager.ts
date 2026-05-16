type ChatErrorCause = {
  code?: string | null;
  constraint?: string | null;
  message?: string | null;
  details?: string | null;
  cause?: ChatErrorCause | null;
};

type ChatErrorTrace = {
  code: string;
  constraint: string;
  message: string;
  details: string;
  combined: string;
};

const readText = (value?: string | null): string => String(value || '').trim();

export const readChatErrorTrace = (error: unknown): ChatErrorTrace => {
  const payload = (error || null) as ChatErrorCause | null;
  const cause = payload?.cause || null;
  const code = readText(payload?.code || cause?.code);
  const constraint = readText(payload?.constraint || cause?.constraint);
  const message = readText(payload?.message || cause?.message || String(error || ''));
  const details = readText(payload?.details || cause?.details);
  const combined = `${message} ${constraint} ${details}`.trim().toLowerCase();
  return { code, constraint, message, details, combined };
};

export const isChatSessionScopeConflict = (error: unknown): boolean => {
  const trace = readChatErrorTrace(error);
  const hasIndexMarker =
    trace.combined.includes('ai_chat_sessions_user_scope_uidx') ||
    trace.combined.includes('ai_chat_sessions') ||
    trace.combined.includes('scope_uidx');
  const hasUniqueMarker = trace.combined.includes('duplicate key value') || trace.combined.includes('unique constraint');
  return trace.code === '23505' ? hasUniqueMarker || hasIndexMarker : hasIndexMarker && hasUniqueMarker;
};
