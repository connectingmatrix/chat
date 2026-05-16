alter table if exists public.ai_chat_sessions drop constraint if exists ai_chat_sessions_scope_type_check;

alter table if exists public.ai_chat_sessions
  add constraint ai_chat_sessions_scope_type_check
  check (scope_type is null or scope_type in ('channel', 'category', 'subject', 'post', 'temporary'));
