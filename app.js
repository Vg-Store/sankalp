(function(){
  // ---------- SUPABASE CONFIG ----------
  // Actual values live in config.js (window.SANKALP_CONFIG), kept out of this file
  // so the app code and your credentials aren't tangled together.
  const cfg = window.SANKALP_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || '';
  const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY || '';

  const V2_KEY = 'sankalp-items-v2';
  const V1_KEY = 'docket-items-v1';
  const CATS_KEY = 'sankalp-categories-v1';
  const THEME_KEY = 'sankalp-theme-v1';
  const TOMBSTONES_KEY = 'sankalp-tombstones-v1';
  const URGENT_WINDOW_MS = 1000*60*60*24;
  const STALE_DAYS = 7;
  const PALETTE = ['#3F7C60','#B07A1E','#7C6FC9','#C1432B','#3F7CA0','#A0568C'];

  // ---------- local storage shim (real browser storage, not tied to any host) ----------
  // ---------- storage: IndexedDB via Dexie, key/value table ----------
  // Async, no ~5-10MB ceiling, doesn't touch the main thread the way
  // localStorage.setItem does on every save. One-time migration below
  // picks up anything already saved under the old localStorage keys.
  const db = new Dexie('SankalpDB');
  db.version(1).stores({ kv: 'key' });

  const LS = {
    async get(key){
      try {
        const row = await db.kv.get(key);
        if (row) return { key, value: row.value };
      } catch(e){ /* fall through to legacy check below */ }
      try {
        const legacy = localStorage.getItem(key);
        if (legacy !== null){
          await db.kv.put({ key, value: legacy }); // migrate once, then leave localStorage alone
          return { key, value: legacy };
        }
      } catch(e){}
      return null;
    },
    async set(key, value){
      try { await db.kv.put({ key, value }); return { key, value }; }
      catch(e){ return null; }
    }
  };

  let items = [];
  let categories = [];
  let loaded = false;
  let currentTab = 'docket';
  let showDoneTasks = false;
  let showDoneBucket = false;
  let activeSub = 'all';
  let dayFilter = null;
  let searchQuery = '';

  let addKind = 'task';
  let selectedSub = null;

  const mainEl = document.getElementById('main');
  const statline = document.getElementById('statline');
  const itemInput = document.getElementById('itemInput');
  const addBtn = document.getElementById('addBtn');
  const subPick = document.getElementById('subPick');
  const kindToggle = document.getElementById('kindToggle');
  const weekstripEl = document.getElementById('weekstrip');
  const wclearEl = document.getElementById('wclear');
  const searchBtn = document.getElementById('searchBtn');
  const searchBar = document.getElementById('searchBar');
  const searchInput = document.getElementById('searchInput');
  const toastEl = document.getElementById('toast');
  const themeToggle = document.getElementById('themeToggle');
  const tabButtons = document.querySelectorAll('.tab');
  const menuBtn = document.getElementById('menuBtn');
  const menuPanel = document.getElementById('menuPanel');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');

  const modalOverlay = document.getElementById('modalOverlay');
  const modalTitle = document.getElementById('modalTitle');
  const modalClose = document.getElementById('modalClose');
  const mText = document.getElementById('mText');
  const mKindToggle = document.getElementById('mKindToggle');
  const mCatSection = document.getElementById('mCatSection');
  const mSubPick = document.getElementById('mSubPick');
  const manageLink = document.getElementById('manageLink');
  const catManager = document.getElementById('catManager');
  const mDateDate = document.getElementById('mDateDate');
  const mDateTime = document.getElementById('mDateTime');
  const mNotes = document.getElementById('mNotes');
  const mPinRow = document.getElementById('mPinRow');
  const mPinPick = document.getElementById('mPinPick');
  const mCancel = document.getElementById('mCancel');
  const mAdd = document.getElementById('mAdd');
  const mDelete = document.getElementById('mDelete');

  let mKind = 'task', mSub = null, mPinned = false, managerOpen = false, newCatColor = PALETTE[0];
  let modalMode = 'add', editingId = null;

  function uid(p){ return (p||'i') + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function escapeHtml(str){ const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
  function pad(n){ return String(n).padStart(2,'0'); }
  function dayKey(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function catInfo(key){ return categories.find(c => c.key === key) || { key:'other', label:'Other', color:'#8A8172' }; }
  function isoToDateTimeParts(iso){
    const d = new Date(iso);
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const hasTime = (d.getHours()!==0 || d.getMinutes()!==0);
    const timeStr = hasTime ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
    return { dateStr, timeStr };
  }
  function composeIso(dateVal, timeVal){
    if (!dateVal) return null;
    return new Date(`${dateVal}T${timeVal || '00:00'}`).toISOString();
  }

  // ---------- theme ----------
  async function loadTheme(){
    try {
      const res = await LS.get(THEME_KEY);
      const t = res && res.value ? res.value : 'light';
      if (t === 'dark') document.documentElement.setAttribute('data-theme','dark');
      themeToggle.textContent = (t === 'dark' ? '☀' : '☾') + ' Toggle theme';
    } catch(e) { themeToggle.textContent = '☾ Toggle theme'; }
  }
  async function toggleTheme(){
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.setAttribute('data-theme','dark');
    else document.documentElement.removeAttribute('data-theme');
    themeToggle.textContent = (next === 'dark' ? '☀' : '☾') + ' Toggle theme';
    try { await LS.set(THEME_KEY, next); } catch(e){}
  }
  themeToggle.addEventListener('click', () => { toggleTheme(); menuPanel.classList.remove('show'); });

  // ---------- menu (export/import) ----------
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); menuPanel.classList.toggle('show'); });
  document.addEventListener('click', () => menuPanel.classList.remove('show'));
  menuPanel.addEventListener('click', (e) => e.stopPropagation());

  exportBtn.addEventListener('click', () => {
    const payload = { items, categories, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `sankalp-backup-${dayKey(new Date())}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    menuPanel.classList.remove('show');
  });
  importBtn.addEventListener('click', () => { importFile.click(); menuPanel.classList.remove('show'); });
  importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (Array.isArray(data.items)) items = data.items;
      if (Array.isArray(data.categories) && data.categories.length) categories = data.categories;
      await saveItems(); await saveCategories();
      renderInlineSubPick(); renderModalSubPick();
      render();
    } catch(err){ console.error('import failed', err); }
    importFile.value = '';
  });

  // ---------- settings sheet ----------
  const settingsOverlay = document.getElementById('settingsOverlay');
  const settingsClose = document.getElementById('settingsClose');
  const settingsBtn = document.getElementById('settingsBtn');
  const weeklyReviewBtn = document.getElementById('weeklyReviewBtn');

  function openSettings(){ settingsOverlay.classList.add('show'); refreshDevInfo(); }
  function closeSettings(){ settingsOverlay.classList.remove('show'); }
  settingsBtn.addEventListener('click', () => { menuPanel.classList.remove('show'); openSettings(); });
  settingsClose.addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettings(); });

  // ---------- developer mode ----------
  const devToggleBtn = document.getElementById('devToggleBtn');
  const devPanel = document.getElementById('devPanel');
  const devDbInfo = document.getElementById('devDbInfo');
  const devQueueInfo = document.getElementById('devQueueInfo');
  const devForceSyncBtn = document.getElementById('devForceSyncBtn');
  const devExportDbBtn = document.getElementById('devExportDbBtn');
  const devClearCacheBtn = document.getElementById('devClearCacheBtn');
  const devResetBtn = document.getElementById('devResetBtn');

  devToggleBtn.addEventListener('click', () => {
    const show = devPanel.style.display !== 'block';
    devPanel.style.display = show ? 'block' : 'none';
    devToggleBtn.textContent = show ? 'Hide developer mode' : 'Developer mode';
    if (show) refreshDevInfo();
  });
  function refreshDevInfo(){
    if (!devDbInfo) return;
    devDbInfo.textContent = `${items.length} items · ${categories.length} categories · storage: IndexedDB (Dexie)`;
    devQueueInfo.textContent = `${tombstones.length} pending delete${tombstones.length===1?'':'s'} to sync`;
  }
  devForceSyncBtn.addEventListener('click', () => {
    if (!SYNC_ENABLED){ showToast('Sync is not configured'); return; }
    if (!syncUser){ showToast('Sign in first'); return; }
    syncNow();
    showToast('Sync triggered');
  });
  devExportDbBtn.addEventListener('click', async () => {
    try {
      const all = await db.kv.toArray();
      const dump = {};
      all.forEach(r => { try { dump[r.key] = JSON.parse(r.value); } catch(e){ dump[r.key] = r.value; } });
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `sankalp-db-dump-${dayKey(new Date())}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch(e){ showToast('Export failed'); }
  });
  devClearCacheBtn.addEventListener('click', async () => {
    try {
      if ('caches' in window){ const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); }
      if ('serviceWorker' in navigator){ const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); }
      showToast('Cache cleared — reload to refetch assets');
    } catch(e){ showToast('Could not clear cache'); }
  });
  devResetBtn.addEventListener('click', async () => {
    if (!confirm('This permanently deletes all local data on this device. Continue?')) return;
    if (!confirm('Really sure? This cannot be undone.')) return;
    try { await db.kv.clear(); localStorage.clear(); } catch(e){}
    location.reload();
  });

  // ---------- weekly review sheet ----------
  const reviewOverlay = document.getElementById('reviewOverlay');
  const reviewClose = document.getElementById('reviewClose');
  const reviewBody = document.getElementById('reviewBody');

  function openReview(){ renderReview(); reviewOverlay.classList.add('show'); }
  function closeReview(){ reviewOverlay.classList.remove('show'); }
  weeklyReviewBtn.addEventListener('click', () => { menuPanel.classList.remove('show'); openReview(); });
  reviewClose.addEventListener('click', closeReview);
  reviewOverlay.addEventListener('click', (e) => { if (e.target === reviewOverlay) closeReview(); });

  function renderReview(){
    const now = Date.now();
    const weekAgo = now - 1000*60*60*24*7;
    const weekAhead = now + 1000*60*60*24*7;
    const inboxItems = items.filter(i => i.kind === 'inbox' && !i.done).sort((a,b) => b.createdAt - a.createdAt);
    const overdueItems = items.filter(isOverdue).sort((a,b) => new Date(a.deadline) - new Date(b.deadline));
    const soonItems = items.filter(i => i.kind === 'task' && !i.done && i.deadline && !isOverdue(i) && new Date(i.deadline).getTime() < weekAhead)
      .sort((a,b) => new Date(a.deadline) - new Date(b.deadline));
    const completedItems = items.filter(i => i.done && i.doneAt && i.doneAt > weekAgo).sort((a,b) => (b.doneAt||0)-(a.doneAt||0));
    const openBucketCount = items.filter(i => i.kind === 'bucket' && !i.done).length;

    reviewBody.innerHTML = `
      <div class="review-section">
        <div class="review-head">Inbox <span class="review-count">${inboxItems.length}</span></div>
        ${inboxItems.length ? inboxItems.map(i => inboxRowHtml(i)).join('') : '<div class="empty-mini">Nothing waiting to be processed.</div>'}
      </div>
      <div class="review-section">
        <div class="review-head">Overdue <span class="review-count">${overdueItems.length}</span></div>
        ${overdueItems.length ? overdueItems.map(i => rowHtml(i, 'var(--urgent)')).join('') : '<div class="empty-mini">Nothing overdue.</div>'}
      </div>
      <div class="review-section">
        <div class="review-head">Due in the next 7 days <span class="review-count">${soonItems.length}</span></div>
        ${soonItems.length ? soonItems.map(i => rowHtml(i, 'var(--task)')).join('') : '<div class="empty-mini">Nothing scheduled.</div>'}
      </div>
      <div class="review-section">
        <div class="review-head">Completed this week <span class="review-count">${completedItems.length}</span></div>
        ${completedItems.length ? `<button class="settings-btn" id="reviewArchiveBtn">Archive all ${completedItems.length}</button>` : '<div class="empty-mini">Nothing completed yet.</div>'}
      </div>
      <div class="review-section">
        <div class="review-head">Bucket list <span class="review-count">${openBucketCount} open</span></div>
        <div class="empty-mini">Reviewed separately — nothing to action here.</div>
      </div>
    `;
    bindRows(reviewBody);
    bindInboxRows(reviewBody);
    const archiveBtn = reviewBody.querySelector('#reviewArchiveBtn');
    if (archiveBtn) archiveBtn.addEventListener('click', async () => {
      const ids = completedItems.map(i => i.id);
      items = items.filter(i => !ids.includes(i.id));
      for (const id of ids) await addTombstone(id);
      await saveItems();
      render();
      renderReview();
      scheduleSync();
      showToast(`Archived ${ids.length} item${ids.length===1?'':'s'}`);
    });
  }

  // ---------- storage: categories ----------
  async function loadCategories(){
    try {
      const res = await LS.get(CATS_KEY);
      categories = res && res.value ? JSON.parse(res.value) : null;
    } catch(e) { categories = null; }
    if (!categories || !Array.isArray(categories) || categories.length === 0){
      categories = [
        { key:'places', label:'Places', color:'#3F7C60' },
        { key:'buy',    label:'Buy',    color:'#B07A1E' },
        { key:'learn',  label:'Learn',  color:'#7C6FC9' },
      ];
      await saveCategories();
    }
    if (!selectedSub) selectedSub = categories[0].key;
    if (!mSub) mSub = categories[0].key;
  }
  async function saveCategories(){
    try { await LS.set(CATS_KEY, JSON.stringify(categories)); } catch(e){}
  }

  // ---------- storage: items ----------
  async function loadItems(){
    try {
      const res = await LS.get(V2_KEY);
      items = res && res.value ? JSON.parse(res.value) : null;
    } catch (e) { items = null; }
    if (items === null){
      try {
        const old = await LS.get(V1_KEY);
        const oldItems = old && old.value ? JSON.parse(old.value) : [];
        items = oldItems.map(i => ({
          id: i.id, text: i.text,
          kind: i.category === 'tasks' ? 'task' : 'bucket',
          subcategory: i.category === 'tasks' ? null : i.category,
          deadline: i.deadline, done: i.done, doneAt: i.doneAt, createdAt: i.createdAt, pinned: false
        }));
        if (items.length) await saveItems();
      } catch (e) { items = []; }
    }
    if (!Array.isArray(items)) items = [];
    items.forEach(i => {
      if (i.pinned === undefined) i.pinned = false;
      if (i.notes === undefined) i.notes = '';
      if (i.updatedAt === undefined) i.updatedAt = i.createdAt || Date.now();
    });
    loaded = true;
  }
  async function saveItems(){
    try { await LS.set(V2_KEY, JSON.stringify(items)); } catch (e) { console.error('save failed', e); }
  }

  // ---------- tombstones (deleted item ids awaiting sync push) ----------
  let tombstones = [];
  async function loadTombstones(){
    try { const res = await LS.get(TOMBSTONES_KEY); tombstones = res && res.value ? JSON.parse(res.value) : []; }
    catch(e){ tombstones = []; }
    if (!Array.isArray(tombstones)) tombstones = [];
  }
  async function saveTombstones(){
    try { await LS.set(TOMBSTONES_KEY, JSON.stringify(tombstones)); } catch(e){}
  }
  async function addTombstone(id){
    tombstones = tombstones.filter(t => t.id !== id);
    tombstones.push({ id, deletedAt: Date.now() });
    await saveTombstones();
  }

  // =====================================================================
  // SUPABASE SYNC (only active if SUPABASE_URL / SUPABASE_ANON_KEY are set)
  // Strategy: naive full-state sync, last-write-wins by updatedAt (ms).
  // Local storage remains the source of truth for instant UI; sync is a
  // background layer on top, never blocking reads/writes.
  // =====================================================================
  const SYNC_ENABLED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
  let supabase = null;
  let syncUser = null;
  let syncTimer = null;
  let syncInFlight = false;

  const syncStatusNote = document.getElementById('syncStatusNote');
  const syncSignedOut = document.getElementById('syncSignedOut');
  const syncEmail = document.getElementById('syncEmail');
  const syncSendLink = document.getElementById('syncSendLink');
  const syncNowBtn = document.getElementById('syncNowBtn');
  const syncSignOutBtn = document.getElementById('syncSignOutBtn');
  const syncBadgeEl = document.getElementById('syncBadge');

  function setSyncNote(text){ if (syncStatusNote) syncStatusNote.textContent = text; }
  function setSyncBadge(state){
    if (!syncBadgeEl) return;
    const icons = { off:'⚪', synced:'🟢', syncing:'🟡', offline:'🔴', error:'🔴', signedout:'🔴' };
    const titles = {
      off:'Sync not configured', synced:'Synced', syncing:'Syncing…',
      offline:'Offline', error:'Sync error, will retry', signedout:'Signed out — open Settings to sync'
    };
    syncBadgeEl.textContent = icons[state] || '⚪';
    syncBadgeEl.title = titles[state] || 'Sync status';
  }

  async function initSync(){
    if (!SYNC_ENABLED){
      setSyncNote('Sync: not configured');
      setSyncBadge('off');
      return;
    }
    try {
      const mod = await import('https://esm.sh/@supabase/supabase-js@2');
      supabase = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch(e){
      setSyncNote('Sync: failed to load');
      setSyncBadge('error');
      console.error('supabase load failed', e);
      return;
    }

    // handle magic-link redirect (Supabase appends tokens to the URL hash)
    try { await supabase.auth.getSessionFromUrl?.({ storeSession: true }); } catch(e){}

    const { data: { session } } = await supabase.auth.getSession();
    syncUser = session ? session.user : null;
    updateSyncUI();

    supabase.auth.onAuthStateChange((_event, session) => {
      syncUser = session ? session.user : null;
      updateSyncUI();
      if (syncUser) syncNow();
    });

    syncSendLink.addEventListener('click', async () => {
      const email = syncEmail.value.trim();
      if (!email) return;
      syncSendLink.disabled = true; syncSendLink.textContent = 'Sending…';
      try {
        await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
        setSyncNote('Sync: check your email for a link');
      } catch(e){
        setSyncNote('Sync: failed to send link');
      }
      syncSendLink.disabled = false; syncSendLink.textContent = 'Send sign-in link';
    });
    syncNowBtn.addEventListener('click', () => syncNow());
    syncSignOutBtn.addEventListener('click', async () => { await supabase.auth.signOut(); syncUser=null; updateSyncUI(); });

    if (syncUser){
      syncNow();
      syncTimer = setInterval(syncNow, 30000);
      window.addEventListener('online', syncNow);
      window.addEventListener('offline', () => setSyncBadge('offline'));
      document.addEventListener('visibilitychange', () => { syncNow(); }); // fires on both hide and return — cheap no-op if nothing changed
      window.addEventListener('pagehide', () => { syncNow(); }); // best-effort flush before the tab/app closes
    }
  }

  function updateSyncUI(){
    if (!SYNC_ENABLED) return;
    if (syncUser){
      syncSignedOut.style.display = 'none';
      syncNowBtn.style.display = 'block';
      syncSignOutBtn.style.display = 'block';
      setSyncNote('Synced as ' + syncUser.email);
      setSyncBadge(navigator.onLine ? 'synced' : 'offline');
      if (!syncTimer){ syncTimer = setInterval(syncNow, 30000); }
    } else {
      syncSignedOut.style.display = 'block';
      syncNowBtn.style.display = 'none';
      syncSignOutBtn.style.display = 'none';
      setSyncNote('Sync: signed out');
      setSyncBadge('signedout');
      if (syncTimer){ clearInterval(syncTimer); syncTimer = null; }
    }
  }

  let syncDebounce = null;
  function scheduleSync(){
    if (!SYNC_ENABLED || !syncUser) return;
    clearTimeout(syncDebounce);
    syncDebounce = setTimeout(syncNow, 2000);
  }

  function itemToRow(i){
    return {
      id: i.id, user_id: syncUser.id, text: i.text, notes: i.notes || '',
      kind: i.kind, subcategory: i.subcategory, deadline: i.deadline,
      done: !!i.done, done_at: i.doneAt, created_at: i.createdAt,
      updated_at: i.updatedAt || Date.now(), pinned: !!i.pinned,
    };
  }
  function rowToItem(r){
    return {
      id: r.id, text: r.text, notes: r.notes || '', kind: r.kind, subcategory: r.subcategory,
      deadline: r.deadline, done: r.done, doneAt: r.done_at, createdAt: r.created_at,
      updatedAt: r.updated_at, pinned: r.pinned,
    };
  }

  async function syncNow(){
    if (!SYNC_ENABLED || !syncUser || !supabase || syncInFlight) return;
    if (!navigator.onLine){ setSyncBadge('offline'); return; }
    syncInFlight = true;
    setSyncNote('Syncing…');
    setSyncBadge('syncing');
    try {
      const sinceKey = 'sankalp-last-sync-v1';
      let lastSyncAt = 0;
      try { const r = await LS.get(sinceKey); lastSyncAt = r ? Number(r.value) : 0; } catch(e){}

      // 0. pull the SHARED tombstones table first. This is how a delete made
      //    on one device becomes visible to every other device — without this,
      //    a device that still has the item locally will just upsert it right
      //    back on its next sync, resurrecting anything deleted elsewhere.
      let remoteTombstoneIds = new Set();
      const { data: remoteTombstones, error: e0 } = await supabase.from('tombstones').select('*').eq('user_id', syncUser.id);
      if (!e0 && remoteTombstones){
        remoteTombstoneIds = new Set(remoteTombstones.map(t => t.id));
        if (remoteTombstoneIds.size){
          const before = items.length;
          items = items.filter(i => !remoteTombstoneIds.has(i.id));
          if (items.length !== before) await saveItems();
        }
      }

      // 1. pull remote state and merge (remote wins only if strictly newer).
      //    Doing this before pushing avoids a local push blindly clobbering a
      //    newer edit made from another device. Anything tombstoned — locally
      //    pending or already recorded remotely — is skipped so a delete can
      //    never be resurrected by this merge.
      let conflicts = 0;
      const { data: remoteItems, error: e1 } = await supabase.from('items').select('*').eq('user_id', syncUser.id);
      if (!e1 && remoteItems){
        const localById = new Map(items.map(i => [i.id, i]));
        const localTombstoneIds = new Set(tombstones.map(t => t.id));
        remoteItems.forEach(r => {
          if (localTombstoneIds.has(r.id) || remoteTombstoneIds.has(r.id)) return; // deleted — don't let the pull resurrect it
          const local = localById.get(r.id);
          const remoteNewer = !local || (r.updated_at || 0) > (local.updatedAt || 0);
          if (remoteNewer){
            // a genuine conflict is: we had a local edit since our last successful
            // sync, and a *different* remote edit beat it to the server.
            if (local && local.updatedAt > lastSyncAt && r.text !== local.text) conflicts++;
            localById.set(r.id, rowToItem(r));
          }
        });
        items = Array.from(localById.values());
        await saveItems();
      }
      const { data: remoteCats, error: e2 } = await supabase.from('categories').select('*').eq('user_id', syncUser.id);
      if (!e2 && remoteCats && remoteCats.length){
        const localByKey = new Map(categories.map(c => [c.key, c]));
        remoteCats.forEach(c => { if (!localByKey.has(c.key)) localByKey.set(c.key, { key: c.key, label: c.label, color: c.color }); });
        categories = Array.from(localByKey.values());
        await saveCategories();
      }
      render();
      if (conflicts > 0) showToast(`${conflicts} item${conflicts===1?'':'s'} updated from another device`);

      // 2. push local deletes — remove the row AND record it in the shared
      //    tombstones table so every other device learns about the delete
      //    on its next sync, instead of re-uploading its own stale copy.
      if (tombstones.length){
        const ids = tombstones.map(t => t.id);
        await supabase.from('items').delete().in('id', ids).eq('user_id', syncUser.id);
        await supabase.from('tombstones').upsert(
          tombstones.map(t => ({ id: t.id, user_id: syncUser.id, deleted_at: t.deletedAt })),
          { onConflict: 'id' }
        );
        tombstones = [];
        await saveTombstones();
      }
      // 3. push local items (now merged/authoritative — safe to upsert as-is)
      if (items.length){
        await supabase.from('items').upsert(items.map(itemToRow), { onConflict: 'id' });
      }
      // 4. push categories
      if (categories.length){
        await supabase.from('categories').upsert(
          categories.map(c => ({ key: c.key, user_id: syncUser.id, label: c.label, color: c.color })),
          { onConflict: 'user_id,key' }
        );
      }
      await LS.set(sinceKey, String(Date.now()));
      render();
      setSyncNote('Synced as ' + syncUser.email);
      setSyncBadge('synced');
    } catch(e){
      console.error('sync failed', e);
      setSyncNote('Sync: error, will retry');
      setSyncBadge('error');
    }
    syncInFlight = false;
  }

  function isOverdue(item){ return item.deadline && !item.done && new Date(item.deadline).getTime() < Date.now(); }
  function isUrgent(item){
    if (item.kind !== 'task' || item.done || !item.deadline) return false;
    return new Date(item.deadline).getTime() < Date.now() + URGENT_WINDOW_MS;
  }
  function staleDays(item){
    if (item.kind !== 'task' || item.done || item.deadline || item.pinned) return 0;
    return Math.floor((Date.now() - item.createdAt) / (1000*60*60*24));
  }
  function fmtDate(iso){
    const d = new Date(iso);
    const datePart = d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
    const hasTime = (d.getHours() !== 0 || d.getMinutes() !== 0);
    const timePart = hasTime ? d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'}) : '';
    return timePart ? `${datePart}, ${timePart}` : datePart;
  }

  function highlightMatch(text, q){
    if (!q) return escapeHtml(text);
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + q.length)) + '</mark>' + escapeHtml(text.slice(idx + q.length));
  }

  function rowHtml(item, colorVar, hq){
    const overdue = isOverdue(item);
    const stale = staleDays(item);
    const sub = item.subcategory ? catInfo(item.subcategory) : null;
    return `<div class="item ${item.done?'done':''} ${item.pinned?'pinned':''}" style="--cat-color:${colorVar}" data-id="${item.id}">
      <button class="check" data-action="toggle">
        <svg width="11" height="8" viewBox="0 0 12 9" fill="none"><path d="M1 4.5L4.2 7.5L11 1" stroke="var(--bg)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="item-body" data-action="edit">
        <div class="item-text">${item.pinned ? '★ ' : ''}${hq ? highlightMatch(item.text, hq) : escapeHtml(item.text)}</div>
        <div class="item-meta">
          ${sub ? `<span class="item-dot" style="--cat-color:${sub.color}"></span><span class="item-sub">${escapeHtml(sub.label)}</span>` : ''}
          ${item.deadline ? `<span class="item-date mono ${overdue?'overdue':''}">${overdue?'overdue · ':''}${fmtDate(item.deadline)}</span>` : ''}
          ${stale >= STALE_DAYS ? `<span class="item-date mono stale">${stale}d open</span>` : ''}
          ${item.notes ? `<span class="item-date mono" title="${escapeHtml(item.notes)}">📝</span>` : ''}
        </div>
      </div>
      <div class="rowbtns">
        ${item.kind === 'task' ? `<button class="pin ${item.pinned?'on':''}" data-action="pin" title="priority">★</button>` : ''}
        <button class="del" data-action="delete">×</button>
      </div>
    </div>`;
  }

  function inboxRowHtml(item){
    return `<div class="inbox-item" data-id="${item.id}">
      <div class="item-body" data-action="edit">
        <div class="item-text">${escapeHtml(item.text)}</div>
        ${item.notes ? `<div class="item-meta"><span class="item-date mono" title="${escapeHtml(item.notes)}">📝 has notes</span></div>` : ''}
      </div>
      <div class="inbox-actions">
        <button data-action="to-task" title="Move to Tasks">→ Task</button>
        <button data-action="to-bucket" title="Move to Bucket List">→ Bucket</button>
        <button class="del" data-action="delete" title="Delete">×</button>
      </div>
    </div>`;
  }
  function bindInboxRows(container){
    container.querySelectorAll('.inbox-item').forEach(row => {
      const id = row.dataset.id;
      const toTask = row.querySelector('[data-action="to-task"]');
      const toBucket = row.querySelector('[data-action="to-bucket"]');
      const del = row.querySelector('[data-action="delete"]');
      const body = row.querySelector('[data-action="edit"]');
      if (toTask) toTask.addEventListener('click', (e) => { e.stopPropagation(); promoteInboxItem(id, 'task'); });
      if (toBucket) toBucket.addEventListener('click', (e) => { e.stopPropagation(); promoteInboxItem(id, 'bucket'); });
      if (del) del.addEventListener('click', (e) => { e.stopPropagation(); deleteItem(id); });
      if (body) body.addEventListener('click', () => {
        const item = items.find(i => i.id === id);
        if (item) openModal('edit', item);
      });
    });
  }
  async function promoteInboxItem(id, targetKind){
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.kind = targetKind;
    if (targetKind === 'bucket' && !item.subcategory) item.subcategory = categories[0] ? categories[0].key : null;
    item.updatedAt = Date.now();
    render();
    await saveItems();
    scheduleSync();
    showToast(targetKind === 'task' ? 'Moved to Tasks' : 'Moved to Bucket List');
  }
  function updateInboxBadge(){
    const n = items.filter(i => i.kind === 'inbox' && !i.done).length;
    const badge = document.getElementById('inboxBadge');
    if (!badge) return;
    if (n > 0){ badge.textContent = n; badge.style.display = 'inline-block'; }
    else { badge.style.display = 'none'; }
  }
  function bindRows(container){
    container.querySelectorAll('.item').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('[data-action="toggle"]').addEventListener('click', (e) => { e.stopPropagation(); toggleItem(id); });
      row.querySelector('[data-action="delete"]').addEventListener('click', (e) => { e.stopPropagation(); deleteItem(id); });
      const pinBtn = row.querySelector('[data-action="pin"]');
      if (pinBtn) pinBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePin(id); });
      row.querySelector('[data-action="edit"]').addEventListener('click', () => {
        const item = items.find(i => i.id === id);
        if (item) openModal('edit', item);
      });
    });
  }

  function renderWeekStrip(tasks){
    const days = []; const now = new Date();
    for (let i=0;i<7;i++) days.push(new Date(now.getFullYear(), now.getMonth(), now.getDate()+i));
    weekstripEl.innerHTML = days.map(d => {
      const key = dayKey(d);
      const dayTasks = tasks.filter(t => t.deadline && !t.done && dayKey(new Date(t.deadline)) === key);
      const hasUrgent = dayTasks.some(isUrgent);
      const hasTask = dayTasks.length > 0 && !hasUrgent;
      const isToday = d.toDateString() === now.toDateString();
      return `<div class="wcell ${dayFilter===key?'active':''} ${hasUrgent?'has-urgent':''} ${hasTask?'has-task':''}" data-day="${key}">
        <span class="wl">${d.toLocaleDateString('en-US',{weekday:'short'}).slice(0,2)}</span>
        <span class="wn ${isToday?'today':''}">${d.getDate()}</span><span class="wd"></span>
      </div>`;
    }).join('').replace(/wn (today)?"/g, (m)=>m); // no-op safeguard
    // fix today class placement (applied to wn element directly above)
    weekstripEl.querySelectorAll('.wcell').forEach(c => {
      c.addEventListener('click', () => { dayFilter = (dayFilter === c.dataset.day) ? null : c.dataset.day; render(); });
    });
    wclearEl.classList.toggle('show', !!dayFilter);
  }
  wclearEl.addEventListener('click', () => { dayFilter = null; render(); });

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      tabButtons.forEach(b => b.classList.toggle('active', b===btn));
      const kindForTab = currentTab === 'bucket' ? 'bucket' : currentTab === 'inbox' ? 'inbox' : 'task';
      addKind = kindForTab;
      kindToggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.kind === kindForTab));
      subPick.style.display = kindForTab === 'bucket' ? 'flex' : 'none';
      itemInput.placeholder = kindForTab === 'bucket' ? 'Add to your bucket list…' : kindForTab === 'inbox' ? 'Quick capture…' : 'Add a task…';
      render();
    });
  });

  // ---------- search ----------
  function openSearch(){
    searchBar.style.display = 'block';
    searchBtn.classList.add('active');
    searchInput.focus();
  }
  function closeSearch(){
    searchQuery = '';
    searchInput.value = '';
    searchBar.style.display = 'none';
    searchBtn.classList.remove('active');
    render();
  }
  searchBtn.addEventListener('click', () => { searchBar.style.display === 'block' ? closeSearch() : openSearch(); });
  searchInput.addEventListener('input', () => { searchQuery = searchInput.value.trim(); render(); });
  searchInput.addEventListener('keydown', (e) => { if (e.key==='Escape'){ e.stopPropagation(); closeSearch(); } });

  // ---------- toast ----------
  let toastTimer = null;
  function showToast(msg){
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 4000);
  }

  // ---------- global keyboard shortcuts ----------
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea';
    if (e.key === '/' && !typing){
      e.preventDefault();
      openSearch();
    } else if ((e.key === 'n' || e.key === 'N') && !typing && !modalOverlay.classList.contains('show')){
      e.preventDefault();
      openModal('add');
    } else if (e.key === 'Escape' && !typing && searchBar.style.display === 'block'){
      closeSearch();
    } else if (e.key === 'Escape' && !typing && settingsOverlay.classList.contains('show')){
      closeSettings();
    } else if (e.key === 'Escape' && !typing && reviewOverlay.classList.contains('show')){
      closeReview();
    }
  });

  function render(){
    updateInboxBadge();
    if (loaded && items.length === 0){
      mainEl.innerHTML = `<div class="empty"><div class="display">Nothing here yet.</div><p>Add a task for today,<br>or start your bucket list.</p></div>`;
      statline.textContent = 'nothing filed yet';
      statline.classList.remove('hot');
      weekstripEl.innerHTML = ''; wclearEl.classList.remove('show');
      return;
    }

    const tasks = items.filter(i => i.kind === 'task');
    const bucket = items.filter(i => i.kind === 'bucket');

    if (searchQuery){
      const q = searchQuery.toLowerCase();
      const results = items.filter(i =>
        i.text.toLowerCase().includes(q) ||
        (i.notes && i.notes.toLowerCase().includes(q)) ||
        (i.subcategory && catInfo(i.subcategory).label.toLowerCase().includes(q))
      ).sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
      weekstripEl.style.display = 'none'; wclearEl.classList.remove('show');
      statline.textContent = `${results.length} match${results.length===1?'':'es'} for "${searchQuery}"`;
      statline.classList.remove('hot');
      const colorFor = (i) => i.kind==='task' ? 'var(--task)' : i.kind==='bucket' ? 'var(--bucket)' : 'var(--inbox)';
      mainEl.innerHTML = results.length
        ? `<div class="section"><div class="section-head"><span class="section-label">Results</span><span class="section-line"></span></div>${results.map(i => rowHtml(i, colorFor(i), searchQuery)).join('')}</div>`
        : `<div class="empty"><div class="display">No matches.</div><p>Try a different word.</p></div>`;
      bindRows(mainEl);
      return;
    }

    if (currentTab === 'docket'){
      weekstripEl.style.display = 'flex';
      renderWeekStrip(tasks);

      let html = '';
      let openCount, doneThisWeek;

      if (dayFilter){
        // day filter overrides urgent/task split: show everything due that day together
        const dayTasks = tasks.filter(i => !i.done && i.deadline && dayKey(new Date(i.deadline)) === dayFilter)
          .sort((a,b) => {
            const pa = a.pinned?0:1, pb = b.pinned?0:1;
            if (pa!==pb) return pa-pb;
            return new Date(a.deadline) - new Date(b.deadline);
          });
        const doneDayTasks = tasks.filter(i => i.done && i.deadline && dayKey(new Date(i.deadline)) === dayFilter)
          .sort((a,b) => (b.doneAt||0)-(a.doneAt||0));

        openCount = dayTasks.length;
        statline.textContent = `${openCount} due this day`;
        statline.classList.remove('hot');

        html += `<div class="section">
          <div class="section-head"><span class="section-label" style="--section-color:var(--task)">Tasks</span>
          <span class="section-count">${dayTasks.length}</span><span class="section-line"></span></div>
          ${dayTasks.length ? dayTasks.map(i => rowHtml(i, isUrgent(i) ? 'var(--urgent)' : 'var(--task)')).join('') : '<div class="empty-mini">Nothing due that day.</div>'}
          ${doneDayTasks.length ? `<button class="toggle-done" data-toggle="tasks">${showDoneTasks?'hide':'show'} ${doneDayTasks.length} completed</button>` : ''}
          ${showDoneTasks ? doneDayTasks.map(i => rowHtml(i, 'var(--task)')).join('') : ''}
        </div>`;
      } else {
        const urgent = tasks.filter(isUrgent).sort((a,b) => new Date(a.deadline) - new Date(b.deadline));
        const urgentIds = new Set(urgent.map(i => i.id));
        const openTasks = tasks.filter(i => !i.done && !urgentIds.has(i.id)).sort((a,b) => {
          const pa = a.pinned?0:1, pb = b.pinned?0:1;
          if (pa !== pb) return pa-pb;
          if (a.deadline && b.deadline) return new Date(a.deadline)-new Date(b.deadline);
          if (a.deadline) return -1; if (b.deadline) return 1;
          return b.createdAt - a.createdAt;
        });
        const doneTasks = tasks.filter(i => i.done).sort((a,b) => (b.doneAt||0)-(a.doneAt||0));

        openCount = tasks.filter(i=>!i.done).length;
        const weekAgo = Date.now() - 1000*60*60*24*7;
        doneThisWeek = tasks.filter(i => i.done && i.doneAt && i.doneAt > weekAgo).length;

        if (urgent.length > 0){
          statline.textContent = `${urgent.length} urgent · ${openCount} open${doneThisWeek?` · ${doneThisWeek} done this wk`:''}`;
          statline.classList.add('hot');
        } else {
          statline.textContent = `${openCount} open${doneThisWeek?` · ${doneThisWeek} done this wk`:''}`;
          statline.classList.remove('hot');
        }

        if (urgent.length > 0){
          html += `<div class="section">
            <div class="section-head"><span class="dot-pulse"></span><span class="section-label" style="--section-color:var(--urgent)">Urgent</span>
            <span class="section-count">${urgent.length}</span><span class="section-line"></span></div>
            ${urgent.map(i => rowHtml(i, 'var(--urgent)')).join('')}</div>`;
        }
        html += `<div class="section">
          <div class="section-head"><span class="section-label" style="--section-color:var(--task)">Tasks</span>
          <span class="section-count">${openTasks.length}</span><span class="section-line"></span></div>
          ${openTasks.length ? openTasks.map(i => rowHtml(i, 'var(--task)')).join('') : '<div class="empty-mini">No open tasks. Add one below.</div>'}
          ${doneTasks.length ? `<button class="toggle-done" data-toggle="tasks">${showDoneTasks?'hide':'show'} ${doneTasks.length} completed</button>` : ''}
          ${showDoneTasks ? doneTasks.map(i => rowHtml(i, 'var(--task)')).join('') : ''}
        </div>`;
      }

      mainEl.innerHTML = html;
      bindRows(mainEl);
      mainEl.querySelectorAll('[data-toggle="tasks"]').forEach(b => b.addEventListener('click', () => { showDoneTasks=!showDoneTasks; render(); }));

    } else if (currentTab === 'bucket'){
      weekstripEl.style.display = 'none';
      wclearEl.classList.remove('show');

      let bucketFiltered = activeSub === 'all' ? bucket : bucket.filter(i => i.subcategory === activeSub);
      const openBucket = bucketFiltered.filter(i => !i.done).sort((a,b) => {
        if (a.deadline && b.deadline) return new Date(a.deadline)-new Date(b.deadline);
        if (a.deadline) return -1; if (b.deadline) return 1;
        return b.createdAt - a.createdAt;
      });
      const doneBucket = bucketFiltered.filter(i => i.done).sort((a,b) => (b.doneAt||0)-(a.doneAt||0));
      const openCount = bucket.filter(i=>!i.done).length;
      statline.textContent = `${openCount} open · ${bucket.filter(i=>i.done).length} done`;
      statline.classList.remove('hot');

      let html = `<div class="bucket-chips">
        <button class="bchip ${activeSub==='all'?'active':''}" data-sub="all" style="${activeSub==='all'?'background:var(--text);':''}">All</button>
        ${categories.map(s => `<button class="bchip ${activeSub===s.key?'active':''}" data-sub="${s.key}" style="${activeSub===s.key?`background:${s.color};`:''}"><span class="d" style="background:${s.color}"></span>${escapeHtml(s.label)}</button>`).join('')}
      </div>`;
      html += openBucket.length ? openBucket.map(i => rowHtml(i, catInfo(i.subcategory).color)).join('') : '<div class="empty-mini">Nothing here yet. Add something worth waiting for.</div>';
      if (doneBucket.length){
        html += `<button class="toggle-done" data-toggle="bucket">${showDoneBucket?'hide':'show'} ${doneBucket.length} completed</button>`;
        if (showDoneBucket) html += doneBucket.map(i => rowHtml(i, catInfo(i.subcategory).color)).join('');
      }

      mainEl.innerHTML = html;
      bindRows(mainEl);
      mainEl.querySelectorAll('[data-toggle="bucket"]').forEach(b => b.addEventListener('click', () => { showDoneBucket=!showDoneBucket; render(); }));
      mainEl.querySelectorAll('[data-sub]').forEach(b => b.addEventListener('click', () => { activeSub = b.dataset.sub; render(); }));

    } else if (currentTab === 'inbox'){
      weekstripEl.style.display = 'none';
      wclearEl.classList.remove('show');

      const openInbox = items.filter(i => i.kind === 'inbox' && !i.done).sort((a,b) => b.createdAt - a.createdAt);
      statline.textContent = `${openInbox.length} to process`;
      statline.classList.toggle('hot', openInbox.length > 10);

      mainEl.innerHTML = openInbox.length
        ? `<div class="section">
            <div class="section-head"><span class="section-label" style="--section-color:var(--inbox)">Inbox</span><span class="section-count">${openInbox.length}</span><span class="section-line"></span></div>
            ${openInbox.map(i => inboxRowHtml(i)).join('')}
          </div>`
        : `<div class="empty"><div class="display">Inbox zero.</div><p>Quick-capture anything here, decide<br>what it is during your weekly review.</p></div>`;
      bindInboxRows(mainEl);
    }
  }

  async function toggleItem(id){ const item = items.find(i=>i.id===id); if(!item) return; item.done=!item.done; item.doneAt=item.done?Date.now():null; item.updatedAt=Date.now(); render(); await saveItems(); scheduleSync(); }
  async function togglePin(id){ const item = items.find(i=>i.id===id); if(!item) return; item.pinned=!item.pinned; item.updatedAt=Date.now(); render(); await saveItems(); scheduleSync(); }
  async function deleteItem(id){
    items = items.filter(i=>i.id!==id);
    await addTombstone(id);
    render();
    await saveItems();
    scheduleSync();
  }

  async function commitAdd(text, kind, sub, dateVal, timeVal, pinned, notes){
    const item = {
      id: uid(), text, kind, subcategory: kind==='bucket' ? sub : null,
      deadline: composeIso(dateVal, timeVal),
      notes: (notes||'').trim(),
      done:false, doneAt:null, createdAt: Date.now(), updatedAt: Date.now(), pinned: kind==='task' ? pinned : false,
    };
    items.push(item);
    render();
    await saveItems();
    scheduleSync();
  }
  async function commitEdit(id, text, kind, sub, dateVal, timeVal, pinned, notes){
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.text = text; item.kind = kind; item.subcategory = kind==='bucket' ? sub : null;
    item.deadline = composeIso(dateVal, timeVal);
    item.notes = (notes||'').trim();
    item.pinned = kind==='task' ? pinned : false;
    item.updatedAt = Date.now();
    render();
    await saveItems();
    scheduleSync();
  }

  // ---------- unified smart add button ----------
  function updateAddBtnState(){
    const ready = itemInput.value.trim().length > 0;
    addBtn.textContent = ready ? '↵' : '+';
    addBtn.classList.toggle('ready', ready);
    addBtn.title = ready ? 'Add' : 'Open full form';
  }
  async function handleAddBtn(){
    const text = itemInput.value.trim();
    if (!text){ openModal('add'); return; }
    await commitAdd(text, addKind, selectedSub, null, null, false);
    itemInput.value='';
    updateAddBtnState();
    itemInput.focus();
  }
  itemInput.addEventListener('input', updateAddBtnState);
  itemInput.addEventListener('keydown', (e) => { if (e.key==='Enter' && itemInput.value.trim()) handleAddBtn(); });
  addBtn.addEventListener('click', handleAddBtn);

  function renderInlineSubPick(){
    subPick.innerHTML = categories.map(s =>
      `<button data-sub="${s.key}" class="${selectedSub===s.key?'selected':''}" style="background:${s.color}" title="${escapeHtml(s.label)}"></button>`
    ).join('');
    subPick.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => { selectedSub = btn.dataset.sub; renderInlineSubPick(); }));
  }
  kindToggle.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      addKind = btn.dataset.kind;
      kindToggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b===btn));
      subPick.style.display = addKind==='bucket' ? 'flex' : 'none';
      itemInput.placeholder = addKind==='bucket' ? 'Add to your bucket list…' : addKind==='inbox' ? 'Quick capture…' : 'Add a task…';
    });
  });

  // ---------- modal (add + edit) ----------
  function openModal(mode, item){
    modalMode = mode; editingId = item ? item.id : null;
    modalTitle.textContent = mode==='edit' ? 'Edit item' : 'New item';
    mAdd.textContent = mode==='edit' ? 'Save' : 'Add';
    mDelete.style.display = mode==='edit' ? 'inline-block' : 'none';
    managerOpen = false; catManager.style.display='none'; manageLink.textContent = 'manage categories';

    if (mode==='edit' && item){
      mText.value = item.text;
      mKind = item.kind;
      mSub = item.subcategory || (categories[0] ? categories[0].key : null);
      mPinned = !!item.pinned;
      if (item.deadline){ const { dateStr, timeStr } = isoToDateTimeParts(item.deadline); mDateDate.value = dateStr; mDateTime.value = timeStr; }
      else { mDateDate.value=''; mDateTime.value=''; }
      mNotes.value = item.notes || '';
      mAdd.disabled = false;
    } else {
      mText.value=''; mDateDate.value=''; mDateTime.value='';
      mKind = currentTab === 'bucket' ? 'bucket' : currentTab === 'inbox' ? 'inbox' : 'task';
      mPinned=false; mNotes.value='';
      mSub = categories[0] ? categories[0].key : null;
      mAdd.disabled = true;
    }
    mKindToggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.kind===mKind));
    mCatSection.style.display = mKind==='bucket' ? 'block' : 'none';
    mPinRow.style.display = mKind==='task' ? 'flex' : 'none';
    mPinPick.classList.toggle('on', mPinned);
    renderModalSubPick();
    modalOverlay.classList.add('show');
    setTimeout(() => mText.focus(), 50);
  }
  function closeModal(){ modalOverlay.classList.remove('show'); }
  modalClose.addEventListener('click', closeModal);
  mCancel.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key==='Escape' && modalOverlay.classList.contains('show')) closeModal(); });
  mText.addEventListener('input', () => { mAdd.disabled = mText.value.trim().length===0; });

  mKindToggle.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      mKind = btn.dataset.kind;
      mKindToggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b===btn));
      mCatSection.style.display = mKind==='bucket' ? 'block' : 'none';
      mPinRow.style.display = mKind==='task' ? 'flex' : 'none';
    });
  });
  mPinPick.addEventListener('click', () => { mPinned=!mPinned; mPinPick.classList.toggle('on', mPinned); });

  function renderModalSubPick(){
    mSubPick.innerHTML = categories.map(s =>
      `<button data-sub="${s.key}" class="${mSub===s.key?'selected':''}" style="background:${s.color}" title="${escapeHtml(s.label)}"></button>`
    ).join('');
    mSubPick.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => { mSub = btn.dataset.sub; renderModalSubPick(); }));
  }
  manageLink.addEventListener('click', () => {
    managerOpen = !managerOpen;
    catManager.style.display = managerOpen ? 'block' : 'none';
    manageLink.textContent = managerOpen ? 'hide category manager' : 'manage categories';
    if (managerOpen) renderCatManager();
  });
  function renderCatManager(){
    newCatColor = PALETTE.find(p => !categories.some(c => c.color===p)) || PALETTE[0];
    catManager.innerHTML = `
      ${categories.map(c => `<div class="cat-row" data-key="${c.key}">
        <span class="d" style="background:${c.color}"></span>
        <span class="cl">${escapeHtml(c.label)}</span>
        <button class="rm" data-rm="${c.key}" ${categories.length<=1?'style="opacity:.2;pointer-events:none;"':''} title="remove">×</button>
      </div>`).join('')}
      <div class="cat-add">
        <div class="cat-swatches" id="catSwatches">
          ${PALETTE.map(p => `<button data-color="${p}" class="${p===newCatColor?'sel':''}" style="background:${p}"></button>`).join('')}
        </div>
        <input type="text" id="newCatLabel" placeholder="New category…" maxlength="24" />
        <button class="cat-add-btn" id="catAddBtn" disabled>Add</button>
      </div>`;
    catManager.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => removeCategory(b.dataset.rm)));
    const swatches = catManager.querySelector('#catSwatches');
    const labelInput = catManager.querySelector('#newCatLabel');
    const addBtnCat = catManager.querySelector('#catAddBtn');
    swatches.querySelectorAll('button').forEach(sw => sw.addEventListener('click', () => {
      newCatColor = sw.dataset.color;
      swatches.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b===sw));
    }));
    labelInput.addEventListener('input', () => { addBtnCat.disabled = labelInput.value.trim().length===0; });
    addBtnCat.addEventListener('click', () => addCategory(labelInput.value.trim(), newCatColor));
    labelInput.addEventListener('keydown', (e) => { if (e.key==='Enter' && labelInput.value.trim()) addCategory(labelInput.value.trim(), newCatColor); });
  }
  async function addCategory(label, color){
    const key = uid('c');
    categories.push({ key, label, color });
    await saveCategories();
    mSub = key;
    renderModalSubPick(); renderInlineSubPick(); renderCatManager();
    scheduleSync();
  }
  async function removeCategory(key){
    if (categories.length <= 1) return;
    categories = categories.filter(c => c.key !== key);
    await saveCategories();
    if (mSub === key) mSub = categories[0].key;
    if (selectedSub === key) selectedSub = categories[0].key;
    if (activeSub === key) activeSub = 'all';
    renderModalSubPick(); renderInlineSubPick(); renderCatManager(); render();
  }
  mAdd.addEventListener('click', async () => {
    const text = mText.value.trim();
    if (!text) return;
    if (modalMode === 'edit') await commitEdit(editingId, text, mKind, mSub, mDateDate.value, mDateTime.value, mPinned, mNotes.value);
    else await commitAdd(text, mKind, mSub, mDateDate.value, mDateTime.value, mPinned, mNotes.value);
    closeModal();
  });
  mDelete.addEventListener('click', async () => {
    if (editingId) await deleteItem(editingId);
    closeModal();
  });

  (async function init(){
    await loadTheme();
    await loadCategories();
    renderInlineSubPick();
    renderModalSubPick();
    updateAddBtnState();
    await loadItems();
    await loadTombstones();
    render();
    if ('serviceWorker' in navigator){
      window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(()=>{}); });
    }
    initSync();
  })();
})();
