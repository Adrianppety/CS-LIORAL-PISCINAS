create table public.username_accounts (
  username text primary key
    check (username ~ '^[a-z0-9][a-z0-9._-]{2,23}$'),
  user_id uuid not null unique
    references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.username_accounts enable row level security;
revoke all on public.username_accounts from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert on public.username_accounts to service_role;
