# Sankalp — PWA setup

*(Sankalp — Sanskrit for a firm resolve or vow. Renamed from "Docket.")*

Single-device, fully local. Nothing leaves the phone or browser it's
installed on — there is no account, no server, and no sync between
devices. If you install it on both your phone and a laptop, each is its
own independent copy of the data.

## Files
```
index.html          the app shell (open this)
style.css            all styling
app.js                all logic
dexie.min.js          vendored copy of Dexie (IndexedDB), not loaded from a CDN
manifest.json, sw.js, icons/    installability + offline
```
All files are flat, in one folder — no subfolders. All files must sit in
the same folder and be served over `http(s)`, not opened as a bare
`file://` (service workers and installability both require a real server).

## Hosting (pick one, both free)
1. **GitHub Pages** — push this folder to a repo, enable Pages on the branch.
2. **Cloudflare Pages / Vercel** — drag-and-drop the folder as a static site.

Once hosted, open it on your phone and use "Add to Home Screen" — that's
the PWA part, no app store needed.

## Moving data to a new phone, or keeping a backup
Settings → Backup → **Export backup (.json)** saves everything (tasks,
bucket list, categories) to a file. On the new device, open the app,
go to Settings → Backup → **Import backup**, and pick that file. This is
also the way to move data between two installs manually, since there's no
automatic sync — export from one, import into the other.

## What's in this build
1. **Three-file core** — `index.html` / `style.css` / `app.js`. Not split
   further than this on purpose; revisit only if `app.js` gets genuinely
   hard to navigate (roughly 1,500–2,000 lines).
2. **Inbox** — a third capture lane alongside Tasks and Bucket List, for
   anything you haven't decided how to categorize yet. Quick-add with the
   "Inbox" toggle, or switch to the Inbox tab (badge shows the open count).
   Each item there gets "→ Task", "→ Bucket", or delete — no forced
   category/deadline until you decide.
3. **Weekly Review** — Settings menu → Weekly Review. One screen: what's in
   Inbox, what's overdue, what's due in the next 7 days, what you completed
   this week (with a one-tap "Archive all" to clear it out), and how many
   open bucket-list items remain.
4. **Settings page** — Backup (export/import) and a collapsible
   **Developer mode**: DB item/category counts, export the raw database,
   clear cache & unregister the service worker, and a double-confirmed
   full local reset.
5. **Search highlighting** — press `/`, matches in the item text are wrapped
   in `<mark>` so you can see exactly why a result matched.

Real IndexedDB storage (not localStorage), optional Notes field per item,
installable/offline PWA, `N`/`/`/`Esc` shortcuts all carry over unchanged.

## Deliberately not done, and why
- **No sync.** Removed on request — this build is single-device only.
  Bringing it back later (Supabase, iCloud, or your own backend) is a
  self-contained addition; nothing else in the app assumes it exists.
- **No Command Palette (Ctrl+K).** Two tabs plus Inbox don't justify a
  command palette yet — `/` and `N` already cover the two highest-frequency
  actions. Revisit once there are 5+ real destinations to jump between.
- **No event delegation / partial DOM rendering.** Full re-render is not a
  measured problem at "a few dozen personal items." Optimizing it now would
  be solving a performance issue you don't have.
- **No push notifications.** In-app notifications are a small addition;
  true background push (tab/app closed) needs a server-side scheduler —
  a separate project, not a checkbox.
- **No ESLint/CI.** Still a team of one.

## Phase B starts now
Freeze the feature set. Use it every day for at least two weeks. Every time
something is annoying, write it down — problem, why it happened, how often
it's come up, possible fix — but don't act on it yet. After two weeks, sort
that list and only build what showed up three or more times. That's Phase C.
