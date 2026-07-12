# Sankalp — Supabase Sync: Setup, Architecture & Troubleshooting

This is a running reference for how sync works in Sankalp and every issue
that's come up so far, with root causes and fixes. Read the "How sync
actually works" section once, then use "Troubleshooting checklist" whenever
something breaks.

---

## How sync actually works

Local storage (IndexedDB via Dexie) is always the source of truth for the
UI — every read/write happens instantly against local data, sync is a
background layer on top. `SYNC_ENABLED` is just `!!(SUPABASE_URL &&
SUPABASE_ANON_KEY)` in `config.js` — if either is blank, the app runs fully
offline and skips all of this.

Three Supabase tables are involved:

| Table         | Purpose                                              |
|---------------|-------------------------------------------------------|
| `items`       | Tasks / bucket-list / inbox entries                   |
| `categories`  | Bucket-list category definitions                      |
| `tombstones`  | Record of deleted item ids, shared across all devices |

`syncNow()` runs in this order, every time (on edit debounce, every 30s,
on reconnect, on visibility change, on page hide, and manually via
"Sync now" / "Force sync"):

1. **Pull remote tombstones** → remove any locally-held item whose id is
   tombstoned. This is what lets a delete made on Device A actually reach
   Device B.
2. **Pull remote items/categories** → merge into local state, remote wins
   only if strictly newer (`updated_at`), and anything currently tombstoned
   (locally pending *or* already recorded remotely) is skipped so a
   just-deleted item can't be resurrected by this merge.
3. **Push local deletes** → delete the row from `items` *and* write a row
   into `tombstones` so every other device learns about it.
4. **Push local items/categories** → upsert whatever's left locally.

The reason pull happens before push: pushing first would let a stale local
copy clobber a newer edit made on another device. The reason tombstones
exist as their own table (not just a local pending-delete queue): a plain
`delete()` call only removes the row from Supabase — it doesn't tell other
devices "stop re-uploading your local copy of this," which is exactly what
caused issue #4 below.

---

## One-time setup checklist

1. **`config.js`** — fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` from
   Project Settings → API. Leave both blank to run fully offline.
2. **Run the SQL** to create `items`, `categories`, and `tombstones` with
   RLS enabled and four policies each (select/insert/update/delete scoped
   to `auth.uid() = user_id`). See `tombstones-setup.sql` for the
   tombstones table; use the equivalent pattern for `items`/`categories`.
3. **Project Settings → API → "Exposed tables"** — toggle **all three**
   tables (`items`, `categories`, `tombstones`) on. This is a *separate*
   switch from RLS and is easy to miss — a table can have perfect RLS
   policies and still return 403 on every request if it's not exposed here.
4. **Auth → URL Configuration** — add your hosted URL (e.g.
   `https://yourname.github.io/sankalp/`) to Redirect URLs, or magic links
   bounce back to localhost.
5. Sign in on each device via Settings → Account & sync → email → magic
   link. **Use the same email on every device** — sync is scoped by
   `user_id`, so different emails means different, non-overlapping data.
6. After any deploy, on each device: Settings → Developer mode → **"Clear
   cache & unregister service worker"**, then hard-reload
   (Ctrl/Cmd+Shift+R). The service worker caches static assets aggressively;
   skipping this step is the single most common reason a fix "doesn't work"
   when it actually shipped fine.

---

## Troubleshooting checklist

Work through these roughly in order — later ones assume earlier ones are
already ruled out.

### 1. Sync badge stuck on ⚪ "not configured"
`config.js` has a blank `SUPABASE_URL` or `SUPABASE_ANON_KEY`. Fill both in
and reload. If you already filled it in and it's still blank on the live
site, the file wasn't actually redeployed — check the file on GitHub
directly (or wherever it's hosted).

### 2. "Sync now" does nothing, no visible error
Open DevTools → Network tab, filter to the domain ending in
`.supabase.co`, then hit "Sync now." Look at the status codes:

- **`403` on every request (GET and POST alike)** → almost always the
  table isn't exposed via the Data API. Project Settings → API → Exposed
  tables → toggle it on. This is different from RLS and is checked
  separately — don't assume RLS policies alone are enough.
- **`403` only on writes (POST/DELETE), `200` on reads (GET)** → RLS
  policies exist for `select` but not `insert`/`update`/`delete`. Add the
  missing policies.
- **Everything is `200`/`201`/`204`** → the network layer is fine; the bug
  is client-side logic (see below) or you're looking at a stale deployed
  file.

### 3. Deleted item comes back on the *same* device
Fixed by skipping ids that are in the local pending-tombstone list during
the pull-merge step (`syncNow()`, step 2 above). If you're still seeing
this, confirm the deployed `app.js` actually contains `tombstoneIds` —
search for that string in the live file via GitHub's file viewer or
DevTools → Sources. If it's missing, the deploy didn't take; if it's
present but the bug persists, it's stale service-worker cache — see setup
step 6.

### 4. Deleted item comes back after syncing on a *different* device
This is the cross-device case: Device A deletes and syncs fine, but
Device B still has its own local copy and blindly re-uploads it on its
next sync. Fixed by the shared `tombstones` table — Device B pulls
tombstones first and drops the item locally *before* it has a chance to
push it back. Confirm the `tombstones` table actually exists, is exposed
via the Data API, has RLS policies, and that you see `GET
.../tombstones?...` and `POST .../tombstones?on_conflict=id...` requests
in the Network tab during a sync. If those requests are absent, the
deployed `app.js` predates this fix — same stale-cache check as above.

### 5. Fix looks correct in the file but the bug persists
Almost always the service worker serving a cached copy of `app.js`.
Checklist:
- Confirm the fix is actually in the file **as deployed** (view it on
  GitHub directly, not just locally).
- Settings → Developer mode → "Clear cache & unregister service worker" —
  do this *again* even if you did it earlier; it only clears what exists
  at the moment you click it, so redeploying after clearing means you need
  to clear again.
- Hard-reload (Ctrl/Cmd+Shift+R) to bypass the browser's own HTTP cache on
  top of the service worker cache.
- Sanity check in DevTools → Sources: open the actual `app.js` the browser
  loaded and search for the expected code (e.g. `tombstoneIds`). If it's
  not there, the browser is still running an old version — repeat the
  cache-clear steps.

### 6. Different email on different devices
Each device only ever syncs data scoped to its own signed-in `user_id`. If
Device A and Device B are signed in with different emails, they will never
share data — this isn't a bug, it's the intended isolation. Sign in with
the same email on every device you want synced.

### 7. Categories not appearing after sync starts working
Not a bug — `categories` populates the first time a device with local
categories successfully pushes. If both devices start with zero local
categories, the table will legitimately stay empty until you create one.

---

## Known non-issue: Realtime toggle

Supabase's per-table "Enable Realtime" option (visible in the same menu as
"Exposed tables") is unrelated to this app. Sankalp only does plain
REST calls (`select`/`upsert`/`delete`), never websocket subscriptions —
leave Realtime off.

---

## Ongoing maintenance: tombstones table growth

Every tombstone row is small (~100–150 bytes with indexing overhead), so
this is not an urgent concern at personal-use scale — even 20 deletes a
day for a year is well under 1 MB, against Supabase's 500 MB free-tier
limit. It only matters because every sync pulls the *entire* tombstones
table for your user; row count (not disk size) is what could eventually
add latency.

**When to actually do something about it** — don't schedule this, just
check opportunistically:
- If you're ever in the Supabase SQL editor for something else, run:
  ```sql
  select count(*) from tombstones;
  ```
- Under ~5,000 rows: ignore it.
- 5,000–20,000: fine, but worth cleaning up next time you're already there.
- 20,000+, or sync starts *feeling* slower than the sub-second round trips
  you're used to: time to act.

**The fix, when needed** (two independent improvements, do either or both):
1. Only pull tombstones newer than `lastSyncAt` (already tracked in
   `LS` under `sankalp-last-sync-v1`) instead of the full table every time.
2. Periodically delete old tombstone rows — anything older than ~90 days
   has almost certainly already been applied by every device that syncs at
   least occasionally:
   ```sql
   delete from tombstones where deleted_at < extract(epoch from now() - interval '90 days') * 1000;
   ```
   (`deleted_at` is stored as a JS millisecond timestamp, hence the
   conversion.) Run this by hand in the SQL editor whenever the row count
   check above tells you to — no need for a cron job at this scale.

---

## Quick reference: files that matter for sync

| File          | Relevant part                                                        |
|---------------|------------------------------------------------------------------------|
| `config.js`   | `SUPABASE_URL`, `SUPABASE_ANON_KEY` — blank means fully offline        |
| `app.js`      | `SYNC_ENABLED`, `initSync()`, `syncNow()`, `itemToRow()`/`rowToItem()`  |
| `sw.js`       | Cache-first for static assets — why stale-cache is the top false alarm |
| Supabase SQL  | Table definitions + RLS policies for `items`/`categories`/`tombstones` |
| Supabase → Project Settings → API | Exposed schemas/tables — separate from RLS, easy to miss |
