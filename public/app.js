(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ic = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;

  // ---------- Accès par lien personnel (?t=...) ----------
  const params = new URLSearchParams(location.search);
  let token = params.get('t');
  try {
    if (token) localStorage.setItem('diago_token', token);
    else token = localStorage.getItem('diago_token');
  } catch {}
  if (params.get('t')) history.replaceState(null, '', location.pathname + location.hash);

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
  const STATUS = { a_rappeler: 'À rappeler', rappele: 'Rappelé', rdv_pris: 'RDV pris', termine: 'Terminé' };
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
  const state = { me: null, view: 'calls', calls: [], known: new Set(), filter: 'all', q: '', day: todayIso(), start: null, mode: 'opt', route: null, callId: null };

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
    if (/^#call-/.test(location.hash)) history.replaceState(null, '', location.pathname);
  }
  $('#overlay').addEventListener('click', closeSheet);
  $('#shClose').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

  function showGate(msg) {
    $('#app').hidden = true; $('#tabbar').hidden = true; $('#gate').hidden = false;
    if (msg) $('#gateMsg').textContent = msg;
  }

  // ---------- Navigation ----------
  const HASH = { calls: '#appels', route: '#tournee', settings: '#reglages' };
  function show(view) {
    state.view = view;
    for (const v of ['calls', 'route', 'settings']) $(`#v-${v}`).hidden = v !== view;
    $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    if (!/^#call-/.test(location.hash) || view !== 'calls') history.replaceState(null, '', HASH[view]);
    if (view === 'route') loadRoute();
    if (view === 'settings') fillSettings();
    window.scrollTo({ top: 0 });
  }
  $('#tabbar').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) show(b.dataset.view); });
  $('#avatar').addEventListener('click', () => show('settings'));
  $('#refreshBtn').addEventListener('click', async () => {
    if (state.view === 'route') await loadRoute(); else await loadCalls({ silent: true });
    toast('À jour');
  });

  // =====================================================================
  // APPELS
  // =====================================================================
  function visibleCalls() {
    const q = state.q.trim().toLowerCase();
    return state.calls.filter((c) => {
      if (state.filter === 'urgent' && !(c.urgency === 'haute' && c.status === 'a_rappeler')) return false;
      if (STATUS[state.filter] && c.status !== state.filter) return false;
      if (q && ![c.caller_name, c.caller_number, c.summary, c.address, c.diagnostics].some((v) => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }
  function renderCalls() {
    const list = visibleCalls(), el = $('#callList');
    if (!list.length) {
      el.innerHTML = `<div class="card empty"><b>${state.calls.length ? 'Aucun appel ici' : 'Aucun appel pour le moment'}</b>${state.calls.length ? 'Essayez un autre filtre.' : 'Les appels que vous ne pouvez pas prendre arriveront ici, résumés et triés.'}</div>`;
      return;
    }
    el.innerHTML = list.map((c) => `
      <article class="card item ${c.status === 'termine' ? 'dim' : ''}" data-id="${c.id}" tabindex="0">
        <div class="row"><span class="dot ${c.urgency}" title="${URG[c.urgency]}"></span><span class="name">${esc(c.caller_name || fmtPhone(c.caller_number))}</span><span class="when">${timeAgo(c.started_at)}</span></div>
        <p class="sum">${esc(c.summary)}</p>
        <div class="tags">
          ${c.urgency === 'haute' ? '<span class="tag red">Urgent</span>' : ''}
          ${c.request_type !== 'urgence' ? `<span class="tag">${TYPE[c.request_type] || 'Appel'}</span>` : ''}
          ${diagList(c.diagnostics).slice(0, 3).map((d) => `<span class="tag">${esc(d)}</span>`).join('')}
          ${c.callback_before ? `<span class="tag amber">Rappeler ${esc(c.callback_before)}</span>` : ''}
          ${c.address ? `<span class="tag">${esc(c.address)}</span>` : ''}
          ${c.status !== 'a_rappeler' ? `<span class="tag ${c.status === 'rdv_pris' ? 'leaf' : ''}">${STATUS[c.status]}</span>` : ''}
        </div>
        ${c.status === 'a_rappeler' ? `<div class="actions">
          ${c.caller_number ? `<a class="btn primary sm" href="tel:${esc(c.caller_number)}" data-stop>${ic('phone')}Rappeler</a>` : ''}
          <button class="btn sm" data-quick="rappele" data-stop>${ic('check')}Fait</button>
        </div>` : ''}
      </article>`).join('');
  }
  async function loadStats() {
    const s = await api('/stats');
    $('#sTodo').textContent = s.a_rappeler; $('#sUrgent').textContent = s.urgents; $('#sToday').textContent = s.aujourdhui;
    $('#badge').hidden = !s.a_rappeler; $('#badge').textContent = s.a_rappeler;
  }
  async function loadCalls({ silent } = {}) {
    if (!silent && !state.calls.length) $('#callList').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    const calls = await api('/calls');
    const fresh = state.known.size ? calls.filter((c) => !state.known.has(c.id)) : [];
    calls.forEach((c) => state.known.add(c.id));
    state.calls = calls;
    renderCalls();
    loadStats().catch(() => {});
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
    toast(`Marqué « ${STATUS[status]} »`);
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
      <button class="btn block" id="planBtn" style="margin-bottom:10px">${ic('cal')}Planifier un rendez-vous</button>
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
    $('#planBtn').addEventListener('click', () => openApptForm({ prefill: {
      name: c.caller_name || '', phone: c.caller_number || '', address: c.address || '', diagnostics: diagList(c.diagnostics), call_id: c.id,
      day: state.day >= todayIso() ? state.day : todayIso(),
    } }));
  }

  $('#callList').addEventListener('click', (e) => {
    const card = e.target.closest('.item'); if (!card) return;
    const quick = e.target.closest('[data-quick]');
    if (quick) { e.preventDefault(); setStatus(Number(card.dataset.id), quick.dataset.quick); return; }
    if (e.target.closest('[data-stop]')) return;
    openCall(Number(card.dataset.id)).catch((err) => toast(err.message));
  });
  $('#callList').addEventListener('keydown', (e) => { const c = e.target.closest('.item'); if (c && e.key === 'Enter') openCall(Number(c.dataset.id)); });
  $('#chips').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) setFilter(b.dataset.filter); });
  $$('.stat[data-filter]').forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.filter)));
  $('#search').addEventListener('input', (e) => { state.q = e.target.value; renderCalls(); });

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
      closeSheet(); loadRoute();
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
        <div class="stat card"><span class="stat-num">${len}</span><span class="stat-label">Rendez-vous</span></div>
        <div class="stat card"><span class="stat-num">${km(cur.km)}</span><span class="stat-label">Kilomètres</span></div>
        <div class="stat card"><span class="stat-num">${dl(cur.drive_min)}</span><span class="stat-label">Temps de route</span></div>
        <div class="stat card"><span class="stat-num">${len ? hm(cur.back.at) : '–'}</span><span class="stat-label">Retour au cabinet</span></div>
      </div>
      ${banner}
      ${len ? '<div id="mapSlot"></div>' : ''}
      <div class="ctrls">
        <div class="seg" id="modeSeg"><button class="${state.mode === 'opt' ? 'on' : ''}" data-mode="opt">Ordre optimisé</button><button class="${state.mode === 'ent' ? 'on' : ''}" data-mode="ent">Ordre de saisie</button></div>
        <label class="pill">Départ <select id="startSel">${startOpts.map((m) => `<option value="${m}" ${m === r.start ? 'selected' : ''}>${hm(m)}</option>`).join('')}</select></label>
      </div>
      ${missing.length ? `<div class="banner bad">Adresse introuvable pour : ${missing.map((a) => `<a href="#" data-edit="${a.id}" style="color:inherit;font-weight:600">${esc(a.name)}</a>`).join(', ')}. Corrigez-la pour l'ajouter à la tournée.</div>` : ''}
      ${guide}
      <div>${stops}</div>
      <div class="list" style="margin-top:14px">
        ${addBtn.replace('class="btn primary"', 'class="btn block"')}
        ${len ? `<a class="btn block" href="${gmaps}" target="_blank" rel="noopener">${ic('map')}Toute la tournée sur Google Maps</a>` : ''}
      </div>
      <p class="note">${p.source === 'estimation' ? 'Temps de route estimés (service de trajets momentanément indisponible).' : 'Temps de route calculés sur les vraies routes, hors trafic.'} Waze ne guide que vers une destination à la fois : touchez « Visite terminée » pour passer à la suivante.</p>`;

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
      d.disabled = true;
      await api(`/appointments/${d.dataset.done}`, { method: 'PATCH', body: { done: true } }).catch((err) => toast(err.message));
      await loadRoute();
      $('.guide')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
  $('#routeBody').addEventListener('change', (e) => { if (e.target.id === 'startSel') { state.start = Number(e.target.value); loadRoute(); } });
  $('#dayPrev').addEventListener('click', () => { state.day = addDays(state.day, -1); loadRoute(); });
  $('#dayNext').addEventListener('click', () => { state.day = addDays(state.day, 1); loadRoute(); });
  $('#dayPick').addEventListener('click', () => { const i = $('#dayInput'); try { i.showPicker(); } catch { i.focus(); i.click(); } });
  $('#dayInput').addEventListener('change', (e) => { if (e.target.value) { state.day = e.target.value; loadRoute(); } });

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
    try {
      state.me = await api('/me');
      $('#clientName').textContent = state.me.name;
      $('#avatar').textContent = initials(state.me.name);
      document.title = `Diago · ${state.me.name}`;
      const h = location.hash;
      if (h === '#tournee') show('route'); else if (h === '#reglages') show('settings'); else show('calls');
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
