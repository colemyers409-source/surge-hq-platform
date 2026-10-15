-- Surge Dialer billing — run once in Supabase SQL editor (after dialer.sql)
alter table public.profiles add column if not exists dialer_active boolean not null default false;
alter table public.profiles add column if not exists dialer_plan text;            -- '1' | '3' | '5' | 'comp'
alter table public.profiles add column if not exists dialer_lines int;             -- lines allowed by plan
alter table public.profiles add column if not exists dialer_customer_id text;      -- Stripe customer
alter table public.profiles add column if not exists dialer_sub_id text;           -- Stripe subscription
alter table public.profiles add column if not exists dialer_period_end timestamptz;
alter table public.profiles add column if not exists dialer_status text;           -- active | past_due | canceled | comp

alter table public.dialer_config add column if not exists plan_1_price numeric not null default 80;
alter table public.dialer_config add column if not exists plan_3_price numeric not null default 120;
alter table public.dialer_config add column if not exists plan_5_price numeric not null default 150;
update public.dialer_config set max_lines = 5 where id = 1 and max_lines < 5;
