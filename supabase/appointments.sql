-- Appointments + push reminders for Agent Space
-- Run once in Supabase SQL editor (project szdzbycppkavfwuzlljh)

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references auth.users(id) on delete cascade,
  client_name text not null,
  client_phone text,
  appt_type text not null default 'Presentation',
  starts_at timestamptz not null,
  duration_min int not null default 60,
  notes text,
  status text not null default 'scheduled',
  dispo_note text,
  reminder_min int not null default 30,
  reminder_sent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists appointments_agent_start_idx on public.appointments(agent_id, starts_at);
create index if not exists appointments_reminder_idx on public.appointments(reminder_sent, starts_at) where status = 'scheduled';

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists appointments_touch on public.appointments;
create trigger appointments_touch before update on public.appointments
  for each row execute function public.touch_updated_at();

create or replace function public.is_owner_or_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('owner','admin'));
$$;

alter table public.appointments enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists appt_select on public.appointments;
create policy appt_select on public.appointments for select
  using (agent_id = auth.uid() or public.is_owner_or_admin());
drop policy if exists appt_insert on public.appointments;
create policy appt_insert on public.appointments for insert
  with check (agent_id = auth.uid());
drop policy if exists appt_update on public.appointments;
create policy appt_update on public.appointments for update
  using (agent_id = auth.uid() or public.is_owner_or_admin());
drop policy if exists appt_delete on public.appointments;
create policy appt_delete on public.appointments for delete
  using (agent_id = auth.uid() or public.is_owner_or_admin());

drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
