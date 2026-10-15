-- Surge Dialer — run once in Supabase SQL editor (project szdzbycppkavfwuzlljh)
-- Multi-line power dialer on Twilio. Leads come from lead_pool (same table Lead Distribution uses).

-- ---- lead_pool additions (call state lives on the lead) ----
alter table public.lead_pool add column if not exists attempts int not null default 0;
alter table public.lead_pool add column if not exists last_attempt_at timestamptz;
alter table public.lead_pool add column if not exists last_dispo text;
alter table public.lead_pool add column if not exists callback_at timestamptz;
alter table public.lead_pool add column if not exists dnc boolean not null default false;
alter table public.lead_pool add column if not exists notes text;
alter table public.lead_pool add column if not exists tz text;
create index if not exists lead_pool_agent_dial_idx on public.lead_pool(agent_id, sold_at, dnc, last_attempt_at);

-- ---- private settings (Twilio API key / TwiML app / trust product SIDs). NO client access. ----
create table if not exists public.dialer_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table public.dialer_settings enable row level security;
-- no policies on purpose: only the service role (Netlify functions) can read/write

-- ---- public config (owner-editable, agents read) ----
create table if not exists public.dialer_config (
  id int primary key default 1 check (id = 1),
  business_name text not null default 'Surge Partners',
  callback_number text,
  max_lines int not null default 2,
  hours_start int not null default 9,   -- local hour (called party)
  hours_end int not null default 20,
  max_attempts_day int not null default 3,
  calls_per_number_day int not null default 75,
  record_calls boolean not null default true,
  recording_notice text not null default 'This call may be recorded for quality and training.',
  abandon_message text not null default 'Sorry we missed you. This was Surge Partners calling about your life insurance request. Call us back at the number on your caller ID.',
  amd_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.dialer_config (id) values (1) on conflict do nothing;
alter table public.dialer_config enable row level security;
drop policy if exists dcfg_read on public.dialer_config;
create policy dcfg_read on public.dialer_config for select using (auth.uid() is not null);
drop policy if exists dcfg_write on public.dialer_config;
create policy dcfg_write on public.dialer_config for update using (public.is_owner_or_admin());

-- ---- number pool (caller IDs). Rotated by daily cap; benched when flagged. ----
create table if not exists public.dialer_numbers (
  phone text primary key,                 -- E.164
  sid text,
  agent_id uuid references auth.users(id) on delete set null,  -- preferred owner (inbound routes here)
  area_code text,
  state text,
  status text not null default 'active',  -- active | benched | remediating | released
  calls_today int not null default 0,
  calls_total int not null default 0,
  calls_day date,
  answer_rate numeric,
  last_used_at timestamptz,
  flagged_at timestamptz,
  benched_at timestamptz,
  remediation_sent_at timestamptz,
  attestation text,                        -- A | B | C | unknown
  registered_fcr boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.dialer_numbers enable row level security;
drop policy if exists dnum_read on public.dialer_numbers;
create policy dnum_read on public.dialer_numbers for select using (auth.uid() is not null);
drop policy if exists dnum_write on public.dialer_numbers;
create policy dnum_write on public.dialer_numbers for all using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

-- ---- dialing sessions (one per agent while they're in the dialer) ----
create table if not exists public.dialer_sessions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references auth.users(id) on delete cascade,
  identity text not null,                 -- twilio client identity
  lines int not null default 2,
  status text not null default 'idle',    -- idle | dialing | connected | ended
  active_call_sid text,                   -- the lead leg currently bridged to the agent
  active_phone text,
  dials int not null default 0,
  contacts int not null default 0,
  talk_sec int not null default 0,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists dsess_agent_idx on public.dialer_sessions(agent_id, status);
alter table public.dialer_sessions enable row level security;
drop policy if exists dsess_read on public.dialer_sessions;
create policy dsess_read on public.dialer_sessions for select using (agent_id = auth.uid() or public.is_owner_or_admin());
drop policy if exists dsess_write on public.dialer_sessions;
create policy dsess_write on public.dialer_sessions for all using (agent_id = auth.uid()) with check (agent_id = auth.uid());

-- ---- every call leg ----
create table if not exists public.dialer_calls (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.dialer_sessions(id) on delete set null,
  agent_id uuid not null references auth.users(id) on delete cascade,
  call_sid text unique,
  direction text not null default 'outbound',
  phone text not null,
  lead_name text,
  lead_state text,
  from_number text,
  status text not null default 'queued',  -- queued|ringing|answered|bridged|abandoned|completed|no-answer|busy|failed|canceled|voicemail
  answered_by text,                       -- human | machine | unknown
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  bridged_at timestamptz,
  ended_at timestamptz,
  duration_sec int,
  talk_sec int,
  dispo text,
  notes text,
  recording_sid text,
  recording_url text,
  created_at timestamptz not null default now()
);
create index if not exists dcalls_agent_idx on public.dialer_calls(agent_id, started_at desc);
create index if not exists dcalls_phone_idx on public.dialer_calls(phone);
create index if not exists dcalls_session_idx on public.dialer_calls(session_id);
alter table public.dialer_calls enable row level security;
drop policy if exists dcalls_read on public.dialer_calls;
create policy dcalls_read on public.dialer_calls for select using (agent_id = auth.uid() or public.is_owner_or_admin());
drop policy if exists dcalls_update on public.dialer_calls;
create policy dcalls_update on public.dialer_calls for update using (agent_id = auth.uid() or public.is_owner_or_admin());

-- ---- do-not-call (internal + uploaded national/state lists) ----
create table if not exists public.dnc_list (
  phone text primary key,
  source text not null default 'agent',   -- agent | sms | national | state | upload
  added_by uuid references auth.users(id) on delete set null,
  note text,
  added_at timestamptz not null default now()
);
alter table public.dnc_list enable row level security;
drop policy if exists dnc_read on public.dnc_list;
create policy dnc_read on public.dnc_list for select using (auth.uid() is not null);
drop policy if exists dnc_insert on public.dnc_list;
create policy dnc_insert on public.dnc_list for insert with check (auth.uid() is not null);
drop policy if exists dnc_delete on public.dnc_list;
create policy dnc_delete on public.dnc_list for delete using (public.is_owner_or_admin());

-- ---- compliance log (opt-outs, DNC requests, abandonment events) ----
create table if not exists public.dialer_compliance_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                      -- dnc_request | opt_out_sms | abandoned | blocked_hours | blocked_attempts | blocked_dnc
  phone text,
  agent_id uuid,
  detail text,
  created_at timestamptz not null default now()
);
alter table public.dialer_compliance_log enable row level security;
drop policy if exists dcl_read on public.dialer_compliance_log;
create policy dcl_read on public.dialer_compliance_log for select using (public.is_owner_or_admin());

-- Agents can see and update their own leads' dial state (dispo/notes/callback/dnc)
alter table public.lead_pool enable row level security;
drop policy if exists lp_agent_select on public.lead_pool;
create policy lp_agent_select on public.lead_pool for select
  using (agent_id = auth.uid() or public.is_owner_or_admin());
drop policy if exists lp_agent_update on public.lead_pool;
create policy lp_agent_update on public.lead_pool for update
  using (agent_id = auth.uid() or public.is_owner_or_admin())
  with check (agent_id = auth.uid() or public.is_owner_or_admin());
drop policy if exists lp_agent_insert on public.lead_pool;
create policy lp_agent_insert on public.lead_pool for insert
  with check (agent_id = auth.uid() or public.is_owner_or_admin());
