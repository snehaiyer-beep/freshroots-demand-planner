# Freshroots Demand Planner

Twice a week, turns SAP sales/stock data plus open Zoho POs into a per-SKU reorder recommendation using fixed rules.
Raghav approves, edits or rejects each one on a dashboard. **Only after approval** does the app push a **draft** PO to Zoho Inventory.

Stack: Next.js 14 (App Router, strict TypeScript) · Supabase (Postgres + email/password Auth, RLS) · Tailwind · recharts · Vercel Cron · Claude for short explanations.

## How it works

```
Mon/Thu 07:30 IST (Vercel cron) or "Run now"
  └─ POST /api/run
       1. sync open POs from Zoho (read-only)            lib/zoho.ts  getOpenPOs()
       2. compute every SKU with fixed rules             lib/rules.ts + lib/exceptions.ts
       3. one batched Claude call writes ≤20-word reasons lib/explain.ts (template fallback)
       4. save recommendations (status = pending)
Raghav on /  and /exceptions
  └─ approve / edit qty + reason / reject
       └─ only then: pushPOs() → one draft PO per vendor in Zoho
```

### Rules (`lib/rules.ts`, thresholds from the `config` table)

1. `avg4` / `avg12` = mean weekly units (all distributors) over the last 4 / 12 weeks.
2. `demand = avg12 × (1 + festival_uplift%)` when the run month (IST) is a festival month; otherwise `avg12`. Applied before any check.
3. `cover_wks = (on_hand + open PO qty) / demand` (zero demand = infinite cover).
4. Window = perishable ? `per_min_wks…per_max_wks` : `min_wks…max_wks` (edges count as inside).
5. Precedence: cover < min → **REORDER_NOW** (std_qty, ×mult if also high-demand) · cover > max → **PAUSE** (0) · avg4 > avg12 × (1 + high_demand_pct%) → **REORDER_HIGH** (std_qty × mult, rounded up) · else **OK**.

### Exceptions (`lib/exceptions.ts`, checked first; any hit → `EXCEPTION`, qty null)

| Flag | When |
|---|---|
| `new_product` | The SKU has **no sales at all**. Shown as "New product — no demand history yet. Raghav to set the first order quantity." and listed first on /exceptions. |
| `new_launch` | Fewer than `min_history_wks` weeks since its first sale. |
| `distributor_swing:<id>` | A distributor holding ≥5% of the SKU's 12-week volume whose last week deviates by more than `swing_pct` from its own average of the previous 12 weeks (spikes and drops). |
| `anomaly` | The last week's total has \|z\| > 3 against the previous 12 weeks (population SD; no flag if the SD is 0). |

A `festival` tag is also added to every recommendation made in a festival month. It is used for filtering only and is not an exception.

### Zoho (`lib/zoho.ts`, India DC)

- OAuth refresh token via `accounts.zoho.in`. The access token is cached in memory until a minute before it expires.
- `getOpenPOs()` reads open POs (`filter_by=Status.Open`) and their line items. It maps `item_id` to SKU and replaces `open_pos`. If the sync fails, the run carries on with the last known open POs.
- `pushPOs()` is called **only** from approve/edit (and Retry). It groups lines by run + `vendor_id` into one `POST /purchaseorders` with `reference_number FR-<run_id>-<vendor>`. If `push_mode = issued`, it also marks the PO issued.
- **Idempotent:** recommendations that already have a `zoho_po_id` are skipped.
- **Failures never undo an approval:** the row gets `push_status = failed` plus the error, a red badge and a **Retry push** button (on / and on /pos).
- Approving a non-zero quantity is blocked when the SKU has no `zoho_item_id`/`vendor_id`. The row shows "Map in Zoho first", linking to /settings.
- **Mock mode:** when any `ZOHO_*` variable is missing, open POs are left as seeded and pushes return fake `MOCK-PO-…` IDs. Everything else works end to end.

### Explanations (`lib/explain.ts`)

One batched call to `claude-opus-5-5` (low effort, structured JSON output) returns `{sku, reason}` for each SKU. A reason is kept only if it is at most 20 words and every number in it matches the inputs. Otherwise, or if `ANTHROPIC_API_KEY` is missing or the call fails or is refused, a deterministic template reason is used. The model never changes actions or quantities.

## Pages

| Path | What |
|---|---|
| `/` | Latest run: SKU, cover, action, qty, reason, push status. Filters: action, perishable, festival. Sorted by risk. Per row: approve, edit qty + override reason (festival/scheme, distributor info, new launch, supply issue, other), or reject. Bulk approve. "Run now". |
| `/exceptions` | EXCEPTION rows with flags and a 12-week sparkline. Set qty + reason → approve & push, or skip. |
| `/upload` | `sales.csv` (`week_start,sku,distributor_id,units`; week as `YYYY-MM-DD` or `2026-W42`) and `stock.csv` (`sku,on_hand`). Validated, upserted, with counts and per-line errors. |
| `/pos` | PO log with Zoho PO IDs, plus failed pushes with Retry. |
| `/accuracy` | Runs at least 4 weeks old: predicted demand×4 vs actual units, error % per SKU, average error, and how often qty overrides beat the rule (closer to `actual − supply at run time`). |
| `/settings` | Edit config; SKU → `zoho_item_id` / `vendor_id` mapping. |

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the values below
```

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Browser/session client (RLS applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only client used after the allow-list check, plus the seed script |
| `SUPABASE_DB_URL` | migrate only | Session pooler connection string, used by `npm run migrate`; not needed on Vercel |
| `CRON_SECRET` | yes on Vercel | Vercel Cron sends `Authorization: Bearer $CRON_SECRET` |
| `ANTHROPIC_API_KEY` | no | Reasons from Claude; template reasons without it |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID` | no | Live Zoho Inventory (India DC); mock mode if any is missing |
| `SEED_ALLOWED_EMAILS` | seed only | Comma-separated emails to add to `allowed_users` |

Zoho refresh token: create a Server-based client at api-console.zoho.in with scope `ZohoInventory.purchaseorders.ALL,ZohoInventory.items.READ`, then exchange the grant code for a refresh token at `https://accounts.zoho.in/oauth/v2/token`.

### Supabase project

Use a dedicated project (e.g. `freshroots-demand-planner`, region **Mumbai / ap-south-1**). Copy these into `.env.local`:
- **Project Settings → API:** the Project URL, the publishable/anon key and the secret/service_role key.
- **Connect → Session pooler URI:** your database password, as `SUPABASE_DB_URL`.

### Migration

```bash
npm run migrate
```

This applies `supabase/migrations/0001_init.sql` straight to Postgres, then checks that the Data API can see the tables. The SQL is safe to re-run. It creates all tables, enums, seed config, helper functions, grants and RLS policies (only emails in `allowed_users` can read or write), and finishes by refreshing the API schema cache.

Without `SUPABASE_DB_URL` you can paste the file into the SQL editor instead. Make sure nothing is highlighted, so the whole file runs.


### Seed

```bash
npm run seed                 # data/*.csv: 15 SKUs from the SAP/master exports + SKU016 (new product, no sales)
npm run seed -- --synthetic  # 40 SKUs (8 perishable, 2 launched <12 wks ago), 50 distributors, 156 weeks
```

The seed **wipes** SKUs, sales, stock, open POs, runs and recommendations first.

- **CSV mode** reads `data/sku_master.csv`, `weekly_sales.csv` (ISO weeks converted to Mondays), `current_inventory.csv` and `calendar.csv` (which sets `festival_months`). Each SKU's sales are assigned to its distributor from the SKU master. Perishability "High" means perishable. Zoho IDs are fake (`ZITEM-<sku>`, `ZVEND-<category>`). **SKU016 Freshroots Millet Muesli 400g** has no sales and 0 stock, so every run sends it to /exceptions as a *New product* for Raghav.
- **Synthetic mode** is deterministic. Oct/Nov/Mar peaks; one whole-SKU spike (anomaly); one distributor spike (distributor_swing); step-up SKUs (REORDER_HIGH, one also REORDER_NOW ×mult); and mixed stock levels. Every action type appears whatever month you seed in (covered by `tests/seed.test.ts`).

Add your email (if you did not use `SEED_ALLOWED_EMAILS`):

```sql
insert into allowed_users (email) values ('raghav@freshroots.in');
```

### Signing in

Email + password. On the login page, an email that is in `allowed_users` uses **First time here** once to choose a password. After that it uses **Sign in**. Emails not in `allowed_users` can neither sign in nor create a password, and middleware signs out any session whose email is removed from the list.

**No-login mode (current setup):** with `AUTH_DISABLED=true` (and optionally `LOCAL_USER_EMAIL`, recorded as the approver) the app opens straight to the dashboard, locally and on Vercel. Anyone with the URL can then approve recommendations; POs still only reach Zoho as drafts. To require login again, remove `AUTH_DISABLED` from Vercel's environment variables and redeploy.

### One-command Supabase setup (optional)

With a personal access token from supabase.com/dashboard/account/tokens in `SUPABASE_ACCESS_TOKEN`, `npm run setup:supabase` does the following through the Management API:
- fetches the project's publishable and secret keys into `.env.local`
- applies the migration
- confirms the Data API can see the tables

Revoke the token afterwards.

### Run locally

```bash
npm run dev     # http://localhost:3000 → sign in → Run now
npm test        # vitest: rules, precedence, exceptions, explain, CSV, approvals, accuracy, seed data
npm run build
```

## Deploy (Vercel)

1. Import the repo into Vercel and set the environment variables above, including `CRON_SECRET`.
2. `vercel.json` schedules `/api/run` at `0 2 * * 1,4` (UTC), which is Monday and Thursday 07:30 IST. Vercel Cron calls it with **GET**; the route accepts GET and POST, both requiring the bearer secret or a signed-in allowed user.

Vercel Hobby limits functions to 60 s (`maxDuration = 60` is set on the long routes). A run makes roughly 6 Supabase queries plus one Claude call, which fits comfortably.

## Project layout

```
app/                 pages + API routes (api/run, api/recommendations, api/push/retry, api/upload, api/config, api/skus)
components/          client components (table, decision controls, badges, sparkline, settings forms)
lib/rules.ts         pure rule engine          lib/exceptions.ts  pure exception checks
lib/explain.ts       Claude reasons + fallback lib/zoho.ts        Zoho OAuth, open-PO sync, PO push
lib/pipeline.ts      run orchestration         lib/approvals.ts   approve/edit/reject → push
lib/accuracy.ts      accuracy scoring          lib/csv.ts         CSV parsing + validation
scripts/seed*.ts     seed (CSV / synthetic)    supabase/migrations/0001_init.sql
tests/               vitest suites
```
