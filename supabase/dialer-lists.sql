-- Personal call lists (up to 3 per agent). Leads keep living in lead_pool; list_id tags which list they're in.
create table if not exists public.dialer_lists (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  position int not null default 1,
  created_at timestamptz not null default now()
);
alter table public.dialer_lists enable row level security;
drop policy if exists dlists_own on public.dialer_lists;
create policy dlists_own on public.dialer_lists for all using (agent_id = auth.uid() or public.is_owner_or_admin()) with check (agent_id = auth.uid() or public.is_owner_or_admin());
alter table public.lead_pool add column if not exists list_id uuid references public.dialer_lists(id) on delete set null;
create index if not exists lead_pool_list_idx on public.lead_pool(list_id);
alter table public.dialer_config add column if not exists contact_min_sec int not null default 20;
