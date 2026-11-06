-- Freshroots Demand Planner: initial schema
-- Apply with `npm run migrate` (needs SUPABASE_DB_URL) or paste into the Supabase SQL editor.
-- Safe to re-run.

-- ---------- types ----------
do $$ begin
  create type rec_action as enum ('REORDER_NOW', 'REORDER_HIGH', 'PAUSE', 'OK', 'EXCEPTION');
exception when duplicate_object then null; end $$;
do $$ begin
  create type rec_status as enum ('pending', 'approved', 'edited', 'rejected');
exception when duplicate_object then null; end $$;
do $$ begin
  create type push_status as enum ('not_sent', 'sent', 'failed');
exception when duplicate_object then null; end $$;

-- ---------- tables ----------
create table if not exists allowed_users (
  email text primary key
);

create table if not exists skus (
  sku          text primary key,
  name         text not null,
  perishable   boolean not null default false,
  launch_date  date,
  std_qty      int not null check (std_qty >= 0),
  zoho_item_id text,
  vendor_id    text
);

create table if not exists weekly_sales (
  week_start     date not null,
  sku            text not null references skus(sku) on delete cascade,
  distributor_id text not null,
  units          int  not null check (units >= 0),
  primary key (week_start, sku, distributor_id)
);
create index if not exists weekly_sales_sku_week on weekly_sales (sku, week_start);

create table if not exists stock (
  sku     text primary key references skus(sku) on delete cascade,
  on_hand int  not null check (on_hand >= 0),
  as_of   date not null default current_date
);

create table if not exists open_pos (
  id  text primary key,
  sku text not null references skus(sku) on delete cascade,
  qty int  not null check (qty >= 0),
  eta date
);

create table if not exists config (
  key   text primary key,
  value text not null
);

create table if not exists runs (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  status     text not null default 'running' -- running | done | failed
);

create table if not exists recommendations (
  id              bigint generated always as identity primary key,
  run_id          bigint not null references runs(id) on delete cascade,
  sku             text   not null references skus(sku) on delete cascade,
  avg4            numeric not null,
  avg12           numeric not null,
  demand          numeric not null,
  cover_wks       numeric,            -- null = infinite cover (zero demand)
  action          rec_action not null,
  qty             int,                -- null for EXCEPTION
  flags           text[] not null default '{}',
  reason          text,
  status          rec_status not null default 'pending',
  final_qty       int,
  override_reason text,
  approved_by     text,
  approved_at     timestamptz,
  zoho_po_id      text,
  push_status     push_status not null default 'not_sent',
  push_error      text,
  unique (run_id, sku)
);
create index if not exists recommendations_run on recommendations (run_id);

create table if not exists po_log (
  id          bigint generated always as identity primary key,
  rec_id      bigint not null references recommendations(id) on delete cascade,
  zoho_po_id  text not null,
  qty         int  not null,
  approved_by text,
  created_at  timestamptz not null default now()
);

-- ---------- seed config ----------
insert into config (key, value) values
  ('high_demand_pct', '20'),
  ('high_demand_mult', '1.5'),
  ('min_wks', '6'),
  ('max_wks', '14'),
  ('per_min_wks', '3'),
  ('per_max_wks', '4'),
  ('festival_uplift', '25'),
  ('festival_months', '10,11,3'),
  ('swing_pct', '40'),
  ('min_history_wks', '12'),
  ('push_mode', 'draft')
on conflict (key) do nothing;

-- ---------- helpers ----------
-- True when the signed-in user's email is in allowed_users.
create or replace function is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from allowed_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Exact, case-insensitive allow-list check used by the login page (server-side, service role).
create or replace function email_allowed(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from allowed_users where lower(email) = lower(trim(p_email)));
$$;
revoke execute on function email_allowed(text) from public, anon, authenticated;

-- Weekly totals across all distributors.
create or replace view sku_week_totals with (security_invoker = true) as
  select week_start, sku, sum(units)::int as units
  from weekly_sales
  group by week_start, sku;

-- Per-SKU history: first and last week with sales.
create or replace function sku_history()
returns table (sku text, first_week date, last_week date)
language sql stable security invoker set search_path = public as $$
  select sku, min(week_start), max(week_start)
  from weekly_sales
  group by sku;
$$;

-- All distributor rows since p_from as a single JSON value (avoids the API row cap).
create or replace function sales_window(p_from date)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_array(week_start, sku, distributor_id, units)), '[]'::jsonb)
  from weekly_sales
  where week_start >= p_from;
$$;

-- Weekly totals between two dates as JSON (for accuracy + sparklines).
create or replace function totals_window(p_from date, p_to date)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_array(week_start, sku, units)), '[]'::jsonb)
  from sku_week_totals
  where week_start >= p_from and week_start <= p_to;
$$;

-- ---------- RLS: only allowed_users may read or write ----------
alter table allowed_users   enable row level security;
alter table skus            enable row level security;
alter table weekly_sales    enable row level security;
alter table stock           enable row level security;
alter table open_pos        enable row level security;
alter table config          enable row level security;
alter table runs            enable row level security;
alter table recommendations enable row level security;
alter table po_log          enable row level security;

drop policy if exists allowed_self_read on allowed_users;
create policy allowed_self_read on allowed_users for select to authenticated using (is_allowed());

drop policy if exists allowed_all on skus;
create policy allowed_all on skus            for all to authenticated using (is_allowed()) with check (is_allowed());
drop policy if exists allowed_all on weekly_sales;
create policy allowed_all on weekly_sales    for all to authenticated using (is_allowed()) with check (is_allowed());
drop policy if exists allowed_all on stock;
create policy allowed_all on stock           for all to authenticated using (is_allowed()) with check (is_allowed());
drop policy if exists allowed_all on open_pos;
create policy allowed_all on open_pos        for all to authenticated using (is_allowed()) with check (is_allowed());
drop policy if exists allowed_all on config;
create policy allowed_all on config          for all to authenticated using (is_allowed()) with check (is_allowed());
drop policy if exists allowed_all on runs;
create policy allowed_all on runs            for all to authenticated using (is_allowed()) with check (is_allowed());
drop policy if exists allowed_all on recommendations;
create policy allowed_all on recommendations for all to authenticated using (is_allowed()) with check (is_allowed());
drop policy if exists allowed_all on po_log;
create policy allowed_all on po_log          for all to authenticated using (is_allowed()) with check (is_allowed());

grant execute on function is_allowed() to authenticated;

-- ---------- API grants (new projects may not auto-grant tables created in SQL) ----------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on
  allowed_users, skus, weekly_sales, stock, open_pos, config, runs, recommendations, po_log
  to authenticated, service_role;
grant select on sku_week_totals to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on function sku_history(), sales_window(date), totals_window(date, date) to authenticated, service_role;
grant execute on function email_allowed(text) to service_role;

-- refresh the Data API schema cache so the new tables are visible immediately
notify pgrst, 'reload schema';
