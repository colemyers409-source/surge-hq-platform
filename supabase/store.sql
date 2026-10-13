-- Surge Apparel store: products (built in the owner builder), orders (written by the Stripe webhook), settings.
create table if not exists public.store_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  blank text not null,                 -- tee | hoodie | quarterzip | polo | cap
  colors jsonb not null default '[]',  -- [{name, hex}]
  sizes text[] not null default '{}',
  price_cents integer not null check (price_cents >= 50),
  upcharge_cents integer not null default 0,  -- added to 2XL and up
  design jsonb not null default '{}',  -- {front:{logo,ink,place,scale,dy}, back:{...}}
  photos text[] not null default '{}',
  active boolean not null default false,
  sold_out boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_orders (
  id uuid primary key default gen_random_uuid(),
  stripe_session_id text unique,
  email text, name text, phone text,
  shipping jsonb,                       -- {name, address:{line1,line2,city,state,postal_code,country}}
  items jsonb not null default '[]',    -- [{id,name,color,size,qty,price_cents}]
  amount_cents integer, shipping_cents integer default 0,
  status text not null default 'paid',  -- paid | shipped | cancelled
  tracking text,
  shipped_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.store_settings (
  id integer primary key default 1 check (id = 1),
  shipping_cents integer not null default 0,
  free_ship_over_cents integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.store_settings (id) values (1) on conflict do nothing;

alter table public.store_products enable row level security;
alter table public.store_orders enable row level security;
alter table public.store_settings enable row level security;

drop policy if exists store_products_read on public.store_products;
create policy store_products_read on public.store_products for select using (active or public.is_owner_or_admin());
drop policy if exists store_products_write on public.store_products;
create policy store_products_write on public.store_products for all using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

drop policy if exists store_orders_owner on public.store_orders;
create policy store_orders_owner on public.store_orders for select using (public.is_owner_or_admin());
drop policy if exists store_orders_update on public.store_orders;
create policy store_orders_update on public.store_orders for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());
-- inserts come only from the webhook with the service key (bypasses RLS)

drop policy if exists store_settings_read on public.store_settings;
create policy store_settings_read on public.store_settings for select using (true);
drop policy if exists store_settings_write on public.store_settings;
create policy store_settings_write on public.store_settings for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

-- Public bucket for product photos and custom logos; only owner/admin can upload.
insert into storage.buckets (id, name, public) values ('store', 'store', true) on conflict (id) do nothing;
drop policy if exists store_files_read on storage.objects;
create policy store_files_read on storage.objects for select using (bucket_id = 'store');
drop policy if exists store_files_write on storage.objects;
create policy store_files_write on storage.objects for insert with check (bucket_id = 'store' and public.is_owner_or_admin());
drop policy if exists store_files_delete on storage.objects;
create policy store_files_delete on storage.objects for delete using (bucket_id = 'store' and public.is_owner_or_admin());
