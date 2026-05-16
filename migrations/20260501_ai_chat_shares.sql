create table if not exists public.ai_chat_shares (
  chat_id uuid primary key references public.ai_chat_sessions(id) on delete cascade,
  share_token text not null unique,
  snapshot jsonb not null,
  published_at timestamptz not null default now(),
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_chat_shares_share_token_check check (length(trim(share_token)) > 0)
);

create index if not exists ai_chat_shares_share_token_idx on public.ai_chat_shares (share_token);
create index if not exists ai_chat_shares_published_at_idx on public.ai_chat_shares (published_at desc);
create index if not exists ai_chat_shares_active_idx on public.ai_chat_shares (chat_id) where revoked_at is null;
