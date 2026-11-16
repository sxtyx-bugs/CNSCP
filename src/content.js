/**
 * WhatsApp Contacts & DM CSV Exporter | satuxcodes
 * Apple Liquid Glass Monochrome UX with Smart Filtering for WhatsApp Web.
 * 
 * @author satydev
 * @brand satuxcodes
 * @license MIT
 * 
 * Runs in the page's MAIN world on https://web.whatsapp.com to read
 * WhatsApp Web's internal in-memory store (chats, group metadata, contacts).
 * 100% private and client-side: all data is processed locally in your browser.
 */
(function () {
  'use strict';

  // Clear previous intervals if reloaded
  if (window.__SATUX_POLLER__) {
    clearInterval(window.__SATUX_POLLER__);
  }

  // Remove any legacy green buttons or old overlays immediately
  try {
    document.querySelectorAll('#wagx-launcher, .wagx-overlay, #satux-header-controls').forEach((el) => el.remove());
  } catch (_) {}

  const TAG = '[satuxcodes Exporter]';
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Exact 9 columns required in order
  const CSV_HEADERS = [
    'Country Code',
    'Country',
    'Phone Number',
    'Public Display Name',
    'Saved Name',
    'Source',
    'Is My Contact',
    'Is Business',
    'Last Chat',
  ];

  // ------------------------------------------------------------------
  // 1. WhatsApp Web Internal Store Access
  // ------------------------------------------------------------------
  function loaders() {
    const out = [];
    for (const key of ['require', 'importNamespace', 'importDefault']) {
      if (typeof window[key] === 'function') out.push([key, window[key]]);
    }
    return out;
  }

  const MISSING = new Set();
  function metaRequire(name) {
    for (const [key, fn] of loaders()) {
      try {
        const m = fn(name);
        if (m) return m;
      } catch (e) {
        if (!MISSING.has(key + ':' + name)) {
          MISSING.add(key + ':' + name);
        }
      }
    }
    return null;
  }

  function isCollection(c) {
    return !!(
      c &&
      typeof c === 'object' &&
      (typeof c.getModelsArray === 'function' || Array.isArray(c._models)) &&
      typeof c.get === 'function'
    );
  }

  function pickCollection(mod, names) {
    if (!mod) return null;
    for (const n of names) if (isCollection(mod[n])) return mod[n];
    if (isCollection(mod.default)) return mod.default;
    if (isCollection(mod)) return mod;
    return null;
  }

  function allModuleNames() {
    const dbg = metaRequire('__debug');
    const map = dbg && (dbg.modulesMap || dbg.modules);
    if (map && typeof map === 'object') return Object.keys(map);
    return [];
  }

  let webpackReq = null;
  function legacyFind(predicate) {
    try {
      const chunkName = Object.keys(window).find((k) => k.startsWith('webpackChunk'));
      if (!chunkName) return null;
      if (!webpackReq) {
        window[chunkName].push([[Symbol('satux')], {}, (r) => { webpackReq = r; }]);
      }
      if (!webpackReq) return null;
      for (const id of Object.keys(webpackReq.m)) {
        try {
          const mod = webpackReq(id);
          if (!mod) continue;
          if (predicate(mod)) return mod;
          if (mod.default && predicate(mod.default)) return mod.default;
        } catch (_) {}
      }
    } catch (_) {}
    return null;
  }

  function finishStore(S) {
    S.ApiContact = S.ApiContact || metaRequire('WAWebApiContact');
    S.MeUser = S.MeUser || metaRequire('WAWebUserPrefsMeUser');
    S.GroupQuery = S.GroupQuery || metaRequire('WAWebGroupQueryJob');
    return S;
  }

  let STORE = null;
  let lastScan = 0;
  function getStore() {
    if (STORE) return STORE;

    // Strategy 1: Combined collections module
    const col = metaRequire('WAWebCollections');
    let Chat = col && pickCollection(col, ['Chat', 'ChatCollection']);
    let Contact = col && pickCollection(col, ['Contact', 'ContactCollection']);
    let GroupMetadata = col && pickCollection(col, ['GroupMetadata', 'GroupMetadataCollection']);

    // Strategy 2: Individual collection modules
    if (!Chat) Chat = pickCollection(metaRequire('WAWebChatCollection'), ['ChatCollection', 'Chat']);
    if (!Contact) Contact = pickCollection(metaRequire('WAWebContactCollection'), ['ContactCollection', 'Contact']);
    if (!GroupMetadata) GroupMetadata = pickCollection(metaRequire('WAWebGroupMetadataCollection'), ['GroupMetadataCollection', 'GroupMetadata']);

    // Strategy 3: Scan module registry
    if ((!Chat || !Contact || !GroupMetadata) && Date.now() - lastScan > 10000) {
      lastScan = Date.now();
      const names = allModuleNames();
      if (names.length) {
        const candidates = names.filter((n) => /Collection|Store/i.test(n));
        for (const n of candidates) {
          const m = metaRequire(n);
          if (!m || typeof m !== 'object') continue;
          if (!Chat && (isCollection(m.Chat) || isCollection(m.ChatCollection))) {
            Chat = isCollection(m.Chat) ? m.Chat : m.ChatCollection;
          }
          if (!Contact && (isCollection(m.Contact) || isCollection(m.ContactCollection))) {
            Contact = isCollection(m.Contact) ? m.Contact : m.ContactCollection;
          }
          if (!GroupMetadata && (isCollection(m.GroupMetadata) || isCollection(m.GroupMetadataCollection))) {
            GroupMetadata = isCollection(m.GroupMetadata) ? m.GroupMetadata : m.GroupMetadataCollection;
          }
          if (Chat && Contact && GroupMetadata) break;
        }
      }
    }

    if (Chat && Contact && GroupMetadata) {
      STORE = finishStore({ Chat, Contact, GroupMetadata });
      return STORE;
    }

    // Strategy 4: Legacy webpack
    const legacy = legacyFind((m) => m && m.Chat && m.Contact && m.GroupMetadata);
    if (legacy) {
      STORE = finishStore({ Chat: legacy.Chat, Contact: legacy.Contact, GroupMetadata: legacy.GroupMetadata, Conn: legacy.Conn });
      return STORE;
    }
    return null;
  }

  function modelsOf(collection) {
    if (!collection) return [];
    if (typeof collection.getModelsArray === 'function') return collection.getModelsArray();
    if (Array.isArray(collection._models)) return collection._models;
    if (Array.isArray(collection.models)) return collection.models;
    if (Array.isArray(collection)) return collection;
    if (typeof collection.toArray === 'function') return collection.toArray();
    return [];
  }

  function widStr(wid) {
    if (!wid) return '';
    if (typeof wid === 'string') return wid;
    return wid._serialized || (typeof wid.toString === 'function' ? wid.toString() : '');
  }

  function widServer(wid) {
    if (!wid) return '';
    if (typeof wid === 'string') return wid.split('@')[1] || '';
    return wid.server || widStr(wid).split('@')[1] || '';
  }

  function widUser(wid) {
    if (!wid) return '';
    if (typeof wid === 'string') return wid.split('@')[0].split(':')[0];
    return String(wid.user || widStr(wid).split('@')[0]).split(':')[0];
  }

  function isGroupChat(chat) {
    try {
      return !!(chat && (chat.isGroup || widServer(chat.id) === 'g.us'));
    } catch (_) {
      return false;
    }
  }

  function chatTitle(chat) {
    if (!chat) return '';
    return (
      chat.formattedTitle ||
      chat.name ||
      (chat.groupMetadata && chat.groupMetadata.subject) ||
      (chat.contact && (chat.contact.name || chat.contact.formattedName)) ||
      widUser(chat.id)
    );
  }

  function getMyNumber(S) {
    try {
      if (S && S.MeUser) {
        const me = (S.MeUser.getMaybeMePnUser && S.MeUser.getMaybeMePnUser()) ||
                   (S.MeUser.getMaybeMeUser && S.MeUser.getMaybeMeUser());
        if (me) return widUser(me).replace(/\D/g, '');
      }
      if (S && S.Conn && S.Conn.wid) return widUser(S.Conn.wid).replace(/\D/g, '');
    } catch (_) {}
    return '';
  }

  async function waitForStore(timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const S = getStore();
      if (S && modelsOf(S.Chat).length > 0) return S;
      await sleep(500);
    }
    return getStore();
  }

  // ------------------------------------------------------------------
  // 2. High-Precision Contact Resolution & Indexing
  // ------------------------------------------------------------------
  const PERSON_SERVERS = new Set(['c.us', 's.whatsapp.net', 'lid']);

  function isPersonChat(chat) {
    try {
      return !!chat && !isGroupChat(chat) && PERSON_SERVERS.has(widServer(chat.id)) && !chat.isNewsletter && !chat.isBroadcast;
    } catch (_) {
      return false;
    }
  }

  function isSavedPerson(ct) {
    try {
      return !!ct && ct.isMyContact && !ct.isGroup && PERSON_SERVERS.has(widServer(ct.id));
    } catch (_) {
      return false;
    }
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function listPersonChats(S) {
    return modelsOf(S.Chat).filter(isPersonChat);
  }

  function listSavedContacts(S) {
    return modelsOf(S.Contact).filter(isSavedPerson);
  }

  function getContact(S, wid) {
    if (!wid) return null;
    try {
      return S.Contact.get(wid) || S.Contact.get(widStr(wid)) || null;
    } catch (_) {
      return null;
    }
  }

  // Comprehensive index of all saved phonebook contacts
  // Maps LIDs, Phone WIDs, digits, and synced address book names
  function buildSavedContactRegistry(S) {
    const savedDigitsSet = new Set();
    const savedWidsSet = new Set();
    const savedNamesMap = new Map();
    const lidToPhoneMap = new Map();

    const allContacts = modelsOf(S.Contact);
    for (const c of allContacts) {
      if (!c || c.isGroup) continue;

      const idStr = widStr(c.id);
      const digits = widUser(c.id).replace(/\D/g, '');
      const lidStr = c.lid ? widStr(c.lid) : '';
      const pnStr = c.phoneNumber ? widStr(c.phoneNumber) : '';
      const pnDigits = c.phoneNumber ? widUser(c.phoneNumber).replace(/\D/g, '') : '';

      if (lidStr && digits) lidToPhoneMap.set(lidStr, digits);
      if (lidStr && pnDigits) lidToPhoneMap.set(lidStr, pnDigits);

      const name = (c.name || '').trim();
      const hasSavedName = !!(name && !/^\+?[\d\s\-()]+$/.test(name));
      const isSaved = !!(c.isMyContact || c.isAddressBookContact || c.isContact || hasSavedName);

      if (isSaved) {
        if (digits) {
          savedDigitsSet.add(digits);
          if (hasSavedName) savedNamesMap.set(digits, name);
        }
        if (pnDigits) {
          savedDigitsSet.add(pnDigits);
          if (hasSavedName) savedNamesMap.set(pnDigits, name);
        }
        if (idStr) savedWidsSet.add(idStr);
        if (lidStr) savedWidsSet.add(lidStr);
        if (pnStr) savedWidsSet.add(pnStr);
      }
    }

    // Also scan all chats: some chats have address book names attached directly
    const allChats = modelsOf(S.Chat);
    for (const ch of allChats) {
      if (!ch || isGroupChat(ch)) continue;
      const ct = ch.contact;
      const chName = (ch.name || '').trim();
      const ctName = (ct && ct.name ? ct.name : '').trim();
      const finalName = ctName || chName;

      const hasSavedName = !!(finalName && !/^\+?[\d\s\-()]+$/.test(finalName));
      const isSaved = !!(
        ch.isMyContact ||
        (ct && (ct.isMyContact || ct.isAddressBookContact || ct.isContact)) ||
        hasSavedName
      );

      const digits = widUser(ch.id).replace(/\D/g, '');
      const idStr = widStr(ch.id);

      if (isSaved) {
        if (digits) {
          savedDigitsSet.add(digits);
          if (hasSavedName) savedNamesMap.set(digits, finalName);
        }
        if (idStr) savedWidsSet.add(idStr);
        if (ct) {
          const ctId = widStr(ct.id);
          const ctDigits = widUser(ct.id).replace(/\D/g, '');
          if (ctId) savedWidsSet.add(ctId);
          if (ctDigits) {
            savedDigitsSet.add(ctDigits);
            if (hasSavedName) savedNamesMap.set(ctDigits, finalName);
          }
        }
      }
    }

    return { savedDigitsSet, savedWidsSet, savedNamesMap, lidToPhoneMap };
  }

  // Resolves contact details with 100% accuracy for phone numbers, saved names, and isMyContact
  function resolveContactDetails(S, chatOrContact, registry) {
    const isChat = !!(chatOrContact && chatOrContact.isGroup !== undefined);
    const chat = isChat ? chatOrContact : null;
    const directContact = isChat ? chat.contact : chatOrContact;
    const wid = (chat && chat.id) || (directContact && directContact.id) || chatOrContact.id || chatOrContact;

    const idStr = widStr(wid);
    const server = widServer(wid);
    const user = widUser(wid);

    // 1. Resolve actual Phone Number
    let phoneDigits = '';
    if (server === 'c.us' || server === 's.whatsapp.net') {
      phoneDigits = user.replace(/\D/g, '');
    } else if (directContact && directContact.phoneNumber) {
      phoneDigits = widUser(directContact.phoneNumber).replace(/\D/g, '');
    } else if (chatOrContact.phoneNumber) {
      phoneDigits = widUser(chatOrContact.phoneNumber).replace(/\D/g, '');
    } else if (registry && registry.lidToPhoneMap.has(idStr)) {
      phoneDigits = registry.lidToPhoneMap.get(idStr);
    } else if (S && S.ApiContact && typeof S.ApiContact.getPhoneNumber === 'function') {
      try {
        const pn = S.ApiContact.getPhoneNumber(wid);
        if (pn) phoneDigits = widUser(pn).replace(/\D/g, '');
      } catch (_) {}
    }

    if (!phoneDigits && server !== 'lid') {
      phoneDigits = user.replace(/\D/g, '');
    }

    // 2. Fetch full contact model if available
    let contact = directContact;
    if (!contact && S) {
      if (phoneDigits) contact = getContact(S, phoneDigits + '@c.us');
      if (!contact && wid) contact = getContact(S, wid);
    }

    // 3. Resolve Saved Name (from Address Book)
    let savedName = '';
    if (phoneDigits && registry && registry.savedNamesMap.has(phoneDigits)) {
      savedName = registry.savedNamesMap.get(phoneDigits);
    }
    if (!savedName && contact && contact.name && typeof contact.name === 'string') {
      savedName = contact.name.trim();
    }
    if (!savedName && chat && chat.name && typeof chat.name === 'string') {
      savedName = chat.name.trim();
    }
    // Filter out numbers disguised as names (e.g. +91 98765 43210)
    if (savedName && /^\+?[\d\s\-()]+$/.test(savedName)) {
      savedName = '';
    }

    // 4. Resolve Public WhatsApp Profile Name (Pushname)
    let publicName = (
      (contact && (contact.pushname || contact.verifiedName || contact.notifyName)) ||
      (chat && chat.contact && (chat.contact.pushname || chat.contact.verifiedName || chat.contact.notifyName)) ||
      chatOrContact.pushname ||
      chatOrContact.notifyName ||
      ''
    ).trim();

    // 5. Accurate isMyContact detection:
    // A contact is in your phonebook if:
    // - Found in savedDigitsSet or savedWidsSet
    // - OR has contact.isMyContact / isAddressBookContact / isContact
    // - OR has a real saved address book name!
    const isSaved = !!(
      (phoneDigits && registry && registry.savedDigitsSet.has(phoneDigits)) ||
      (idStr && registry && registry.savedWidsSet.has(idStr)) ||
      (contact && (contact.isMyContact || contact.isAddressBookContact || contact.isContact)) ||
      (chat && (chat.isMyContact || (chat.contact && (chat.contact.isMyContact || chat.contact.isAddressBookContact)))) ||
      (savedName && savedName.length > 0)
    );

    const isBusiness = !!(
      (contact && (contact.isBusiness || contact.isEnterprise)) ||
      (chat && chat.contact && (chat.contact.isBusiness || chat.contact.isEnterprise))
    );

    const { code, country } = phoneDigits
      ? (window.WAGX_COUNTRIES ? window.WAGX_COUNTRIES.lookup(phoneDigits) : { code: '', country: '' })
      : { code: '', country: 'Hidden' };

    return {
      digits: phoneDigits,
      savedName,
      publicName,
      isMyContact: isSaved,
      isBusiness,
      countryCode: code ? String(code) : '',
      country,
    };
  }

  async function loadGroupMetadata(S, chat) {
    const id = chat.id;
    let md = null;
    try { md = S.GroupMetadata.get(id); } catch (_) {}
    if (md && modelsOf(md.participants).length) return md;

    try {
      if (typeof S.GroupMetadata.find === 'function') md = await S.GroupMetadata.find(id);
    } catch (_) {}
    if (md && modelsOf(md.participants).length) return md;

    try {
      if (S.GroupQuery && typeof S.GroupQuery.queryAndUpdateGroupMetadataById === 'function') {
        await S.GroupQuery.queryAndUpdateGroupMetadataById({ id });
        md = S.GroupMetadata.get(id);
      }
    } catch (_) {}

    if (!md && chat.groupMetadata) md = chat.groupMetadata;
    return md;
  }

  function getCurrentOpenGroup(S) {
    if (!S) return null;
    try {
      if (typeof S.Chat.getActive === 'function') {
        const a = S.Chat.getActive();
        if (a && isGroupChat(a)) return a;
      }
    } catch (_) {}
    try {
      if (S.Chat.active && isGroupChat(S.Chat.active)) return S.Chat.active;
    } catch (_) {}
    try {
      const models = modelsOf(S.Chat);
      for (const m of models) {
        if (m && (m.active || m.isSelected || m.__x_active) && isGroupChat(m)) return m;
      }
    } catch (_) {}
    try {
      const mainHeader = document.querySelector('#main header');
      if (mainHeader) {
        const titleEl = mainHeader.querySelector('span[title], div[role="button"] span, h2, [dir="auto"]');
        const titleText = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '').trim() : '';
        if (titleText) {
          const match = modelsOf(S.Chat).find((c) => isGroupChat(c) && chatTitle(c) === titleText);
          if (match) return match;
        }
      }
    } catch (_) {}
    return null;
  }

  // ------------------------------------------------------------------
  // 3. Smart Extraction & Filtering Engine
  // ------------------------------------------------------------------
  async function performFilteredExtraction(S, opts) {
    const registry = buildSavedContactRegistry(S);
    const myNumber = opts.excludeMe ? getMyNumber(S) : '';
    const byKey = new Map();

    const addEntry = (item, sourceName, ts = 0) => {
      const data = resolveContactDetails(S, item, registry);

      // Exclude my own number
      if (myNumber && data.digits === myNumber) return;

      // Exclude saved contacts if requested (Leaves only buyer/customer leads)
      if (opts.excludeSaved && data.isMyContact) return;

      // Exclude business accounts if requested
      if (opts.excludeBusiness && data.isBusiness) return;

      const key = data.digits || widStr(item.id || item);
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.sources.includes(sourceName)) existing.sources.push(sourceName);
        existing.ts = Math.max(existing.ts, ts || 0);
        if (!existing.savedName && data.savedName) existing.savedName = data.savedName;
        if (data.isMyContact) existing.isMyContact = true;
        return;
      }

      byKey.set(key, { ...data, sources: [sourceName], ts: ts || 0 });
    };

    // 1. Process 1-on-1 Chats (Customer DMs & conversations)
    if (opts.includeChats || opts.includeLeads) {
      const chats = listPersonChats(S);
      for (const chat of chats) {
        try {
          addEntry(chat, 'Chat', Number(chat.t) || 0);
        } catch (e) { warn('chat extract err', e); }
      }
    }

    // 2. Process Saved Phonebook Contacts
    if (opts.includeSaved) {
      const saved = listSavedContacts(S);
      for (const ct of saved) {
        try {
          addEntry(ct, 'Saved contact', 0);
        } catch (e) { warn('saved contact err', e); }
      }
    }

    // 3. Process Active Group Members
    if (opts.includeGroup) {
      const activeGroup = getCurrentOpenGroup(S);
      if (activeGroup) {
        const md = await loadGroupMetadata(S, activeGroup);
        const participants = md ? modelsOf(md.participants) : [];
        const groupName = (md && md.subject) || chatTitle(activeGroup) || 'Group';
        for (const p of participants) {
          try {
            addEntry(p, `Group: ${groupName}`, 0);
          } catch (e) { warn('group member err', e); }
        }
      }
    }

    const boolStr = (v) => (v ? 'True' : 'False');
    const rows = [...byKey.values()].map((e) => [
      e.countryCode ? Number(e.countryCode) : '',
      e.country,
      e.digits ? '+' + e.digits : 'Hidden (privacy)',
      e.publicName,
      e.savedName,
      e.sources.join(', '),
      boolStr(e.isMyContact),
      boolStr(e.isBusiness),
      fmtDate(e.ts),
    ]);

    // Sort: most recent conversations first, then alphabetically
    rows.sort((a, b) => (b[8] || '').localeCompare(a[8] || '') || (a[4] || a[3]).localeCompare(b[4] || b[3]));
    return rows;
  }

  // ------------------------------------------------------------------
  // 4. File Downloads (Excel .xlsx & CSV with UTF-8 BOM)
  // ------------------------------------------------------------------
  let currentFormat = 'xlsx';
  try {
    const saved = localStorage.getItem('satux_export_format');
    if (saved === 'csv' || saved === 'xlsx') currentFormat = saved;
  } catch (_) {}

  function getTodayDateStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function toCSVBlob(rows) {
    const csvCell = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    return new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8' });
  }

  function triggerDownload(rows, baseName, format) {
    const today = getTodayDateStr();
    const isXlsx = format === 'xlsx' && typeof window.WAGX_XLSX !== 'undefined' && window.WAGX_XLSX.build;
    const ext = isXlsx ? 'xlsx' : 'csv';
    const filename = `${baseName}-satuxcodes-${today}.${ext}`;
    const allRows = [CSV_HEADERS, ...rows];

    if (isXlsx) {
      const widths = [14, 22, 20, 28, 24, 24, 14, 12, 18];
      const blob = window.WAGX_XLSX.build([{ name: 'Contacts', rows: allRows, widths }]);
      downloadBlob(blob, filename);
    } else {
      const blob = toCSVBlob(allRows);
      downloadBlob(blob, filename);
    }

    return { filename, count: rows.length, ext: ext.toUpperCase() };
  }

  // ------------------------------------------------------------------
  // 5. Apple Liquid Glass Monochrome UI & Pop-Up Filter Modal
  // ------------------------------------------------------------------
  let toastTimer = null;
  function showToast(message, isWarning = false) {
    let toast = document.getElementById('satux-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'satux-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = isWarning ? 'satux-toast-warn' : 'satux-toast-success';
    toast.style.display = 'flex';
    void toast.offsetWidth;
    toast.classList.add('satux-toast-visible');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('satux-toast-visible');
      setTimeout(() => {
        if (!toast.classList.contains('satux-toast-visible')) toast.style.display = 'none';
      }, 300);
    }, 2800);
  }

  function ensureStyles() {
    if (document.getElementById('satux-injected-styles')) return;
    const style = document.createElement('style');
    style.id = 'satux-injected-styles';
    style.textContent = `
      /* Header Capsule Button */
      #satux-header-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 12px;
        border-radius: 14px;
        background: linear-gradient(135deg, rgba(30, 41, 49, 0.78) 0%, rgba(18, 26, 31, 0.9) 100%);
        color: #F5F5F7;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.18);
        font-family: inherit;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        outline: none;
        white-space: nowrap;
        flex-shrink: 0;
        margin: 0 6px;
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        transition: transform 0.12s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease;
        z-index: 999;
      }
      body:not(.dark) #satux-header-btn,
      html:not(.dark) #satux-header-btn {
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.88) 0%, rgba(240, 242, 245, 0.95) 100%);
        color: #1D1D1F;
        border-color: rgba(0, 0, 0, 0.12);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.8);
      }
      #satux-header-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
      }
      .satux-badge-filter {
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        padding: 1px 5px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.14);
        color: #F5F5F7;
      }
      body:not(.dark) .satux-badge-filter {
        background: rgba(0, 0, 0, 0.08);
        color: #1D1D1F;
      }

      /* Floating Capsule (Pinned at bottom-right of viewport - impossible to be blocked) */
      #satux-floating-pill {
        position: fixed !important;
        bottom: 28px !important;
        right: 28px !important;
        z-index: 9999999 !important;
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 10px 18px;
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(30, 41, 49, 0.82) 0%, rgba(18, 26, 31, 0.94) 100%);
        color: #F5F5F7;
        border: 1px solid rgba(255, 255, 255, 0.16);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.22);
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        backdrop-filter: blur(28px) saturate(190%);
        -webkit-backdrop-filter: blur(28px) saturate(190%);
        transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease;
      }
      body:not(.dark) #satux-floating-pill,
      html:not(.dark) #satux-floating-pill {
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.92) 0%, rgba(245, 246, 248, 0.96) 100%);
        color: #1D1D1F;
        border-color: rgba(0, 0, 0, 0.1);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.8);
      }
      #satux-floating-pill:hover {
        transform: translateY(-2px);
        box-shadow: 0 16px 42px rgba(0, 0, 0, 0.55);
      }

      /* Apple Liquid Glass Filter Modal Overlay */
      #satux-modal-overlay {
        position: fixed !important;
        inset: 0 !important;
        z-index: 10000000 !important;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(11, 20, 26, 0.6);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        animation: satuxFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      @keyframes satuxFadeIn {
        from { opacity: 0; transform: scale(0.97); }
        to { opacity: 1; transform: scale(1); }
      }
      .satux-filter-card {
        width: 480px;
        max-width: calc(100vw - 32px);
        border-radius: 22px;
        background: linear-gradient(135deg, rgba(26, 36, 43, 0.88) 0%, rgba(18, 26, 31, 0.96) 100%);
        color: #F5F5F7;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 24px 72px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.18);
        backdrop-filter: blur(36px) saturate(200%);
        -webkit-backdrop-filter: blur(36px) saturate(200%);
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        box-sizing: border-box;
      }
      body:not(.dark) .satux-filter-card,
      html:not(.dark) .satux-filter-card {
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.92) 0%, rgba(245, 246, 248, 0.97) 100%);
        color: #1D1D1F;
        border-color: rgba(0, 0, 0, 0.08);
        box-shadow: 0 24px 72px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.8);
      }
      .satux-modal-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
      }
      .satux-modal-title {
        font-size: 16px;
        font-weight: 700;
        letter-spacing: -0.3px;
      }
      .satux-modal-subtitle {
        font-size: 12px;
        color: #8696A0;
        margin-top: 3px;
      }
      .satux-modal-close {
        background: transparent;
        border: none;
        color: #8696A0;
        font-size: 24px;
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
        transition: color 0.15s ease;
      }
      .satux-modal-close:hover {
        color: #F5F5F7;
      }
      body:not(.dark) .satux-modal-close:hover {
        color: #1D1D1F;
      }

      /* Liquid Glass Presets Pills */
      .satux-presets-bar {
        display: flex;
        gap: 7px;
      }
      .satux-preset-btn {
        flex: 1;
        padding: 8px 6px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.04);
        color: inherit;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        text-align: center;
        transition: all 0.15s ease;
      }
      body:not(.dark) .satux-preset-btn {
        border-color: rgba(0, 0, 0, 0.08);
        background: rgba(0, 0, 0, 0.03);
      }
      .satux-preset-btn:hover {
        background: rgba(255, 255, 255, 0.08);
      }
      body:not(.dark) .satux-preset-btn:hover {
        background: rgba(0, 0, 0, 0.06);
      }
      .satux-preset-btn.satux-active {
        background: #F5F5F7;
        color: #121A1F;
        border-color: #F5F5F7;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
      }
      body:not(.dark) .satux-preset-btn.satux-active {
        background: #1D1D1F;
        color: #FFFFFF;
        border-color: #1D1D1F;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
      }

      /* Sections & Options */
      .satux-section-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: #8696A0;
      }
      .satux-options-list {
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .satux-option-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 9px 13px;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
        cursor: pointer;
        transition: background 0.12s ease, border-color 0.12s ease;
      }
      body:not(.dark) .satux-option-item {
        border-color: rgba(0, 0, 0, 0.06);
        background: rgba(0, 0, 0, 0.02);
      }
      .satux-option-item:hover {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(255, 255, 255, 0.14);
      }
      body:not(.dark) .satux-option-item:hover {
        background: rgba(0, 0, 0, 0.04);
        border-color: rgba(0, 0, 0, 0.12);
      }
      .satux-opt-left {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .satux-opt-left input[type="checkbox"] {
        width: 16px;
        height: 16px;
        accent-color: #F5F5F7;
        margin: 0;
      }
      body:not(.dark) .satux-opt-left input[type="checkbox"] {
        accent-color: #1D1D1F;
      }
      .satux-opt-title {
        font-size: 13px;
        font-weight: 600;
      }
      .satux-opt-desc {
        font-size: 11px;
        color: #8696A0;
      }
      .satux-opt-count {
        font-size: 11px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.08);
        color: inherit;
        white-space: nowrap;
      }
      body:not(.dark) .satux-opt-count {
        background: rgba(0, 0, 0, 0.06);
      }

      /* Liquid Glass Format Segmented Control */
      .satux-fmt-switch {
        display: flex;
        gap: 8px;
      }
      .satux-fmt-option {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 9px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.04);
        cursor: pointer;
        font-size: 12.5px;
        font-weight: 600;
        transition: all 0.15s ease;
      }
      body:not(.dark) .satux-fmt-option {
        border-color: rgba(0, 0, 0, 0.08);
        background: rgba(0, 0, 0, 0.03);
      }
      .satux-fmt-option.satux-selected {
        background: #F5F5F7;
        color: #121A1F;
        border-color: #F5F5F7;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
      }
      body:not(.dark) .satux-fmt-option.satux-selected {
        background: #1D1D1F;
        color: #FFFFFF;
        border-color: #1D1D1F;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
      }

      /* Modal Footer & High-Contrast Download Button */
      .satux-modal-footer {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: 6px;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
      }
      body:not(.dark) .satux-modal-footer {
        border-color: rgba(0, 0, 0, 0.08);
      }
      .satux-download-action-btn {
        width: 100%;
        padding: 12px;
        border-radius: 14px;
        background: #F5F5F7;
        color: #121A1F;
        border: none;
        font-size: 13.5px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
        transition: all 0.15s ease;
      }
      body:not(.dark) .satux-download-action-btn {
        background: #1D1D1F;
        color: #FFFFFF;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
      }
      .satux-download-action-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
      }
      .satux-download-action-btn:disabled {
        opacity: 0.6;
        cursor: wait;
        transform: none !important;
      }
      .satux-footer-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        color: #8696A0;
      }
      .satux-footer-link {
        color: inherit;
        text-decoration: none;
        font-weight: 600;
      }
      .satux-footer-link:hover {
        text-decoration: underline;
      }

      /* Liquid Glass Floating Toast */
      #satux-toast {
        position: fixed !important;
        bottom: 28px !important;
        right: 28px !important;
        z-index: 10000001 !important;
        background: linear-gradient(135deg, rgba(30, 41, 49, 0.9) 0%, rgba(18, 26, 31, 0.96) 100%);
        color: #F5F5F7;
        border: 1px solid rgba(255, 255, 255, 0.18);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.22);
        backdrop-filter: blur(28px) saturate(190%);
        -webkit-backdrop-filter: blur(28px) saturate(190%);
        padding: 10px 20px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 600;
        display: none;
        align-items: center;
        gap: 7px;
        pointer-events: none;
        opacity: 0;
        transform: translateY(12px) scale(0.96);
        transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }
      body:not(.dark) #satux-toast,
      html:not(.dark) #satux-toast {
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.92) 0%, rgba(245, 246, 248, 0.97) 100%);
        color: #1D1D1F;
        border-color: rgba(0, 0, 0, 0.1);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.8);
      }
      #satux-toast.satux-toast-warn {
        background: rgba(45, 25, 20, 0.95);
        border-color: rgba(255, 120, 80, 0.3);
        color: #FFD0C0;
      }
      #satux-toast.satux-toast-visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // Opens the comprehensive Filter & Export Pop-Up Modal
  async function openFilterModal() {
    let overlay = document.getElementById('satux-modal-overlay');
    if (overlay) return;

    ensureStyles();

    overlay = document.createElement('div');
    overlay.id = 'satux-modal-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeFilterModal();
    });

    const card = document.createElement('div');
    card.className = 'satux-filter-card';

    // Header
    const header = document.createElement('div');
    header.className = 'satux-modal-header';
    header.innerHTML = `
      <div>
        <div class="satux-modal-title">⚡ WhatsApp Contacts &amp; Leads Exporter</div>
        <div class="satux-modal-subtitle">Filter what to include or exclude, then download directly.</div>
      </div>
      <button class="satux-modal-close" title="Close">×</button>
    `;
    header.querySelector('.satux-modal-close').addEventListener('click', closeFilterModal);
    card.appendChild(header);

    // Quick 1-Click Presets Bar
    const presetsBar = document.createElement('div');
    presetsBar.className = 'satux-presets-bar';
    presetsBar.innerHTML = `
      <button class="satux-preset-btn satux-active" data-preset="leads">⚡ Customer Leads</button>
      <button class="satux-preset-btn" data-preset="all">👥 All Contacts &amp; DMs</button>
      <button class="satux-preset-btn" data-preset="group">💬 Open Group</button>
    `;
    card.appendChild(presetsBar);

    // Section 1: What to Include
    const sec1Label = document.createElement('div');
    sec1Label.className = 'satux-section-label';
    sec1Label.textContent = '1. Select What to Include';
    card.appendChild(sec1Label);

    const list1 = document.createElement('div');
    list1.className = 'satux-options-list';
    list1.innerHTML = `
      <label class="satux-option-item">
        <div class="satux-opt-left">
          <input type="checkbox" id="satux-chk-leads" checked>
          <div>
            <div class="satux-opt-title">Customer Inquiries &amp; 1-on-1 DMs</div>
            <div class="satux-opt-desc">Chats from buyers &amp; customers who messaged you</div>
          </div>
        </div>
        <span class="satux-opt-count" id="satux-cnt-leads">…</span>
      </label>
      <label class="satux-option-item">
        <div class="satux-opt-left">
          <input type="checkbox" id="satux-chk-saved">
          <div>
            <div class="satux-opt-title">Saved Phonebook Contacts</div>
            <div class="satux-opt-desc">All your synced phone contacts who use WhatsApp</div>
          </div>
        </div>
        <span class="satux-opt-count" id="satux-cnt-saved">…</span>
      </label>
      <label class="satux-option-item">
        <div class="satux-opt-left">
          <input type="checkbox" id="satux-chk-group">
          <div>
            <div class="satux-opt-title">Current Open Group Members</div>
            <div class="satux-opt-desc" id="satux-desc-group">All members in active group chat</div>
          </div>
        </div>
        <span class="satux-opt-count" id="satux-cnt-group">…</span>
      </label>
    `;
    card.appendChild(list1);

    // Section 2: What to Exclude (The core filters!)
    const sec2Label = document.createElement('div');
    sec2Label.className = 'satux-section-label';
    sec2Label.textContent = '2. Filter & Exclude Options';
    card.appendChild(sec2Label);

    const list2 = document.createElement('div');
    list2.className = 'satux-options-list';
    list2.innerHTML = `
      <label class="satux-option-item">
        <div class="satux-opt-left">
          <input type="checkbox" id="satux-chk-exclude-saved" checked>
          <div>
            <div class="satux-opt-title">Exclude Saved Phone Contacts</div>
            <div class="satux-opt-desc">Strictly leaves out friends &amp; family so only buyer leads export</div>
          </div>
        </div>
        <span class="satux-opt-count">Essential</span>
      </label>
      <label class="satux-option-item">
        <div class="satux-opt-left">
          <input type="checkbox" id="satux-chk-exclude-me" checked>
          <div>
            <div class="satux-opt-title">Exclude My Own Number</div>
          </div>
        </div>
      </label>
      <label class="satux-option-item">
        <div class="satux-opt-left">
          <input type="checkbox" id="satux-chk-exclude-biz">
          <div>
            <div class="satux-opt-title">Exclude Business / Automated Accounts</div>
          </div>
        </div>
      </label>
    `;
    card.appendChild(list2);

    // Section 3: Format Selector
    const sec3Label = document.createElement('div');
    sec3Label.className = 'satux-section-label';
    sec3Label.textContent = '3. File Format';
    card.appendChild(sec3Label);

    const fmtSwitch = document.createElement('div');
    fmtSwitch.className = 'satux-fmt-switch';
    fmtSwitch.innerHTML = `
      <div class="satux-fmt-option ${currentFormat === 'xlsx' ? 'satux-selected' : ''}" data-fmt="xlsx">
        <span>📊</span> Excel (.xlsx)
      </div>
      <div class="satux-fmt-option ${currentFormat === 'csv' ? 'satux-selected' : ''}" data-fmt="csv">
        <span>📄</span> CSV (.csv)
      </div>
    `;
    card.appendChild(fmtSwitch);

    // Section 4: Footer & Action Button
    const footer = document.createElement('div');
    footer.className = 'satux-modal-footer';
    footer.innerHTML = `
      <button class="satux-download-action-btn" id="satux-btn-download-now">
        <span>⬇</span> <span id="satux-lbl-btn-download">Download Customer Leads (Excel (.xlsx))</span>
      </button>
      <div class="satux-footer-row">
        <span>100% Local &amp; Private</span>
        <a class="satux-footer-link" href="https://github.com/sxtyx-bugs" target="_blank" rel="noopener noreferrer">by satydev • satuxcodes</a>
      </div>
    `;
    card.appendChild(footer);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Wire Presets
    const chkLeads = card.querySelector('#satux-chk-leads');
    const chkSaved = card.querySelector('#satux-chk-saved');
    const chkGroup = card.querySelector('#satux-chk-group');
    const chkExcludeSaved = card.querySelector('#satux-chk-exclude-saved');
    const chkExcludeMe = card.querySelector('#satux-chk-exclude-me');
    const chkExcludeBiz = card.querySelector('#satux-chk-exclude-biz');
    const dlBtnLbl = card.querySelector('#satux-lbl-btn-download');

    function applyPreset(preset) {
      presetsBar.querySelectorAll('.satux-preset-btn').forEach((b) => {
        b.classList.toggle('satux-active', b.getAttribute('data-preset') === preset);
      });

      if (preset === 'leads') {
        chkLeads.checked = true;
        chkSaved.checked = false;
        chkGroup.checked = false;
        chkExcludeSaved.checked = true;
        chkExcludeMe.checked = true;
      } else if (preset === 'all') {
        chkLeads.checked = true;
        chkSaved.checked = true;
        chkGroup.checked = false;
        chkExcludeSaved.checked = false;
        chkExcludeMe.checked = true;
      } else if (preset === 'group') {
        chkLeads.checked = false;
        chkSaved.checked = false;
        chkGroup.checked = true;
        chkExcludeSaved.checked = false;
        chkExcludeMe.checked = true;
      }
      updateDownloadLabel();
    }

    presetsBar.querySelectorAll('.satux-preset-btn').forEach((b) => {
      b.addEventListener('click', () => applyPreset(b.getAttribute('data-preset')));
    });

    // Wire Format Switch
    fmtSwitch.querySelectorAll('.satux-fmt-option').forEach((opt) => {
      opt.addEventListener('click', () => {
        fmtSwitch.querySelectorAll('.satux-fmt-option').forEach((o) => o.classList.remove('satux-selected'));
        opt.classList.add('satux-selected');
        currentFormat = opt.getAttribute('data-fmt');
        try { localStorage.setItem('satux_export_format', currentFormat); } catch (_) {}
        updateDownloadLabel();
      });
    });

    function updateDownloadLabel() {
      const fmtStr = currentFormat === 'xlsx' ? 'Excel (.xlsx)' : 'CSV (.csv)';
      let target = 'Contacts';
      if (chkLeads.checked && chkExcludeSaved.checked && !chkSaved.checked) {
        target = 'Customer Leads';
      } else if (chkGroup.checked && !chkLeads.checked && !chkSaved.checked) {
        target = 'Group Members';
      }
      dlBtnLbl.textContent = `Download ${target} (${fmtStr})`;
    }

    [chkLeads, chkSaved, chkGroup, chkExcludeSaved, chkExcludeMe, chkExcludeBiz].forEach((c) => {
      c.addEventListener('change', updateDownloadLabel);
    });

    // Wire Download Action
    card.querySelector('#satux-btn-download-now').addEventListener('click', async () => {
      const dlBtn = card.querySelector('#satux-btn-download-now');
      dlBtn.disabled = true;
      dlBtn.textContent = 'Extracting and building file…';

      try {
        const S = await waitForStore(15000);
        if (!S) {
          showToast('⚠️ WhatsApp Web is still loading data. Please wait.', true);
          return;
        }

        const filterOpts = {
          includeChats: chkLeads.checked,
          includeLeads: chkLeads.checked,
          includeSaved: chkSaved.checked,
          includeGroup: chkGroup.checked,
          excludeSaved: chkExcludeSaved.checked,
          excludeMe: chkExcludeMe.checked,
          excludeBusiness: chkExcludeBiz.checked,
        };

        const rows = await performFilteredExtraction(S, filterOpts);
        if (!rows.length) {
          showToast('⚠️ No contacts matched your filter settings.', true);
          return;
        }

        let baseName = 'whatsapp-contacts';
        if (chkLeads.checked && chkExcludeSaved.checked && !chkSaved.checked) {
          baseName = 'whatsapp-customer-leads';
        } else if (chkGroup.checked && !chkLeads.checked && !chkSaved.checked) {
          baseName = 'whatsapp-group-members';
        }

        const res = triggerDownload(rows, baseName, currentFormat);
        closeFilterModal();
        showToast(`✓ Exported ${res.count} contacts (${res.ext}) • satuxcodes`);
      } catch (err) {
        warn('export error', err);
        showToast(`Export failed: ${err.message || err}`, true);
      } finally {
        dlBtn.disabled = false;
        updateDownloadLabel();
      }
    });

    updateDownloadLabel();

    // Populate Live Counts Asynchronously
    const S = getStore();
    if (S) {
      try {
        const chats = listPersonChats(S);
        const reg = buildSavedContactRegistry(S);
        const leads = chats.filter((c) => {
          const d = widUser(c.id).replace(/\D/g, '');
          const s = widStr(c.id);
          return !(reg.savedDigitsSet.has(d) || reg.savedWidsSet.has(s) || (c.contact && (c.contact.isMyContact || c.contact.isAddressBookContact)));
        });

        const activeGroup = getCurrentOpenGroup(S);
        let groupCount = 'No group open';
        if (activeGroup) {
          try {
            const md = S.GroupMetadata && S.GroupMetadata.get(activeGroup.id);
            if (md && md.participants) groupCount = `${modelsOf(md.participants).length} members`;
            else groupCount = 'Active group';
          } catch (_) {}
        }

        const cntLeads = card.querySelector('#satux-cnt-leads');
        const cntSaved = card.querySelector('#satux-cnt-saved');
        const cntGroup = card.querySelector('#satux-cnt-group');

        if (cntLeads) cntLeads.textContent = `${leads.length} leads`;
        if (cntSaved) cntSaved.textContent = `${reg.savedDigitsSet.size} contacts`;
        if (cntGroup) cntGroup.textContent = groupCount;
      } catch (_) {}
    }
  }

  function closeFilterModal() {
    const overlay = document.getElementById('satux-modal-overlay');
    if (overlay) overlay.remove();
  }

  // ------------------------------------------------------------------
  // 6. Injection into WhatsApp Web UI
  // ------------------------------------------------------------------
  function injectControls() {
    ensureStyles();

    // Remove legacy green button if present
    const oldGreen = document.getElementById('wagx-launcher');
    if (oldGreen) oldGreen.remove();

    // 1. Inject Floating Pill (Fixed at bottom-right of viewport with z-index 9999999)
    // Impossible to be covered or rendered behind the chat list panel
    if (!document.getElementById('satux-floating-pill')) {
      const floatBtn = document.createElement('button');
      floatBtn.id = 'satux-floating-pill';
      floatBtn.title = 'Click to open WhatsApp Contact & Lead Exporter filter';
      floatBtn.innerHTML = '<span>⬇</span> Export &amp; Filter';
      floatBtn.addEventListener('click', openFilterModal);
      document.body.appendChild(floatBtn);
    }

    // 2. Inject Compact Header Button into WhatsApp Web Sidebar Header
    if (document.getElementById('satux-header-btn')) return;

    const headerSelectors = [
      '#side header',
      'header[data-testid="chatlist-header"]',
      'div[data-testid="chat-list-header"]',
      '#side > div:first-child > header',
      '#app header',
      'header'
    ];

    let header = null;
    for (const sel of headerSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        header = el;
        break;
      }
    }

    if (!header) return;

    const headerBtn = document.createElement('button');
    headerBtn.id = 'satux-header-btn';
    headerBtn.title = 'Click to filter and export WhatsApp contacts & customer leads';
    headerBtn.innerHTML = '<span>⬇</span> Export <span class="satux-badge-filter">Filter</span>';
    headerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openFilterModal();
    });

    const actionsWrapper = header.querySelector('div[role="toolbar"], div[style*="flex"], div:last-child');
    if (actionsWrapper && actionsWrapper.parentNode === header) {
      header.insertBefore(headerBtn, actionsWrapper);
    } else {
      header.appendChild(headerBtn);
    }
  }

  const boot = () => {
    injectControls();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.__SATUX_POLLER__ = setInterval(injectControls, 2000);

  // Expose clean programmatic API for DevTools or extension popup
  window.WAGX = {
    openFilterModal,
    open: openFilterModal,
    openOptions: openFilterModal,
  };

  log('loaded — full Apple Liquid Glass monochrome UX, unblockable floating pill & smart filter modal active');
})();
