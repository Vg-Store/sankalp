# Sankalp — PWA + Supabase setup

*(Sankalp — Sanskrit for a firm resolve or vow. Renamed from "Docket.")*

## Files
```
index.html          the app shell (open this)
config.js           your Supabase credentials live here, not in the code
css/style.css        all styling
js/app.js             all logic
js/dexie.min.js       vendored copy of Dexie (IndexedDB), not loaded from a CDN
manifest.json, sw.js, icons/    installability + offline
supabase-setup.sql   run once in Supabase to create tables
```
All files must sit in the **same folder structure** and be served over
`http(s)`, not opened as a bare `file://` (service workers and
installability both require a real server).

## Hosting (pick one, both free)
1. **GitHub Pages** — push this folder to a repo, enable Pages on the branch.
2. **Cloudflare Pages / Vercel** — drag-and-drop the folder as a static site.

Once hosted, open it on phone and desktop and use "Add to Home Screen" /
"Install app" — that's the PWA part, no app store needed.

## Supabase sync setup
1. Create a project at supabase.com (free tier is enough for personal use).
2. SQL Editor → paste `supabase-setup.sql` → Run.
3. Project Settings → API → copy the **Project URL** and **anon public key**.
4. Open `config.js` and fill in:
   ```js
   window.SANKALP_CONFIG = {
     SUPABASE_URL: 'https://your-project.supabase.co',
     SUPABASE_ANON_KEY: 'your-anon-key'
   };
   ```
5. Authentication → Providers → Email should already be on. Turn off
   "Confirm email" if you want the magic link to sign you in immediately.
6. Authentication → URL Configuration → add your hosted URL to **Redirect URLs**,
   otherwise the magic link bounces back to localhost.
7. Open the app → Settings → enter your email under Account & sync →
   "Send sign-in link" → click the link in your inbox. From then on it syncs
   automatically: on every edit (2s debounce), every 30s while open, on
   reconnect, and when the tab is hidden or closed.

Leave `config.js` blank and the app runs fully local — nothing breaks, the
sync badge in the header just stays ⚪ and Settings shows "not configured."

## What's in this build (Phase A, complete)
1. **Four-file split** — `index.html` / `css/style.css` / `js/app.js` /
   `config.js`. Not split further than this on purpose; revisit only if
   `app.js` gets genuinely hard to navigate (roughly 1,500–2,000 lines).
2. **Inbox** — a third capture lane alongside Tasks and Bucket List, for
   anything you haven't decided how to categorize yet. Quick-add with the
   "Inbox" toggle, or switch to the Inbox tab (badge shows the open count).
   Each item there gets "→ Task", "→ Bucket", or delete — no forced
   category/deadline until you decide.
3. **Weekly Review** — Settings menu → Weekly Review. One screen: what's in
   Inbox, what's overdue, what's due in the next 7 days, what you completed
   this week (with a one-tap "Archive all" to clear it out), and how many
   open bucket-list items remain.
4. **Sync status badge** — top-right of the header, always visible:
   🟢 synced · 🟡 syncing · 🔴 offline / signed out / error · ⚪ not configured.
   Tap it to jump straight to Settings.
5. **Settings page** — Appearance (theme), Backup (export/import), Account &
   sync (sign in/out, manual sync), and a collapsible **Developer mode**:
   DB item/category counts, pending-sync-queue count, force sync, export the
   raw database, clear cache & unregister the service worker, and a
   double-confirmed full local reset.
6. **Search highlighting** — press `/`, matches in the item text are wrapped
   in `<mark>` so you can see exactly why a result matched.

Everything from the previous build carries over unchanged: real IndexedDB
storage (not the Claude-only API the original file depended on), optional
Notes field, installable/offline PWA, Supabase sync with last-write-wins and
a conflict toast, `N`/`/`/`Esc` shortcuts.

## Deliberately not done, and why
- **No Command Palette (Ctrl+K).** Two tabs plus Inbox don't justify a
  command palette yet — `/` and `N` already cover the two highest-frequency
  actions. Revisit once there are 5+ real destinations to jump between.
- **No event delegation / partial DOM rendering.** Full re-render is not a
  measured problem at "a few dozen personal items." Optimizing it now would
  be solving a performance issue you don't have.
- **No push notifications.** In-app notifications are a small addition;
  true background push (tab/app closed) needs VAPID keys, a service worker
  push handler, and a server-side scheduler — a separate project, not a
  checkbox.
- **No ESLint/CI.** Still a team of one.
- **No `settings` database table.** Still nothing to put in it.

## Phase B starts now
Freeze the feature set. Use it every day for at least two weeks. Every time
something is annoying, write it down — problem, why it happened, how often
it's come up, possible fix — but don't act on it yet. After two weeks, sort
that list and only build what showed up three or more times. That's Phase C.
