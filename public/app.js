(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ic = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;

  // ---------- Effets ----------
  // Chiffres qui roulent jusqu'à leur nouvelle valeur
  function rollTo(el, value) {
    if (!el) return;
    const chars = [...String(value)];
    if (el._len !== chars.length || !el.querySelector('.roll')) {
      el.innerHTML = `<span class="roll" aria-hidden="true">${chars.map((c) => (/\d/.test(c)
        ? `<span class="col"><span class="strip">${'0123456789'.split('').map((d) => `<span>${d}</span>`).join('')}</span></span>`
        : `<span class="ch">${c === ' ' || c === '\u202f' || c === '\u00a0' ? '&nbsp;' : esc(c)}</span>`)).join('')}</span><span class="sr">${esc(value)}</span>`;
      el._len = chars.length;
      void el.offsetWidth;
    } else el.querySelector('.sr').textContent = value;
    const strips = el.querySelectorAll('.strip');
    let k = 0;
    chars.forEach((c, i) => { if (/\d/.test(c)) { const st = strips[k++]; st.style.transitionDelay = `${i * 35}ms`; st.style.transform = `translateY(-${Number(c) * 10}%)`; } });
  }
  // Cartes « squelette » pendant le chargement
  const skeletons = (n) => Array.from({ length: n }, () => `<div class="card sk" aria-hidden="true">
      <div class="sk-row"><i class="b" style="width:8px;height:8px;border-radius:50%"></i><i class="b" style="height:14px;width:45%"></i><i class="b" style="height:10px;width:18%;margin-left:auto"></i></div>
      <i class="b" style="height:11px;width:95%;margin:14px 0 7px"></i><i class="b" style="height:11px;width:70%"></i>
      <div class="sk-row" style="margin-top:14px"><i class="b" style="height:20px;width:64px;border-radius:999px"></i><i class="b" style="height:20px;width:48px;border-radius:999px"></i><i class="b" style="height:20px;width:56px;border-radius:999px"></i></div>
    </div>`).join('');
  // Bouton dont le texte roule (état 0 → 1 → 2 via data-s)
  function rollBtn(btn, labels) {
    if (!btn) return;
    btn.classList.add('rbtn');
    btn.style.setProperty('--h', `${btn.offsetHeight || 44}px`);
    btn.innerHTML = `<span class="stack">${labels.map((l) => `<span>${l}</span>`).join('')}</span>`;
    btn.dataset.s = '0';
  }
  const SPIN = '<i class="spin" aria-hidden="true"></i>';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Résumé qui apparaît mot par mot
  const reveal = (text) => esc(text).split(' ').map((w, k) => `<span class="w" style="animation-delay:${120 + k * 40}ms">${w}</span>`).join(' ');

  // ---------- Accès par lien personnel (?t=...) ----------
  const params = new URLSearchParams(location.search);
  let token = params.get('t');
  try {
    if (token) localStorage.setItem('diago_token', token);
    else token = localStorage.getItem('diago_token');
  } catch {}
  // On garde ?t= dans l'adresse et dans le manifeste : l'icône de l'écran d'accueil (iPhone) rouvre alors le bon cabinet
  if (token) {
    if (!params.get('t')) history.replaceState(null, '', `${location.pathname}?t=${encodeURIComponent(token)}${location.hash}`);
    const m = document.querySelector('link[rel=manifest]'); if (m) m.href = `/manifest.webmanifest?t=${encodeURIComponent(token)}`;
  }

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { showGate("Ce lien n'est plus valide. Demandez un nouveau lien."); throw new Error('401'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data;
  }

  // ---------- Libellés ----------
  const TYPE = { devis: 'Devis', rendez_vous: 'Rendez-vous', urgence: 'Urgence', information: 'Information', suivi: 'Suivi', autre: 'Appel' };
  const URG = { haute: 'Urgent', moyenne: 'Normal', basse: 'Pas pressé' };
  const STATUS = { a_rappeler: 'À rappeler', rdv_pris: 'RDV pris', termine: 'Terminé' };
  const NEXT = { a_rappeler: 'rdv_pris', rdv_pris: 'termine' };
  const DIAGS = { DPE: 45, Amiante: 45, Plomb: 30, 'Électricité': 30, Gaz: 30, Termites: 20, Carrez: 15, Boutin: 15, ERP: 5, 'Audit énergétique': 90 };

  // ---------- Formats ----------
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (m) => `${Math.floor(m / 60)}h${pad(Math.round(m) % 60)}`;
  const dl = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${pad(m % 60)}`);
  const km = (k) => `${Math.round(k)} km`;
  const toTime = (m) => (m == null ? '' : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  const fromTime = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayIso = () => isoDay(new Date());
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
  function dayLabel(iso) {
    const t = todayIso();
    if (iso === t) return "Aujourd'hui";
    if (iso === addDays(t, 1)) return 'Demain';
    if (iso === addDays(t, -1)) return 'Hier';
    const s = new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function timeAgo(iso) {
    const d = new Date(iso), min = Math.round((Date.now() - d) / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    const hh = `${d.getHours()}h${pad(d.getMinutes())}`;
    if (d.toDateString() === new Date().toDateString()) return hh;
    if (min < 60 * 48) return `hier ${hh}`;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
  function fmtPhone(n) {
    if (!n) return 'Numéro masqué';
    const m = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(n);
    return m ? `0${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` : n;
  }
  const waze = (p) => `https://waze.com/ul?ll=${p.lat},${p.lon}&navigate=yes`;
  const diagList = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : []);

  // ---------- État ----------
  const state = { me: null, view: 'calls', calls: [], known: new Set(), filter: 'all', q: '', day: todayIso(), start: null, mode: 'opt', route: null, callId: null, quotes: null, qfilter: null, qsettings: null, reveal: new Set(), firstPaint: true, swiped: false };

  // ---------- Toast / feuille ----------
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600);
  }
  function openSheet(title, meta, html) {
    $('#shTitle').textContent = title; $('#shMeta').textContent = meta || '';
    $('#shBody').innerHTML = html; $('#shBody').scrollTop = 0;
    $('#overlay').hidden = false; $('#sheet').hidden = false;
  }
  function closeSheet() {
    $('#overlay').hidden = true; $('#sheet').hidden = true; state.callId = null;
    if (/^#call-/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  }
  // Aperçu du devis dans Diago, avec une croix pour revenir (l'app de l'écran d'accueil n'a pas de bouton retour)
  function openPreview(url) {
    const box = document.createElement('div');
    box.className = 'preview';
    box.innerHTML = `<div class="preview-bar"><button type="button" class="preview-x" aria-label="Fermer l'aperçu">${ic('x')}</button><b>Aperçu du devis</b><span></span></div><iframe src="${url}" title="Aperçu du devis"></iframe>`;
    const close = () => { box.classList.add('out'); setTimeout(() => box.remove(), 250); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    box.querySelector('.preview-x').addEventListener('click', close);
    document.addEventListener("keydown", onKey);
    document.body.append(box);
  }
  // Écran sans lien : on peut coller son lien (ou juste le code) pour se connecter
  $('#gateForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#gateInput').value.trim(), m = v.match(/[?&]t=([\w-]+)/) || v.match(/^([\w-]{8,64})$/);
    if (!m) return toast('Lien non reconnu');
    location.href = `/?t=${encodeURIComponent(m[1])}`;
  });
  $('#overlay').addEventListener('click', closeSheet);
  $('#shClose').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

  function showGate(msg) {
    $('#app').hidden = true; $('#tabbar').hidden = true; $('#gate').hidden = false;
    window.DiagoUI && DiagoUI.hideSplash();
    if (msg) $('#gateMsg').textContent = msg;
  }

  // ---------- Navigation ----------
  const HASH = { calls: '#appels', quotes: '#devis', route: '#tournee', settings: '#reglages' };
  function show(view) {
    state.view = view;
    for (const v of ['calls', 'quotes', 'route', 'settings']) $(`#v-${v}`).hidden = v !== view;
    $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    window.DiagoUI && DiagoUI.setTab(view);
    if (!/^#call-/.test(location.hash) || view !== 'calls') history.replaceState(null, '', HASH[view]);
    if (view === 'route') loadRoute();
    if (view === 'quotes') loadQuotes().catch((err) => toast(err.message));
    if (view === 'settings') fillSettings();
    window.scrollTo({ top: 0 });
  }
  $('#tabbar').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) show(b.dataset.view); });
  // Activités récentes (cloche en haut à droite) : ouvrir le panneau met aussi tout à jour
  const seenKey = () => `diago_seen_${token}`;
  const seenAt = () => { try { return Number(localStorage.getItem(seenKey())) || Date.now() - 864e5; } catch { return Date.now() - 864e5; } };
  function activities() {
    const list = [];
    for (const c of state.calls.slice(0, 30)) {
      const who = c.caller_name || fmtPhone(c.caller_number);
      list.push({ t: c.started_at, icon: c.appt_day ? 'cal' : 'phone', hot: c.urgency === 'haute' && c.status === 'a_rappeler',
        title: c.appt_day ? `RDV pris : ${who}` : `${c.urgency === 'haute' ? 'Appel urgent' : 'Nouvel appel'} : ${who}`,
        desc: c.appt_day ? `${rdvLabel(c.appt_day, c.appt_start)} · ${c.summary || ''}` : (c.summary || ''), open: () => { show('calls'); openCall(c.id); } });
    }
    for (const x of state.quotes || []) {
      const who = x.customer_name || x.number;
      if (x.status === 'accepte' && x.accepted_at) list.push({ t: x.accepted_at, icon: 'check', title: `Devis accepté : ${who}`, desc: `${x.number}${x.total_ttc != null ? ` · ${Number(x.total_ttc).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}` : ''}`, open: () => { show('quotes'); openQuote(x.id); } });
      else if (x.status === 'a_valider') list.push({ t: x.created_at, icon: 'doc', title: `Devis à valider : ${who}`, desc: x.number + (x.address ? ` · ${x.address}` : ''), open: () => { show('quotes'); openQuote(x.id); } });
    }
    return list.filter((a) => a.t).sort((a, b) => new Date(b.t) - new Date(a.t)).slice(0, 8);
  }
  function renderActivity() {
    const acts = activities(), seen = seenAt();
    const unread = acts.filter((a) => new Date(a.t) > seen).length;
    $('#actCount').hidden = !unread; $('#actCount').textContent = unread;
    $('#actTitle').textContent = unread ? `${unread} nouvelle${unread > 1 ? 's' : ''} activité${unread > 1 ? 's' : ''}` : 'Activités';
    $('#actList').innerHTML = acts.length ? acts.map((a, i) => `
      <button type="button" class="act-item${new Date(a.t) > seen ? ' new' : ''}" data-i="${i}" style="--d:${i * 60}ms">
        <span class="act-ic${a.hot ? ' hot' : ''}">${ic(a.icon)}</span>
        <span class="act-txt"><b>${esc(a.title)}</b><span>${esc(a.desc)}</span></span>
        <span class="act-when">${timeAgo(a.t)}</span>
      </button>`).join('') : '<p class="act-empty">Rien de nouveau pour l\'instant.</p>';
    $('#actList').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) { toggleActivity(false); acts[+b.dataset.i].open(); } };
  }
  function toggleActivity(open = !$('#topCard').classList.contains('open')) {
    $('#topCard').classList.toggle('open', open);
    $('#actBtn').setAttribute('aria-expanded', open);
    if (!open) { try { localStorage.setItem(seenKey(), Date.now()); } catch {} renderActivity(); return; }
    renderActivity();
    // On met tout à jour en ouvrant (remplace l'ancien bouton Actualiser)
    Promise.all([loadCalls({ silent: true }), loadQuotes({ silent: true }), state.view === 'route' ? loadRoute() : null]).then(renderActivity).catch(() => {});
  }
  $('#actBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleActivity(); });
  document.addEventListener('click', (e) => { if ($('#topCard').classList.contains('open') && !e.target.closest('#topCard')) toggleActivity(false); });

  // =====================================================================
  // APPELS
  // =====================================================================
  function visibleCalls() {
    const q = state.q.trim().toLowerCase();
    return state.calls.filter((c) => {
      if (state.filter === 'urgent' && !(c.urgency === 'haute' && c.status === 'a_rappeler')) return false;
      if (STATUS[state.filter] && c.status !== state.filter) return false;
      if (state.filter === 'all' && c.status === 'termine') return false; // les missions terminées ne restent que dans « Terminés »
      if (q && ![c.caller_name, c.caller_number, c.summary, c.address, c.diagnostics].some((v) => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }
  function rdvLabel(day, start) {
    const d = new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    return start != null ? `${d} · ${Math.floor(start / 60)}h${String(start % 60).padStart(2, '0')}` : d;
  }
  function renderCalls() {
    const list = visibleCalls(), el = $('#callList');
    if (!list.length) {
      el.innerHTML = `<div class="card empty"><b>${state.calls.length ? 'Aucune mission ici' : 'Aucun appel pour le moment'}</b>${state.calls.length ? 'Essayez un autre filtre.' : 'Les appels que vous ne pouvez pas prendre arriveront ici, résumés et triés.'}</div>`;
      return;
    }
    const fade = state.firstPaint; state.firstPaint = false;
    el.innerHTML = list.map((c, idx) => `
      <div class="swipe ${state.reveal.has(c.id) ? 'newcard' : ''} ${fade ? 'fadein' : ''}" style="${fade ? `animation-delay:${idx * 70}ms` : ''}">
      <div class="under" aria-hidden="true"><span class="l">${NEXT[c.status] ? `${ic('check')}Fait` : ''}</span><span class="r">${c.caller_number ? `Rappeler${ic('phone')}` : ''}</span></div>
      <article class="card item ${c.status === 'termine' ? 'dim' : ''}" data-id="${c.id}" tabindex="0">
        <div class="row"><span class="dot ${c.urgency}" title="${URG[c.urgency]}"></span><span class="name">${esc(c.caller_name || fmtPhone(c.caller_number))}</span>${c.appt_day ? `<span class="rdv">${ic('cal')}${rdvLabel(c.appt_day, c.appt_start)}</span>` : ''}<span class="when">${timeAgo(c.started_at)}</span></div>
        <p class="sum">${state.reveal.has(c.id) ? reveal(c.summary) : esc(c.summary)}</p>
        <div class="tags">
          ${c.urgency === 'haute' ? '<span class="tag red">Urgent</span>' : ''}
          ${c.request_type !== 'urgence' ? `<span class="tag">${TYPE[c.request_type] || 'Appel'}</span>` : ''}
          ${diagList(c.diagnostics).slice(0, 3).map((d) => `<span class="tag">${esc(d)}</span>`).join('')}
          ${c.callback_before ? `<span class="tag amber">Rappeler ${esc(c.callback_before)}</span>` : ''}
          ${c.address ? `<span class="tag">${esc(c.address)}</span>` : ''}
          ${c.status !== 'a_rappeler' ? `<span class="tag ${c.status === 'rdv_pris' ? 'leaf' : ''}">${STATUS[c.status]}</span>` : ''}
          ${c.quote_id ? `<span class="tag green">Devis ${eur(c.quote_total)}${c.quote_status === 'accepte' ? ' · accepté' : ''}</span>` : ''}
        </div>
        ${NEXT[c.status] ? `<div class="actions">
          ${c.caller_number ? `<a class="btn primary sm" href="tel:${esc(c.caller_number)}" data-stop>${ic('phone')}Rappeler</a>` : ''}
          <button class="btn sm" data-quick="${NEXT[c.status]}" data-stop>${ic('check')}Fait</button>
        </div>` : ''}
      </article></div>`).join('');
    state.reveal.clear();
  }
  async function loadStats() {
    const s = await api('/stats');
    rollTo($('#sTodo'), s.a_rappeler); rollTo($('#sUrgent'), s.urgents); rollTo($('#sToday'), s.aujourdhui);
    $('#badge').hidden = !s.a_rappeler; $('#badge').textContent = s.a_rappeler;
  }
  async function loadCalls({ silent } = {}) {
    if (!silent && !state.calls.length) $('#callList').innerHTML = skeletons(3);
    const calls = await api('/calls');
    const fresh = state.known.size ? calls.filter((c) => !state.known.has(c.id)) : [];
    fresh.forEach((c) => state.reveal.add(c.id));
    calls.forEach((c) => state.known.add(c.id));
    state.calls = calls;
    renderCalls();
    renderActivity();
    loadStats().catch(() => {});
    if (fresh.length || !state.quotes) loadQuotes({ silent: true }).catch(() => {});
    if (fresh.length) {
      const c = fresh[0];
      toast(`Nouvel appel : ${c.caller_name || fmtPhone(c.caller_number)}${c.urgency === 'haute' ? ' — urgent' : ''}`);
      try { navigator.vibrate?.([60, 40, 60]); } catch {}
    }
  }
  function setFilter(f) {
    state.filter = f;
    $$('#chips .chip').forEach((b) => b.classList.toggle('on', b.dataset.filter === f));
    renderCalls();
  }
  async function setStatus(id, status) {
    await api(`/calls/${id}`, { method: 'PATCH', body: { status } });
    const c = state.calls.find((x) => x.id === id); if (c) c.status = status;
    renderCalls(); loadStats().catch(() => {});
    toast(status === 'rdv_pris' ? 'Passé dans « RDV pris »' : status === 'termine' ? 'Mission terminée' : `Marqué « ${STATUS[status]} »`);
  }

  async function openCall(id) {
    const c = await api(`/calls/${id}`);
    state.callId = id;
    const lines = (c.transcript || '').split('\n').filter(Boolean).map((l) => {
      const m = /^\s*(AI|Agent|Assistant|Bot|User|Client|Caller)\s*:\s*(.*)$/i.exec(l);
      if (!m) return `<p class="line">${esc(l)}</p>`;
      const user = /user|client|caller/i.test(m[1]);
      return `<p class="line"><b>${user ? 'Appelant' : 'Agent'} :</b> ${esc(m[2])}</p>`;
    }).join('');
    openSheet(c.caller_name || fmtPhone(c.caller_number),
      `${timeAgo(c.started_at)}${c.duration_sec ? ` · ${Math.floor(c.duration_sec / 60)} min ${pad(c.duration_sec % 60)} s` : ''} · ${URG[c.urgency]}`, `
      <div class="block"><h3>Résumé</h3><p>${esc(c.summary)}</p></div>
      <div class="block next"><h3>À faire</h3><p>${esc(c.next_action || 'Rappeler le client.')}</p></div>
      ${c.caller_number ? `<div class="two"><a class="btn primary" href="tel:${esc(c.caller_number)}">${ic('phone')}Appeler</a><a class="btn" href="sms:${esc(c.caller_number)}">${ic('sms')}SMS</a></div>` : ''}
      <div class="two"><button class="btn" id="planBtn">${ic('cal')}Planifier un RDV</button>${c.quote ? `<button class="btn" id="quoteBtn">${ic('doc')}Devis ${eur(c.quote.total_ttc)}</button>` : `<button class="btn" id="quoteBtn">${ic('doc')}Faire un devis</button>`}</div>
      <div class="seg" id="stSeg" style="margin-bottom:10px">${Object.entries(STATUS).map(([k, v]) => `<button class="${c.status === k ? 'on' : ''}" data-status="${k}">${v}</button>`).join('')}</div>
      <div class="block grid2">
        <div><span>Numéro</span>${esc(fmtPhone(c.caller_number))}</div>
        <div><span>Demande</span>${TYPE[c.request_type] || '—'}</div>
        <div><span>Rappeler</span>${esc(c.callback_before || 'Dès que possible')}</div>
        <div><span>Lieu</span>${esc(c.address || '—')}</div>
        ${c.diagnostics ? `<div style="grid-column:1/-1"><span>Diagnostics</span>${esc(c.diagnostics)}</div>` : ''}
      </div>
      ${c.recording_url ? `<div class="block"><h3>Enregistrement</h3><audio controls preload="none" src="${esc(c.recording_url)}"></audio></div>` : ''}
      ${lines ? `<div class="block"><h3>Transcription</h3><div class="transcript">${lines}</div></div>` : ''}`);
    history.replaceState(null, '', `#call-${id}`);
    $('#stSeg').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-status]'); if (!b) return;
      await setStatus(id, b.dataset.status);
      $$('#stSeg button').forEach((x) => x.classList.toggle('on', x === b));
    });
    $('#quoteBtn').addEventListener('click', async () => {
      if (c.quote) return openQuote(c.quote.id).catch((err) => toast(err.message));
      if (!state.qsettings) await loadQuoteSettings().catch(() => {});
      quoteEditor(null, { call_id: c.id, customer_name: c.caller_name || '', customer_phone: c.caller_number || '', address: c.address || '', diagnostics: c.diagnostics || '' });
    });
    $('#planBtn').addEventListener('click', () => openApptForm({ prefill: {
      name: c.caller_name || '', phone: c.caller_number || '', address: c.address || '', diagnostics: diagList(c.diagnostics), call_id: c.id,
      day: state.day >= todayIso() ? state.day : todayIso(),
    } }));
  }

  $('#callList').addEventListener('click', (e) => {
    if (state.swiped) { state.swiped = false; e.preventDefault(); return; }
    const card = e.target.closest('.item'); if (!card) return;
    const quick = e.target.closest('[data-quick]');
    if (quick) { e.preventDefault(); setStatus(Number(card.dataset.id), quick.dataset.quick); return; }
    if (e.target.closest('[data-stop]')) return;
    openCall(Number(card.dataset.id)).catch((err) => toast(err.message));
  });
  $('#callList').addEventListener('keydown', (e) => { const c = e.target.closest('.item'); if (c && e.key === 'Enter') openCall(Number(c.dataset.id)); });
  // Glisser une carte : à droite = Fait, à gauche = Rappeler
  let drag = null;
  $('#callList').addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.item');
    if (!item || e.target.closest('a, button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { item, wrap: item.parentElement, x0: e.clientX, y0: e.clientY, dx: 0, locked: false, id: e.pointerId };
  });
  $('#callList').addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.locked) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      if (Math.abs(dx) < 8) return;
      drag.locked = true; drag.item.classList.add('drag'); drag.wrap.classList.add('dragging');
      try { drag.item.setPointerCapture(e.pointerId); } catch {}
    }
    const c = state.calls.find((x) => x.id === Number(drag.item.dataset.id));
    const allowR = !!NEXT[c?.status], allowL = !!c?.caller_number;
    let x = dx;
    if ((x > 0 && !allowR) || (x < 0 && !allowL)) x *= 0.15;
    else if (Math.abs(x) > 110) x = Math.sign(x) * (110 + (Math.abs(x) - 110) * 0.4);
    drag.dx = dx;
    drag.wrap.classList.toggle('to-r', dx > 0); drag.wrap.classList.toggle('to-l', dx < 0);
    drag.item.style.transform = `translateX(${x}px)`;
  });
  const endDrag = () => {
    if (!drag) return;
    const { item, wrap, dx, locked } = drag; drag = null;
    if (!locked) return;
    state.swiped = true; setTimeout(() => (state.swiped = false), 400);
    item.classList.remove('drag');
    const id = Number(item.dataset.id), c = state.calls.find((x) => x.id === id);
    if (dx > 90 && NEXT[c?.status]) {
      item.style.transform = 'translateX(110%)';
      setTimeout(() => setStatus(id, NEXT[c.status]).catch((err) => { toast(err.message); renderCalls(); }), 220);
      return;
    }
    item.style.transform = '';
    setTimeout(() => wrap.classList.remove('dragging', 'to-r', 'to-l'), 350);
    if (dx < -90 && c?.caller_number) location.href = `tel:${c.caller_number}`;
  };
  $('#callList').addEventListener('pointerup', endDrag);
  $('#callList').addEventListener('pointercancel', endDrag);

  $('#chips').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) setFilter(b.dataset.filter); });
  $$('.stat[data-filter]').forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.filter)));
  $('#search').addEventListener('input', (e) => { state.q = e.target.value; renderCalls(); });


  // ---------- Mission ajoutée à la main ----------
  function openMissionForm() {
    let rdv = false;
    openSheet('Nouvelle mission', 'Un client qui vous a appelé directement', `
      <form class="form" id="mForm" autocomplete="off">
        <div class="card group">
          <label class="field"><span>Client *</span><input name="cname" required placeholder="Nom du client ou de l'agence" /></label>
          <label class="field"><span>Téléphone</span><input name="phone" type="tel" inputmode="tel" placeholder="06 12 34 56 78" /></label>
          <label class="field"><span>Adresse du bien</span><input name="address" placeholder="Numéro, rue, ville" /><div class="sugg" hidden></div></label>
          <div class="field"><span>Diagnostics</span><div class="chipset" id="mDiags">${Object.keys(DIAGS).map((d) => `<button type="button" class="chip" data-d="${esc(d)}">${esc(d)}</button>`).join('')}</div></div>
          <label class="field"><span>Note</span><textarea name="summary" placeholder="Ce que veut le client, délai, infos utiles…"></textarea></label>
        </div>
        <div class="card group">
          <div class="field"><span>Rendez-vous</span><div class="seg" id="mRdv"><button type="button" class="on" data-v="0">À rappeler</button><button type="button" data-v="1">RDV déjà fixé</button></div></div>
          <div id="mWhen" hidden>
            <div class="field mini"><label><span>Date</span><input name="day" type="date" value="${esc(state.day >= todayIso() ? state.day : todayIso())}" /></label><label><span>Heure</span><input name="time" type="time" step="900" value="09:00" /></label></div>
          </div>
        </div>
        <button type="submit" class="btn primary block">Ajouter la mission</button>
      </form>`);
    const f = $('#mForm');
    autocomplete(f.address);
    $('#mDiags').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b) b.classList.toggle('on'); });
    $('#mRdv').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      rdv = b.dataset.v === '1';
      $$('#mRdv button').forEach((x) => x.classList.toggle('on', x === b));
      $('#mWhen').hidden = !rdv;
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = f.querySelector('[type=submit]');
      const diags = $$('#mDiags .chip.on').map((x) => x.dataset.d);
      if (rdv && (!f.address.value.trim() || !f.day.value || fromTime(f.time.value) == null)) { toast("Pour un RDV : adresse, date et heure"); return; }
      btn.disabled = true;
      try {
        const call = await api('/calls', { method: 'POST', body: { name: f.cname.value, phone: f.phone.value, address: f.address.value, diagnostics: diags, summary: f.summary.value, rdv } });
        state.known.add(call.id);
        if (rdv) {
          const t = fromTime(f.time.value);
          const body = { call_id: call.id, day: f.day.value, name: f.cname.value, phone: f.phone.value, address: f.address.value, diagnostics: diags, duration_min: suggestDuration(diags), win_start: t, win_end: t, notes: f.summary.value };
          if (f.address.dataset.lat) { body.lat = Number(f.address.dataset.lat); body.lon = Number(f.address.dataset.lon); }
          await api('/appointments', { method: 'POST', body });
        }
        closeSheet(); toast(rdv ? 'Mission ajoutée, RDV dans la tournée' : 'Mission ajoutée');
        state.filter = rdv ? 'rdv_pris' : 'a_rappeler'; setFilter(state.filter);
        await loadCalls({ silent: true });
      } catch (err) { toast(err.message); btn.disabled = false; }
    });
  }
  $('#newMission').addEventListener('click', () => openMissionForm());
  // =====================================================================
  // ADRESSES (autocomplétion)
  // =====================================================================
  function autocomplete(input) {
    const box = input.parentElement.querySelector('.sugg');
    let timer, seq = 0;
    input.addEventListener('input', () => {
      delete input.dataset.lat; delete input.dataset.lon;
      clearTimeout(timer);
      const v = input.value.trim();
      if (v.length < 4) { box.hidden = true; return; }
      timer = setTimeout(async () => {
        const my = ++seq;
        const res = await api(`/geocode?q=${encodeURIComponent(v)}`).catch(() => []);
        if (my !== seq) return;
        box.innerHTML = res.map((r, i) => `<button type="button" data-i="${i}">${esc(r.label)}</button>`).join('');
        box.hidden = !res.length;
        box.onclick = (e) => {
          const b = e.target.closest('[data-i]'); if (!b) return;
          const r = res[Number(b.dataset.i)];
          input.value = r.label; input.dataset.lat = r.lat; input.dataset.lon = r.lon; box.hidden = true;
        };
      }, 250);
    });
    input.addEventListener('blur', () => setTimeout(() => (box.hidden = true), 200));
  }

  // =====================================================================
  // RENDEZ-VOUS (formulaire)
  // =====================================================================
  const WIN = { free: 'Libre', before: 'Avant', after: 'Après', between: 'Entre', fixed: 'Fixe' };
  function winKind(a) {
    if (a.win_start == null && a.win_end == null) return 'free';
    if (a.win_start != null && a.win_end != null) return a.win_start === a.win_end ? 'fixed' : 'between';
    return a.win_start != null ? 'after' : 'before';
  }
  function suggestDuration(diags) {
    const t = diags.reduce((s, d) => s + (DIAGS[d] ?? 30), 0) || 60;
    return Math.min(240, Math.max(30, Math.ceil(t / 15) * 15));
  }

  function openApptForm({ appt, prefill } = {}) {
    const a = appt || { day: state.day, name: '', phone: '', address: '', diagnostics: [], duration_min: 60, win_start: null, win_end: null, notes: '', ...prefill };
    const diags = Array.isArray(a.diagnostics) ? a.diagnostics : diagList(a.diagnostics);
    let kind = winKind(a), durTouched = !!appt;
    const durOpts = []; for (let m = 15; m <= 240; m += 15) durOpts.push(m);
    openSheet(appt ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous', a.call_id && !appt ? 'Depuis un appel reçu' : '', `
      <form class="form" id="apForm" autocomplete="off">
        <div class="card group">
          <label class="field"><span>Client *</span><input name="name" required value="${esc(a.name)}" placeholder="Nom du client ou de l'agence" /></label>
          <label class="field"><span>Téléphone</span><input name="phone" type="tel" inputmode="tel" value="${esc(a.phone ? fmtPhone(a.phone) : '')}" placeholder="06 12 34 56 78" /></label>
          <label class="field"><span>Adresse du bien *</span><input name="address" required value="${esc(a.address)}" placeholder="Numéro, rue, ville" /><div class="sugg" hidden></div></label>
          <label class="field"><span>Date</span><input name="day" type="date" required value="${esc(a.day)}" /></label>
        </div>
        <div class="card group">
          <div class="field"><span>Diagnostics</span><div class="chipset" id="apDiags">${Object.keys(DIAGS).map((d) => `<button type="button" class="chip ${diags.includes(d) ? 'on' : ''}" data-d="${esc(d)}">${esc(d)}</button>`).join('')}</div></div>
          <label class="field"><span>Durée sur place</span><select name="duration_min">${durOpts.map((m) => `<option value="${m}" ${m === a.duration_min ? 'selected' : ''}>${dl(m)}</option>`).join('')}</select></label>
          <div class="field"><span>Créneau du client</span>
            <div class="seg" id="apWin">${Object.entries(WIN).map(([k, v]) => `<button type="button" class="${k === kind ? 'on' : ''}" data-k="${k}">${v}</button>`).join('')}</div>
            <div class="inline" id="apTimes" style="margin-top:8px">
              <input type="time" name="t1" step="900" value="${toTime(a.win_start ?? a.win_end)}" aria-label="Heure" />
              <span id="apAnd">et</span>
              <input type="time" name="t2" step="900" value="${toTime(a.win_end)}" aria-label="Heure de fin" />
            </div>
          </div>
          <label class="field"><span>Notes</span><textarea name="notes" placeholder="Code d'accès, étage, clés à récupérer…">${esc(a.notes || '')}</textarea></label>
        </div>
        <div class="sh-foot">
          ${appt ? `<button type="button" class="btn danger" id="apDel">Supprimer</button>` : ''}
          ${appt && appt.done ? `<button type="button" class="btn" id="apUndo">Remettre à faire</button>` : ''}
          <button type="submit" class="btn primary">${appt ? 'Enregistrer' : 'Ajouter à la tournée'}</button>
        </div>
      </form>`);
    const f = $('#apForm');
    if (appt?.lat != null) { f.address.dataset.lat = appt.lat; f.address.dataset.lon = appt.lon; }
    autocomplete(f.address);
    const syncTimes = () => {
      $('#apTimes').hidden = kind === 'free';
      f.t2.hidden = $('#apAnd').hidden = kind !== 'between';
    };
    syncTimes();
    $('#apWin').addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      kind = b.dataset.k; $$('#apWin button').forEach((x) => x.classList.toggle('on', x === b)); syncTimes();
    });
    f.duration_min.addEventListener('change', () => (durTouched = true));
    $('#apDiags').addEventListener('click', (e) => {
      const b = e.target.closest('[data-d]'); if (!b) return;
      b.classList.toggle('on');
      if (!durTouched) f.duration_min.value = String(suggestDuration($$('#apDiags .chip.on').map((x) => x.dataset.d)));
    });
    if (!appt && diags.length) f.duration_min.value = String(suggestDuration(diags));
    $('#apDel')?.addEventListener('click', async () => {
      if (!$('#apDel').dataset.sure) { $('#apDel').dataset.sure = '1'; $('#apDel').textContent = 'Confirmer la suppression'; return; }
      await api(`/appointments/${appt.id}`, { method: 'DELETE' });
      closeSheet(); toast('Rendez-vous supprimé'); loadRoute();
    });
    $('#apUndo')?.addEventListener('click', async () => {
      await api(`/appointments/${appt.id}`, { method: 'PATCH', body: { done: false } });
      closeSheet(); loadRoute(); loadCalls({ silent: true }).catch(() => {});
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t1 = fromTime(f.t1.value), t2 = fromTime(f.t2.value);
      const win = { free: [null, null], before: [null, t1], after: [t1, null], between: [t1, t2], fixed: [t1, t1] }[kind];
      if (kind !== 'free' && t1 == null) { toast("Indiquez l'heure du créneau"); return; }
      if (kind === 'between' && (t2 == null || t2 <= t1)) { toast('La fin du créneau doit être après le début'); return; }
      const body = {
        name: f.elements.name.value, phone: f.phone.value, address: f.address.value, day: f.day.value,
        diagnostics: $$('#apDiags .chip.on').map((x) => x.dataset.d), duration_min: Number(f.duration_min.value),
        win_start: win[0], win_end: win[1], notes: f.notes.value,
      };
      if (f.address.dataset.lat) { body.lat = Number(f.address.dataset.lat); body.lon = Number(f.address.dataset.lon); }
      if (a.call_id && !appt) body.call_id = a.call_id;
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const saved = await api(appt ? `/appointments/${appt.id}` : '/appointments', { method: appt ? 'PATCH' : 'POST', body });
        closeSheet();
        toast(saved.lat == null ? 'Enregistré, mais adresse introuvable sur la carte' : appt ? 'Rendez-vous modifié' : 'Ajouté à la tournée');
        if (body.call_id) { const c = state.calls.find((x) => x.id === body.call_id); if (c) c.status = 'rdv_pris'; renderCalls(); }
        state.day = saved.day;
        if (state.view === 'route') loadRoute(); else show('route');
      } catch (err) { toast(err.message); btn.disabled = false; }
    });
  }

  // =====================================================================
  // TOURNÉE
  // =====================================================================
  const STYLE = 'https://tiles.openfreemap.org/styles/positron';
  let map = null, mapReady = false, markers = [], pendingDraw = null;
  const mapBox = document.createElement('div');
  mapBox.className = 'mapbox';
  mapBox.innerHTML = '<div id="map"></div>';

  function restyle() {
    for (const l of map.getStyle().layers) {
      try {
        const id = l.id.toLowerCase();
        if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#f1eee7');
        else if (l.type === 'fill' && /water|ocean|lake/.test(id)) map.setPaintProperty(l.id, 'fill-color', '#a7d3f4');
        else if (l.type === 'fill' && /park|wood|forest|grass|landcover|nature|vegetation/.test(id)) map.setPaintProperty(l.id, 'fill-color', '#d6e8c9');
        else if (l.type === 'line' && /motorway|trunk/.test(id) && !/casing|outline/.test(id)) map.setPaintProperty(l.id, 'line-color', '#f6cf7c');
        else if (l.type === 'line' && /water|river/.test(id)) map.setPaintProperty(l.id, 'line-color', '#a7d3f4');
        if (l.type === 'symbol' && map.getLayoutProperty(l.id, 'text-field')) map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:fr'], ['get', 'name']]);
      } catch {}
    }
  }
  function ensureMap(center) {
    if (map || !window.maplibregl) return;
    map = new maplibregl.Map({ container: $('#map', mapBox), style: STYLE, center: [center.lon, center.lat], zoom: 9.5, attributionControl: { compact: true }, cooperativeGestures: false });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      restyle();
      map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'route-case', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9 } });
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#2f5e45', 'line-width': 5 } });
      mapReady = true;
      if (pendingDraw) { pendingDraw(); pendingDraw = null; }
    });
  }
  function drawMap(home, plan, byId) {
    if (!window.maplibregl) { $('#map', mapBox).innerHTML = '<div class="map-fallback">Carte indisponible</div>'; return; }
    ensureMap(home);
    requestAnimationFrame(() => map && map.resize());
    const draw = () => {
      const coords = plan.geometry?.coordinates || [[home.lon, home.lat], ...plan.stops.map((s) => [byId[s.id].lon, byId[s.id].lat]), [home.lon, home.lat]];
      map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });
      markers.forEach((m) => m.remove()); markers = [];
      const mk = (html, cls, p) => { const el = document.createElement('div'); el.className = `pin ${cls}`; el.innerHTML = html; markers.push(new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map)); };
      mk(ic('home'), 'home', home);
      plan.stops.forEach((s, i) => { const a = byId[s.id]; mk(String(i + 1), a.done ? 'done' : s.late ? 'late' : '', a); });
      const b = new maplibregl.LngLatBounds();
      coords.forEach((c) => b.extend(c));
      map.fitBounds(b, { padding: { top: 50, bottom: 40, left: 40, right: 50 }, maxZoom: 14, duration: 0 });
    };
    if (mapReady) draw(); else pendingDraw = draw;
  }

  async function loadRoute() {
    $('#dayTitle').textContent = dayLabel(state.day);
    $('#daySub').textContent = state.me?.home_address ? `Départ : ${state.me.home_address}` : '';
    $('#dayInput').value = state.day;
    const body = $('#routeBody');
    if (!state.route || state.route.day !== state.day) body.innerHTML = '<div class="skeleton" style="height:340px;margin-top:14px"></div>';
    try {
      const qs = `?day=${state.day}${state.start != null ? `&start=${state.start}` : ''}`;
      state.route = await api('/route' + qs);
      renderRoute();
    } catch (err) {
      if (err.message !== '401') body.innerHTML = `<div class="card empty"><b>Impossible de charger la tournée</b>${esc(err.message)}</div>`;
    }
  }

  function renderRoute() {
    const r = state.route, body = $('#routeBody');
    const addBtn = `<button class="btn primary" data-add>${ic('plus')}Ajouter un rendez-vous</button>`;
    if (r.needs_home) {
      body.innerHTML = `<div class="card empty" style="margin-top:14px"><b>Indiquez l'adresse du cabinet</b>C'est le point de départ et d'arrivée de vos tournées.<br><button class="btn primary" data-go="settings">${ic('gear')}Ouvrir les réglages</button></div>`;
      return;
    }
    if (!r.appointments.length) {
      body.innerHTML = `<div class="card empty" style="margin-top:14px"><b>Aucun rendez-vous ${state.day === todayIso() ? "aujourd'hui" : 'ce jour-là'}</b>Ajoutez vos visites : Diago calcule le meilleur ordre de passage.<br>${addBtn}</div>`;
      return;
    }
    const byId = Object.fromEntries(r.appointments.map((a) => [a.id, a]));
    const p = r.plan, opt = p.optimized, ent = p.entered, cur = state.mode === 'opt' ? opt : ent;
    const missing = p.missing.map((id) => byId[id]);
    // Adresse trouvée très loin du cabinet : sûrement la mauvaise ville
    const R = Math.PI / 180;
    const far = (a) => { const dLa = (a.lat - r.home.lat) * R, dLo = (a.lon - r.home.lon) * R; const h = Math.sin(dLa / 2) ** 2 + Math.cos(r.home.lat * R) * Math.cos(a.lat * R) * Math.sin(dLo / 2) ** 2; const k = 2 * 6371 * Math.asin(Math.sqrt(h)); return k > 80 ? Math.round(k) : 0; };
    const farList = r.appointments.filter((a) => a.lat != null && far(a));

    // Bandeau de comparaison
    let banner;
    const gk = Math.round(ent.km - opt.km), gt = ent.drive_min - opt.drive_min;
    if (!cur.stops.length) banner = '';
    else if (state.mode === 'opt') {
      const parts = [];
      if (gk > 0) parts.push(`${gk} km et ${dl(Math.max(gt, 0))} de route en moins que dans l'ordre de saisie`);
      if (ent.late_count > opt.late_count) parts.push(opt.late_count ? 'moins de retards' : 'tous les créneaux sont respectés');
      banner = opt.late_count
        ? `<div class="banner bad">Impossible de respecter tous les créneaux : ${opt.late_count} rendez-vous en retard. Avancez l'heure de départ ou déplacez une visite.</div>`
        : `<div class="banner">${parts.length ? parts.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.' : "L'ordre de saisie est déjà le meilleur trajet."}</div>`;
    } else banner = ent.late_count
      ? `<div class="banner bad">Dans cet ordre, ${ent.late_count > 1 ? `${ent.late_count} rendez-vous tombent` : 'un rendez-vous tombe'} hors créneau.</div>`
      : `<div class="banner neutral">Ordre dans lequel les rendez-vous ont été saisis.</div>`;

    // Guidage
    const nextIdx = cur.stops.findIndex((s) => !byId[s.id].done);
    const len = cur.stops.length, atHome = nextIdx === -1;
    const nxt = atHome ? null : byId[cur.stops[nextIdx].id];
    const guide = len ? `
      <section class="card guide">
        <div class="g-top"><span class="g-step">${atHome ? 'Dernière étape' : `Étape ${nextIdx + 1} sur ${len}`}</span>
          <div class="g-dots">${cur.stops.map((s, i) => `<span class="${byId[s.id].done ? 'done' : i === nextIdx ? 'now' : ''}"></span>`).join('')}</div></div>
        <div class="g-name">${atHome ? 'Retour au cabinet' : esc(nxt.name)}</div>
        <div class="g-sub">${atHome ? `Arrivée prévue ${hm(cur.back.at)} · ${cur.back.travel_min} min de route` : `${esc(nxt.address)} · arrivée prévue ${hm(cur.stops[nextIdx].arrive)}`}</div>
        <a class="btn primary block" href="${waze(atHome ? r.home : nxt)}" target="_blank" rel="noopener">${ic('waze')}Ouvrir Waze vers ${atHome ? 'le cabinet' : esc(nxt.name)}</a>
        ${atHome ? '' : `<button class="btn block" data-done="${nxt.id}">${ic('check')}Visite terminée${nextIdx === len - 1 ? ' · retour au cabinet' : ' · étape suivante'}</button>`}
      </section>` : '';

    const stops = cur.stops.map((s, i) => {
      const a = byId[s.id];
      const cls = [a.done ? 'done' : '', i === nextIdx ? 'now' : '', s.late ? 'late' : ''].join(' ');
      const win = winKind(a);
      const winTxt = { free: '', before: `Avant ${hm(a.win_end)}`, after: `Après ${hm(a.win_start)}`, between: `${hm(a.win_start)}–${hm(a.win_end)}`, fixed: `À ${hm(a.win_start)}` }[win];
      return `
        <div class="leg">${ic('car')}${s.travel_min} min · ${km(s.travel_km)}${i === 0 ? ' depuis le cabinet' : ''}${s.wait ? ` <span class="w">· ${dl(s.wait)} d'attente</span>` : ''}</div>
        <article class="card stop ${cls}">
          <div class="s-time"><span class="num">${a.done ? '✓' : i + 1}</span><br>${hm(s.arrive)}<small>fin ${hm(s.end)}</small></div>
          <div>
            <div class="row"><span class="name">${esc(a.name)}</span><span class="when">${dl(a.duration_min)} sur place</span></div>
            <div class="addr">${esc(a.address)}${a.phone ? ` · ${fmtPhone(a.phone)}` : ''}</div>
            <div class="tags">
              ${diagList(a.diagnostics).map((d) => `<span class="tag">${esc(d)}</span>`).join('')}
              ${winTxt ? `<span class="tag amber">${winTxt}</span>` : ''}
              ${a.call_id ? '<span class="tag green">Pris par l\'agent</span>' : ''}
              ${s.late ? `<span class="tag red">${dl(s.late)} de retard</span>` : ''}
              ${far(a) ? `<span class="tag red">Adresse à vérifier · ${far(a)} km du cabinet</span>` : ''}
              ${a.done ? '<span class="tag leaf">Fait</span>' : ''}
            </div>
            ${a.notes ? `<p class="addr" style="margin:8px 0 0">${esc(a.notes)}</p>` : ''}
            <div class="actions">
              <a class="btn primary sm" href="${waze(a)}" target="_blank" rel="noopener">${ic('waze')}Waze</a>
              ${a.phone ? `<a class="btn sm" href="tel:${esc(a.phone)}">${ic('phone')}Appeler</a>` : ''}
              <button class="btn sm icon" data-edit="${a.id}" aria-label="Modifier ${esc(a.name)}">${ic('edit')}</button>
            </div>
          </div>
        </article>`;
    }).join('') + (len ? `<div class="leg">${ic('car')}${cur.back.travel_min} min · ${km(cur.back.travel_km)} · retour au cabinet à ${hm(cur.back.at)}</div>` : '');

    const startOpts = []; for (let m = 390; m <= 600; m += 15) startOpts.push(m);
    const gmaps = `https://www.google.com/maps/dir/?api=1&origin=${r.home.lat},${r.home.lon}&destination=${r.home.lat},${r.home.lon}&waypoints=${cur.stops.filter((s) => !byId[s.id].done).map((s) => `${byId[s.id].lat},${byId[s.id].lon}`).join('%7C')}&travelmode=driving`;

    body.innerHTML = `
      <div class="stats four">
        <div class="stat card"><span class="stat-num" data-roll="${len}"></span><span class="stat-label">Rendez-vous</span></div>
        <div class="stat card"><span class="stat-num" data-roll="${km(cur.km)}"></span><span class="stat-label">Kilomètres</span></div>
        <div class="stat card"><span class="stat-num" data-roll="${cur.drive_min < 60 ? `${cur.drive_min} min` : `${Math.floor(cur.drive_min / 60)} h ${pad(cur.drive_min % 60)}`}"></span><span class="stat-label">Temps de route</span></div>
        <div class="stat card"><span class="stat-num" data-roll="${len ? hm(cur.back.at) : '–'}"></span><span class="stat-label">Retour au cabinet</span></div>
      </div>
      ${banner}
      ${len ? '<div id="mapSlot"></div>' : ''}
      <div class="ctrls">
        <div class="seg" id="modeSeg"><button class="${state.mode === 'opt' ? 'on' : ''}" data-mode="opt">Ordre optimisé</button><button class="${state.mode === 'ent' ? 'on' : ''}" data-mode="ent">Ordre de saisie</button></div>
        <label class="pill">Départ <select id="startSel">${startOpts.map((m) => `<option value="${m}" ${m === r.start ? 'selected' : ''}>${hm(m)}</option>`).join('')}</select></label>
      </div>
      ${farList.length ? `<div class="banner bad">${farList.length > 1 ? 'Des adresses semblent' : 'Une adresse semble'} très loin du cabinet, sûrement la mauvaise ville : ${farList.map((a) => `<a href="#" data-edit="${a.id}" style="color:inherit;font-weight:600">${esc(a.name)} (${esc(a.address)})</a>`).join(', ')}. Touchez pour corriger : les kilomètres et temps de route seront recalculés.</div>` : ''}
      ${missing.length ? `<div class="banner bad">Adresse introuvable pour : ${missing.map((a) => `<a href="#" data-edit="${a.id}" style="color:inherit;font-weight:600">${esc(a.name)}</a>`).join(', ')}. Corrigez-la pour l'ajouter à la tournée.</div>` : ''}
      ${guide}
      <div>${stops}</div>
      <div class="list" style="margin-top:14px">
        ${addBtn.replace('class="btn primary"', 'class="btn block"')}
        ${len ? `<a class="btn block" href="${gmaps}" target="_blank" rel="noopener">${ic('map')}Toute la tournée sur Google Maps</a>` : ''}
      </div>
      <p class="note">${p.source === 'estimation' ? 'Temps de route estimés (service de trajets momentanément indisponible).' : 'Temps de route calculés sur les vraies routes, hors trafic.'} Waze ne guide que vers une destination à la fois : touchez « Visite terminée » pour passer à la suivante.</p>`;

    $$('#routeBody [data-roll]').forEach((el) => rollTo(el, el.dataset.roll));
    rollBtn($('#routeBody [data-done]'), [$('#routeBody [data-done]')?.innerHTML, `${SPIN}Enregistrement…`, `${ic('check')}Visite terminée`]);
    if (len) { $('#mapSlot').replaceWith(mapBox); drawMap(r.home, cur, byId); }
  }

  $('#routeBody').addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-add]')) return openApptForm();
    if (t.closest('[data-go]')) return show(t.closest('[data-go]').dataset.go);
    const ed = t.closest('[data-edit]');
    if (ed) { e.preventDefault(); const a = state.route.appointments.find((x) => x.id === Number(ed.dataset.edit)); if (a) openApptForm({ appt: a }); return; }
    const m = t.closest('[data-mode]');
    if (m) { state.mode = m.dataset.mode; renderRoute(); return; }
    const d = t.closest('[data-done]');
    if (d) {
      d.disabled = true; d.dataset.s = '1';
      const ok = await api(`/appointments/${d.dataset.done}`, { method: 'PATCH', body: { done: true } }).then(() => true, (err) => { toast(err.message); return false; });
      if (ok) { d.dataset.s = '2'; await wait(750); } else d.dataset.s = '0';
      await loadRoute();
      loadCalls({ silent: true }).catch(() => {});
      $('.guide')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
  $('#routeBody').addEventListener('change', (e) => { if (e.target.id === 'startSel') { state.start = Number(e.target.value); loadRoute(); } });
  $('#dayPrev').addEventListener('click', () => { state.day = addDays(state.day, -1); loadRoute(); });
  $('#dayNext').addEventListener('click', () => { state.day = addDays(state.day, 1); loadRoute(); });
  // Calendrier du mois : les jours avec des rendez-vous sont marqués
  async function openCalendar(month = state.day.slice(0, 7)) {
    let rows = [];
    try { rows = await api(`/appointments/month?month=${month}`); } catch (err) { toast(err.message); }
    const counts = Object.fromEntries(rows.map((r) => [r.day, r]));
    const [y, mo] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, mo - 1, 1)), nDays = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7;
    const label = first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const shift = (k) => { const d = new Date(Date.UTC(y, mo - 1 + k, 1)); return d.toISOString().slice(0, 7); };
    const total = rows.reduce((t, r) => t + r.n, 0);
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let d = 1; d <= nDays; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`, c = counts[iso];
      const cls = [iso === todayIso() ? 'today' : '', iso === state.day ? 'sel' : '', c ? 'has' : '', c && c.done === c.n ? 'alldone' : ''].join(' ');
      cells += `<button type="button" class="cal-d ${cls}" data-day="${iso}"><b>${d}</b>${c ? `<i>${c.n}</i>` : ''}</button>`;
    }
    openSheet('Calendrier', total ? `${total} rendez-vous ce mois-ci` : 'Aucun rendez-vous ce mois-ci', `
      <div class="cal-head"><button type="button" class="btn icon" data-m="${shift(-1)}" aria-label="Mois précédent">${ic('left')}</button><b>${label.replace(/^./, (x) => x.toUpperCase())}</b><button type="button" class="btn icon" data-m="${shift(1)}" aria-label="Mois suivant">${ic('right')}</button></div>
      <div class="cal-grid cal-wd">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <p class="muted" style="font-size:13px;margin:12px 2px 0">Le chiffre indique le nombre de rendez-vous. En vert : tous terminés.</p>
      <button type="button" class="btn" data-day="${todayIso()}" style="width:100%;margin-top:12px">Aujourd'hui</button>`);
    $('#shBody').onclick = (e) => {
      const m = e.target.closest('[data-m]'); if (m) return openCalendar(m.dataset.m);
      const d = e.target.closest('[data-day]'); if (d) { state.day = d.dataset.day; closeSheet(); $('#shBody').onclick = null; loadRoute(); }
    };
  }
  $('#dayPick').addEventListener('click', () => openCalendar());
  $('#dayInput').addEventListener('change', (e) => { if (e.target.value) { state.day = e.target.value; loadRoute(); } });

  // =====================================================================
  // DEVIS
  // =====================================================================
  const QST = { a_valider: 'À valider', envoye: 'Envoyé', accepte: 'Accepté', refuse: 'Refusé' };
  const QDIAGS = ['DPE', 'Amiante', 'Plomb', 'Électricité', 'Gaz', 'Termites', 'Carrez', 'Boutin', 'ERP', 'Audit énergétique'];
  const eur = (n) => `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const num = (v) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  function qTotals(lines, discount, tva) {
    const sub = lines.reduce((s, l) => s + num(l.qty) * num(l.unit_ht), 0);
    const disc = Math.round(sub * num(discount)) / 100, ht = Math.round((sub - disc) * 100) / 100, t = Math.round(ht * num(tva)) / 100;
    return { sub, disc, ht, tva: t, ttc: ht + t };
  }

  async function loadQuoteSettings() { state.qsettings = await api('/quote-settings'); return state.qsettings; }
  async function loadQuotes({ silent } = {}) {
    if (!silent && !state.quotes) $('#quoteList').innerHTML = skeletons(2);
    const [list] = await Promise.all([api('/quotes'), state.qsettings ? null : loadQuoteSettings()]);
    state.quotes = list;
    renderActivity();
    const todo = list.filter((x) => x.status === 'a_valider').length;
    $('#qBadge').hidden = !todo; $('#qBadge').textContent = todo;
    if (!state.qfilter) state.qfilter = todo ? 'a_valider' : 'all';
    renderQuotes();
  }
  function renderQuotes() {
    const list = state.quotes || [];
    const todo = list.filter((x) => x.status === 'a_valider').length;
    $('#qSub').textContent = todo ? `${todo} à valider` : list.length ? 'Tout est à jour' : '';
    $('#qBanner').innerHTML = state.qsettings && !state.qsettings.configured
      ? `<div class="banner">Les devis sont calculés avec des tarifs d'exemple. Renseignez les vôtres pour que l'agent prépare des devis justes.<br><button class="btn primary sm" data-tariffs>${ic('euro')}Saisir mes tarifs</button></div>` : '';
    $$('#qChips .chip').forEach((b) => {
      const n = b.dataset.q === 'all' ? list.length : list.filter((x) => x.status === b.dataset.q).length;
      b.classList.toggle('on', b.dataset.q === state.qfilter);
      b.textContent = `${{ a_valider: 'À valider', envoye: 'Envoyés', accepte: 'Acceptés', refuse: 'Refusés', all: 'Tous' }[b.dataset.q]}${n ? ` · ${n}` : ''}`;
    });
    const qs = (state.qq || '').trim().toLowerCase();
    const shown = list.filter((x) => (state.qfilter === 'all' || x.status === state.qfilter)
      && (!qs || [x.customer_name, x.customer_email, x.customer_phone, x.address, x.number, x.diagnostics, String(x.total_ttc ?? '')].some((v) => (v || '').toLowerCase().includes(qs))));
    const el = $('#quoteList');
    if (!shown.length) {
      el.innerHTML = `<div class="card empty"><b>${list.length ? 'Aucun devis ici' : 'Aucun devis pour le moment'}</b>${list.length ? (qs ? 'Aucun devis ne correspond à la recherche.' : 'Essayez un autre filtre.') : "Après chaque appel pour des diagnostics, l'agent prépare un devis avec vos tarifs. Il arrive ici, à vérifier avant l'envoi."}</div>`;
      return;
    }
    el.innerHTML = shown.map((x) => `
      <article class="card item ${x.status === 'refuse' ? 'dim' : ''}" data-qid="${x.id}" tabindex="0">
        <div class="row"><span class="name">${esc(x.customer_name || (x.customer_phone ? fmtPhone(x.customer_phone) : 'Client sans nom'))}</span><span class="q-amount">${eur(x.total_ttc)}</span></div>
        <div class="addr">${esc(x.number)} · ${timeAgo(x.created_at)}${x.address ? ` · ${esc(x.address)}` : ''}</div>
        <div class="tags">
          <span class="tag ${x.status === 'accepte' ? 'leaf' : x.status === 'refuse' ? 'red' : x.status === 'envoye' ? 'green' : 'amber'}">${QST[x.status]}</span>
          ${x.source === 'agent' ? '<span class="tag green">Préparé par l\'agent</span>' : ''}
          ${diagList(x.diagnostics).slice(0, 4).map((d) => `<span class="tag">${esc(d)}</span>`).join('')}
          ${x.guessed ? '<span class="tag amber">Diagnostics à confirmer</span>' : ''}
          ${!x.customer_email && x.status === 'a_valider' ? '<span class="tag amber">Pas d\'email</span>' : ''}
        </div>
      </article>`).join('');
  }
  $('#quoteList').addEventListener('click', (e) => { const c = e.target.closest('[data-qid]'); if (c) openQuote(Number(c.dataset.qid)).catch((err) => toast(err.message)); });
  $('#quoteList').addEventListener('keydown', (e) => { const c = e.target.closest('[data-qid]'); if (c && e.key === 'Enter') openQuote(Number(c.dataset.qid)); });
  $('#qChips').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) { state.qfilter = b.dataset.q; renderQuotes(); } });
  $('#qBanner').addEventListener('click', (e) => { if (e.target.closest('[data-tariffs]')) openTariffs(); });
  $('#tariffsBtn').addEventListener('click', () => openTariffs());
  $('#qSearch').addEventListener('input', (e) => { state.qq = e.target.value; renderQuotes(); });
  $('#newQuote').addEventListener('click', () => quoteEditor(null));

  async function openQuote(id) { quoteEditor(await api(`/quotes/${id}`)); }

  function quoteEditor(qt, prefill = {}) {
    const d = qt || { status: 'a_valider', lines: [], discount_pct: 0, tva_rate: state.qsettings?.tva_rate ?? 20, ...prefill };
    let lines = (d.lines || []).map((l) => ({ ...l }));
    let ptype = d.property_type || '', trans = d.transaction || '';
    const chosen = new Set(diagList(d.diagnostics));
    const meta = qt ? `${d.number} · ${QST[d.status]}${d.source === 'agent' ? " · préparé par l'agent" : ''}` : 'Nouveau devis';
    openSheet(qt ? (d.customer_name || 'Devis') : 'Nouveau devis', meta, `
      <form class="form" id="qForm" autocomplete="off">
        ${d.guessed ? '<div class="banner" style="margin:0">Le client n\'a pas cité ses diagnostics : la liste a été déduite du bien (vente ou location, année). Vérifiez-la avant l\'envoi.</div>' : ''}
        <div class="card group">
          <label class="field"><span>Client</span><input name="customer_name" value="${esc(d.customer_name || '')}" placeholder="Nom du client" /></label>
          <label class="field"><span>Email (pour l'envoi)</span><input name="customer_email" type="email" inputmode="email" value="${esc(d.customer_email || '')}" placeholder="client@email.fr" /></label>
          <label class="field"><span>Téléphone</span><input name="customer_phone" type="tel" value="${esc(d.customer_phone ? fmtPhone(d.customer_phone) : '')}" /></label>
          <label class="field"><span>Adresse du bien</span><input name="address" value="${esc(d.address || '')}" placeholder="Numéro, rue, ville" /><div class="sugg" hidden></div></label>
        </div>
        <div class="card group">
          <div class="field"><span>Bien</span><div class="seg" id="qType">${['appartement', 'maison', 'local'].map((k) => `<button type="button" data-v="${k}" class="${ptype === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
          <div class="field"><span>Projet</span><div class="seg" id="qTrans">${['vente', 'location', 'travaux'].map((k) => `<button type="button" data-v="${k}" class="${trans === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
          <div class="field mini"><label><span>Surface (m²)</span><input name="surface_m2" inputmode="numeric" value="${esc(d.surface_m2 ?? '')}" /></label><label><span>Année de construction</span><input name="build_year" inputmode="numeric" value="${esc(d.build_year ?? '')}" placeholder="ex. 1975" /></label></div>
          <div class="field"><span>Diagnostics</span><div class="chipset" id="qDiags">${QDIAGS.map((x) => `<button type="button" class="chip ${chosen.has(x) ? 'on' : ''}" data-d="${esc(x)}">${esc(x)}</button>`).join('')}</div>
            <button type="button" class="btn sm" id="qCompute" style="margin-top:10px;align-self:flex-start">${ic('refresh')}Recalculer avec mes tarifs</button></div>
        </div>
        <div class="card group">
          <div class="field"><span>Lignes du devis (prix HT)</span>
            <div class="qhead"><span>Désignation</span><span>Qté</span><span>Prix HT</span><span></span></div>
            <div class="lines" id="qLines"></div>
            <button type="button" class="link" id="qAdd" style="align-self:flex-start">+ Ajouter une ligne</button></div>
          <div class="field mini"><label><span>Remise (%)</span><input name="discount_pct" inputmode="decimal" value="${esc(d.discount_pct ?? 0)}" /></label><label><span>TVA (%)</span><input name="tva_rate" inputmode="decimal" value="${esc(d.tva_rate ?? 20)}" /></label></div>
          <div class="totals"><div id="qTotals"></div><div class="ttc"><span>Total TTC</span><span id="qTTC"></span></div></div>
        </div>
        <div class="card group"><label class="field"><span>Note sur le devis (visible par le client)</span><textarea name="notes" placeholder="Ex. : accès par le garage, clés chez le voisin…">${esc(d.notes || '')}</textarea></label></div>
        <div id="qAlt"></div>
        ${qt ? `<div class="two"><button type="button" class="btn" id="qPreview">${ic('eye')}Aperçu</button>${d.call_id ? `<button type="button" class="btn" id="qCall">${ic('phone')}Voir l'appel</button>` : '<span></span>'}</div>` : ''}
        ${qt && d.status === 'envoye' ? `<div class="section-t" style="margin:4px 6px 0">Réponse du client</div>
          <div class="two"><button type="button" class="btn primary" data-st="accepte">${ic('check')}Accepté</button><button type="button" class="btn danger" data-st="refuse">${ic('x')}Refusé</button></div>` : ''}
        ${qt && (d.status === 'accepte' || d.status === 'refuse') ? `<div class="banner ${d.status === 'refuse' ? 'bad' : ''}" style="margin:0">Devis ${QST[d.status].toLowerCase()}${d.accepted_at && d.status === 'accepte' ? ` le ${new Date(d.accepted_at).toLocaleDateString('fr-FR')}` : ''}. <button type="button" class="link" data-st="envoye">Annuler</button></div>` : ''}
        <div class="sh-foot">
          <button type="button" class="btn primary" id="qSend">${ic('send')}${d.status === 'a_valider' ? 'Valider et envoyer' : 'Renvoyer le devis'}</button>
          <button type="submit" class="btn">Enregistrer</button>
          ${qt && d.status === 'a_valider' ? `<button type="button" class="btn" data-st="refuse">${ic('x')}Refuser</button>` : ''}
          ${qt ? '<button type="button" class="btn danger" id="qDel">Supprimer</button>' : ''}
        </div>
      </form>`);
    const f = $('#qForm');
    autocomplete(f.address);
    const drawLines = () => {
      $('#qLines').innerHTML = lines.map((l, i) => `<div class="qline" data-i="${i}">
          <input data-k="label" value="${esc(l.label)}" aria-label="Désignation" />
          <input data-k="qty" class="r" inputmode="decimal" value="${esc(l.qty)}" aria-label="Quantité" />
          <input data-k="unit_ht" class="r" inputmode="decimal" value="${esc(l.unit_ht)}" aria-label="Prix HT" />
          <button type="button" class="x" data-rm="${i}" aria-label="Retirer la ligne">${ic('x')}</button></div>`).join('') || '<p class="addr" style="margin:0">Aucune ligne. Choisissez des diagnostics puis « Recalculer avec mes tarifs ».</p>';
      drawTotals();
    };
    const drawTotals = () => {
      const t = qTotals(lines, f.discount_pct.value, f.tva_rate.value);
      $('#qTotals').innerHTML = `${t.disc ? `<div><span>Sous-total HT</span><span>${eur(t.sub)}</span></div><div><span>Remise ${num(f.discount_pct.value)} %</span><span>− ${eur(t.disc)}</span></div>` : ''}
        <div><span>Total HT</span><span>${eur(t.ht)}</span></div><div><span>TVA ${num(f.tva_rate.value)} %</span><span>${eur(t.tva)}</span></div>
        `;
      rollTo($('#qTTC'), eur(t.ttc));
    };
    drawLines();
    $('#qLines').addEventListener('input', (e) => {
      const row = e.target.closest('.qline'); if (!row) return;
      const l = lines[Number(row.dataset.i)], k = e.target.dataset.k;
      l[k] = k === 'label' ? e.target.value : e.target.value;
      drawTotals();
    });
    $('#qLines').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { lines.splice(Number(b.dataset.rm), 1); drawLines(); } });
    $('#qAdd').addEventListener('click', () => { lines.push({ label: '', qty: 1, unit_ht: 0 }); drawLines(); $$('#qLines .qline input[data-k=label]').pop()?.focus(); });
    f.discount_pct.addEventListener('input', drawTotals); f.tva_rate.addEventListener('input', drawTotals);
    const segPick = (sel, set) => $(sel).addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      const on = !b.classList.contains('on');
      $$(`${sel} button`).forEach((x) => x.classList.toggle('on', on && x === b));
      set(on ? b.dataset.v : '');
    });
    segPick('#qType', (v) => (ptype = v)); segPick('#qTrans', (v) => (trans = v));
    $('#qDiags').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b) b.classList.toggle('on'); });
    $('#qCompute').addEventListener('click', async () => {
      const diags = $$('#qDiags .chip.on').map((x) => x.dataset.d);
      const r = await api('/quotes/compute', { method: 'POST', body: { diagnostics: diags, property_type: ptype, transaction: trans, surface_m2: f.surface_m2.value, build_year: f.build_year.value } }).catch((err) => toast(err.message));
      if (!r) return;
      if (!r.diagnostics.length) { toast('Choisissez des diagnostics, ou indiquez vente / location'); return; }
      $$('#qDiags .chip').forEach((x) => x.classList.toggle('on', r.diagnostics.includes(x.dataset.d)));
      lines = r.lines; f.discount_pct.value = r.discount_pct; f.tva_rate.value = r.tva_rate;
      drawLines(); toast(r.guessed ? 'Diagnostics déduits du bien, à vérifier' : 'Prix recalculés avec vos tarifs');
    });
    const body = () => ({
      customer_name: f.customer_name.value, customer_email: f.customer_email.value.trim(), customer_phone: f.customer_phone.value, address: f.address.value,
      property_type: ptype || null, transaction: trans || null, surface_m2: f.surface_m2.value, build_year: f.build_year.value,
      diagnostics: $$('#qDiags .chip.on').map((x) => x.dataset.d), lines: lines.map((l) => ({ label: l.label, qty: num(l.qty), unit_ht: num(l.unit_ht) })),
      discount_pct: num(f.discount_pct.value), tva_rate: num(f.tva_rate.value), notes: f.notes.value, call_id: d.call_id || undefined,
    });
    let saved = qt;
    const save = async () => {
      saved = await api(saved ? `/quotes/${saved.id}` : '/quotes', { method: saved ? 'PATCH' : 'POST', body: body() });
      const i = (state.quotes || []).findIndex((x) => x.id === saved.id);
      if (i >= 0) state.quotes[i] = saved; else (state.quotes ||= []).unshift(saved);
      renderQuotes(); loadQuotes({ silent: true }).catch(() => {});
      return saved;
    };
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await save(); closeSheet(); toast('Devis enregistré'); } catch (err) { toast(err.message); }
    });
    $('#qDel')?.addEventListener('click', async () => {
      const b = $('#qDel');
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Confirmer la suppression'; return; }
      await api(`/quotes/${saved.id}`, { method: 'DELETE' });
      state.quotes = (state.quotes || []).filter((x) => x.id !== saved.id);
      closeSheet(); renderQuotes(); loadQuotes({ silent: true }).catch(() => {}); toast('Devis supprimé');
    });
    $('#qPreview')?.addEventListener('click', () => openPreview(`/api/quotes/${d.id}/apercu?t=${encodeURIComponent(token)}`));
    $('#qCall')?.addEventListener('click', () => { show('calls'); openCall(d.call_id).catch((err) => toast(err.message)); });
    // Décision : le devis se range tout seul dans la bonne case
    const classify = async (st) => {
      if (st !== 'envoye' || saved.status !== 'a_valider') saved = await api(`/quotes/${saved.id}`, { method: 'PATCH', body: { status: st } });
      state.qfilter = saved.status;
      closeSheet(); await loadQuotes({ silent: true }).catch(() => {});
      toast(`Classé dans « ${{ a_valider: 'À valider', envoye: 'Envoyés', accepte: 'Acceptés', refuse: 'Refusés' }[saved.status]} »`);
    };
    f.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-st]'); if (!b) return;
      b.disabled = true;
      try { if (b.dataset.st === 'refuse' && saved.status === 'a_valider') await save(); await classify(b.dataset.st); } catch (err) { toast(err.message); b.disabled = false; }
    });
    const publicLink = () => `${location.origin}/d/${saved.token}`;
    const markSent = async () => { if (saved.status === 'a_valider') saved = await api(`/quotes/${saved.id}`, { method: 'PATCH', body: { status: 'envoye' } }); state.qfilter = 'envoye'; loadQuotes({ silent: true }).catch(() => {}); };
    const showAlt = (why) => {
      const phone = saved.customer_phone || '';
      $('#qAlt').innerHTML = `<div class="alt"><p>${esc(why)}</p><div class="actions">
          ${phone ? `<a class="btn sm" id="qSms" href="sms:${esc(phone)}?&body=${encodeURIComponent(`Bonjour, voici votre devis ${saved.number} : ${publicLink()}`)}">${ic('sms')}Envoyer par SMS</a>` : ''}
          <button type="button" class="btn sm" id="qCopy">${ic('link')}Copier le lien du devis</button>
          <button type="button" class="btn sm" id="qMark">${ic('check')}Déjà envoyé</button></div></div>`;
      $('#qAlt').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      $('#qSms')?.addEventListener('click', () => { markSent().catch(() => {}); });
      $('#qMark').addEventListener('click', async () => { await markSent().catch(() => {}); closeSheet(); toast('Classé dans « Envoyés »'); });
      $('#qCopy').addEventListener('click', async () => {
        await markSent().catch(() => {});
        try { await navigator.clipboard.writeText(publicLink()); toast('Lien copié : devis marqué envoyé'); } catch { toast(publicLink()); }
      });
    };
    rollBtn($('#qSend'), [$('#qSend').innerHTML, `${SPIN}Envoi en cours…`, `${ic('check')}Envoyé`]);
    $('#qSend').addEventListener('click', async () => {
      const b = $('#qSend'); b.disabled = true;
      try {
        if (!lines.length) { toast('Ajoutez au moins une ligne'); return; }
        b.dataset.s = '1';
        await save();
        if (!saved.customer_email) { b.dataset.s = '0'; showAlt("Pas d'email pour ce client : envoyez le lien autrement."); return; }
        saved = await api(`/quotes/${saved.id}/send`, { method: 'POST' });
        b.dataset.s = '2'; await wait(900);
        state.qfilter = saved.status;
        closeSheet(); loadQuotes({ silent: true }).catch(() => {}); toast(`Devis envoyé à ${saved.customer_email} · classé dans « Envoyés »`);
      } catch (err) { b.dataset.s = '0'; if (saved) showAlt(`${err.message}. Vous pouvez l'envoyer autrement :`); else toast(err.message); }
      finally { b.disabled = false; }
    });
  }

  async function openTariffs() {
    const s = state.qsettings || (await loadQuoteSettings());
    const co = s.company;
    openSheet('Mes tarifs', "Utilisés par l'agent pour préparer les devis", `
      <form class="form" id="tForm" autocomplete="off">
        <div class="card group" style="padding:8px 14px">
          <table class="prices"><thead><tr><th>Diagnostic (HT)</th><th>Appartement</th><th>Maison</th></tr></thead><tbody>
          ${QDIAGS.map((x) => `<tr><td>${esc(x)}</td><td><input inputmode="decimal" data-d="${esc(x)}" data-k="appartement" value="${s.prices[x]?.appartement ?? ''}" /> €</td><td><input inputmode="decimal" data-d="${esc(x)}" data-k="maison" value="${s.prices[x]?.maison ?? ''}" /> €</td></tr>`).join('')}
          </tbody></table>
        </div>
        <div class="card group">
          <div class="rule">Remise de <input name="pack_pct" inputmode="decimal" value="${s.pack_pct}" /> % dès <input name="pack_min" inputmode="numeric" value="${s.pack_min}" /> diagnostics</div>
          <div class="rule">Au-delà de <input name="large_m2" inputmode="numeric" value="${s.large_m2}" /> m² : + <input name="large_pct" inputmode="decimal" value="${s.large_pct}" /> %</div>
          <div class="rule">Frais de déplacement <input name="travel_fee" inputmode="decimal" value="${s.travel_fee}" /> € HT</div>
          <div class="rule">TVA <input name="tva_rate" inputmode="decimal" value="${s.tva_rate}" /> % · devis valable <input name="validity_days" inputmode="numeric" value="${s.validity_days}" /> jours</div>
        </div>
        <div class="section-t" style="margin:6px 6px 0">Votre société (en-tête du devis)</div>
        <div class="card group">
          <label class="field"><span>Raison sociale</span><input name="legal_name" value="${esc(co.legal_name)}" placeholder="${esc(state.me?.name || '')}" /></label>
          <label class="field"><span>SIRET</span><input name="siret" value="${esc(co.siret)}" /></label>
          <label class="field"><span>Adresse</span><input name="caddress" value="${esc(co.address)}" /></label>
          <label class="field"><span>Téléphone</span><input name="cphone" type="tel" value="${esc(co.phone)}" /></label>
          <label class="field"><span>Email (réponses des clients)</span><input name="cemail" type="email" value="${esc(co.email)}" /></label>
          <label class="field"><span>Mentions en bas du devis</span><textarea name="mentions" placeholder="Assurance RCP, certifications, conditions de paiement…">${esc(co.mentions)}</textarea></label>
        </div>
        <button type="submit" class="btn primary block">Enregistrer mes tarifs</button>
      </form>`);
    $('#tForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, prices = {};
      $$('#tForm .prices input').forEach((i) => { (prices[i.dataset.d] ||= {})[i.dataset.k] = i.value; });
      const g = (n) => f.elements[n].value;
      try {
        state.qsettings = await api('/quote-settings', { method: 'PUT', body: {
          prices, pack_pct: g('pack_pct'), pack_min: g('pack_min'), large_m2: g('large_m2'), large_pct: g('large_pct'), travel_fee: g('travel_fee'), tva_rate: g('tva_rate'), validity_days: g('validity_days'),
          company: { legal_name: g('legal_name'), siret: g('siret'), address: g('caddress'), phone: g('cphone'), email: g('cemail'), mentions: g('mentions') },
        } });
        closeSheet(); renderQuotes(); toast('Tarifs enregistrés');
      } catch (err) { toast(err.message); }
    });
  }

  // =====================================================================
  // RÉGLAGES
  // =====================================================================
  function fillSettings() {
    const me = state.me; if (!me) return;
    $('#setSub').textContent = me.name;
    $('#setHome').value = me.home_address || '';
    $('#setEmail').value = me.email || '';
    const sel = $('#setStart');
    if (!sel.options.length) for (let m = 390; m <= 600; m += 15) sel.add(new Option(hm(m), m));
    sel.value = String(me.day_start);
    $('#setNumber').textContent = me.agent_number ? fmtPhone(me.agent_number) : 'Pas encore attribué';
  }
  autocomplete($('#setHome'));
  $('#setForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
    try {
      state.me = await api('/me', { method: 'PATCH', body: { home_address: $('#setHome').value, email: $('#setEmail').value, day_start: Number($('#setStart').value) } });
      state.start = null; state.route = null;
      fillSettings(); toast('Réglages enregistrés');
    } catch (err) { toast(err.message); }
    btn.disabled = false;
  });

  // ---------- Démarrage ----------
  function initials(name) {
    const w = String(name).replace(/\b(cabinet|sarl|sas|eurl|le|la|les|de|du|des|et)\b/gi, ' ').split(/\s+/).filter(Boolean);
    return ((w[0]?.[0] || name[0] || 'D') + (w[1]?.[0] || '')).toUpperCase();
  }
  (async () => {
    if (!token) return showGate();
    $('#app').hidden = false; $('#tabbar').hidden = false;
    window.DiagoUI && DiagoUI.initNav();
    try {
      state.me = await api('/me');
      $('#clientName').textContent = state.me.name;
      $('#live').hidden = false;
      $('#live').classList.toggle('off', !state.me.agent_number);
      $('#liveTxt').textContent = state.me.agent_number ? 'Agent actif' : 'Agent pas encore branché';
      document.title = `Diago · ${state.me.name}`;
      const h = location.hash;
      if (h === '#tournee') show('route'); else if (h === '#devis') show('quotes'); else if (h === '#reglages') show('settings'); else show('calls');
      await loadCalls();
      const m = /^#call-(\d+)$/.exec(h);
      if (m) openCall(Number(m[1])).catch(() => {});
    } catch (err) {
      if (err.message !== '401') $('#callList').innerHTML = `<div class="card empty"><b>Connexion impossible</b>Vérifiez votre réseau puis touchez Actualiser.</div>`;
    }
    setInterval(() => { if (!document.hidden && state.me) loadCalls({ silent: true }).catch(() => {}); }, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.me) loadCalls({ silent: true }).catch(() => {}); });
  })();
})();
