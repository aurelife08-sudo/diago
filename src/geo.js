// Adresses → coordonnées, temps de route réels et ordre de tournée optimal.
const GEOCODER = process.env.GEOCODER_URL || 'https://data.geopf.fr/geocodage/search';
const OSRM = (process.env.OSRM_URL || 'https://router.project-osrm.org').replace(/\/$/, '');

/**
 * Suggestions d'adresses (France). Avec `near` ({lat, lon} du cabinet), les adresses proches
 * passent devant : « 3 rue Saint-Charles » donne celle du secteur, pas celle de l'Essonne.
 */
export async function geocode(text, limit = 5, near = null) {
  if (!text || text.trim().length < 3) return [];
  try {
    const bias = near && near.lat != null ? `&lat=${near.lat}&lon=${near.lon}` : '';
    const url = `${GEOCODER}?q=${encodeURIComponent(text.trim())}&limit=${Math.max(limit, 8)}${bias}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    let list = (data.features || []).map((f) => ({
      label: f.properties.label,
      city: f.properties.city,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      score: f.properties.score,
    }));
    if (near && near.lat != null) {
      list.forEach((g) => (g.km = Math.round(haversineKm(near, g))));
      // Proche du cabinet (< 120 km) d'abord, puis par pertinence
      list.sort((a, b) => (a.km > 120) - (b.km > 120) || b.score - a.score);
    }
    return list.slice(0, limit);
  } catch (err) {
    console.warn('[geo] géocodage impossible :', err.message);
    return [];
  }
}

const R = Math.PI / 180;
function haversineKm(a, b) {
  const dLa = (b.lat - a.lat) * R, dLo = (b.lon - a.lon) * R;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Matrice des temps (min) et distances (km) entre tous les points. */
async function matrix(points) {
  const n = points.length;
  try {
    const coords = points.map((p) => `${p.lon},${p.lat}`).join(';');
    const res = await fetch(`${OSRM}/table/v1/driving/${coords}?annotations=duration,distance`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (d.code !== 'Ok') throw new Error(d.code);
    return {
      source: 'routes',
      min: d.durations.map((r) => r.map((s) => Math.max(0, Math.round((s ?? 0) / 60)))),
      km: d.distances.map((r) => r.map((m) => (m ?? 0) / 1000)),
    };
  } catch (err) {
    console.warn('[geo] temps de route indisponibles, estimation à vol d\'oiseau :', err.message);
    const km = points.map((a) => points.map((b) => haversineKm(a, b) * 1.35));
    return { source: 'estimation', km, min: km.map((r) => r.map((k) => (k ? Math.max(1, Math.round(k / 50 * 60)) : 0))) };
  }
}

/** Tracé de la route (GeoJSON) dans l'ordre donné. */
async function geometry(points) {
  if (points.length < 2) return null;
  try {
    const coords = points.map((p) => `${p.lon},${p.lat}`).join(';');
    const res = await fetch(`${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    return d.routes?.[0]?.geometry || null;
  } catch {
    return null;
  }
}

// ---------- Planification ----------
// Points : 0 = cabinet, i = rendez-vous i (1..n). Les RDV faits restent en tête, dans l'ordre où ils ont été faits.
function schedule(order, appts, M, start) {
  let t = start, prev = 0, km = 0, drive = 0, late = 0, wait = 0;
  const stops = order.map((i) => {
    const a = appts[i - 1];
    const tt = M.min[prev][i], d = M.km[prev][i];
    let arrive = t + tt, w = 0;
    if (a.win_start != null && arrive < a.win_start) { w = a.win_start - arrive; arrive = a.win_start; }
    const lateBy = a.win_end != null && arrive > a.win_end ? arrive - a.win_end : 0;
    late += lateBy; wait += w; km += d; drive += tt;
    t = arrive + a.duration_min; prev = i;
    return { id: a.id, travel_min: tt, travel_km: Math.round(d * 10) / 10, arrive, end: t, wait: w, late: lateBy };
  });
  const bt = order.length ? M.min[prev][0] : 0, bd = order.length ? M.km[prev][0] : 0;
  km += bd; drive += bt;
  return {
    order, stops, km: Math.round(km * 10) / 10, drive_min: drive, late_min: late, wait_min: wait,
    late_count: stops.filter((s) => s.late).length,
    back: { travel_min: bt, travel_km: Math.round(bd * 10) / 10, at: t + bt },
  };
}
const cost = (s) => s.drive_min + s.late_min * 100 + s.wait_min * 0.3;

function optimize(fixed, free, appts, M, start) {
  let best = schedule([...fixed, ...free], appts, M, start), bc = cost(best);
  if (free.length <= 8) {
    const used = free.map(() => false), cur = [];
    (function rec() {
      if (cur.length === free.length) {
        const s = schedule([...fixed, ...cur], appts, M, start), c = cost(s);
        if (c < bc) { bc = c; best = s; }
        return;
      }
      for (let k = 0; k < free.length; k++) if (!used[k]) { used[k] = true; cur.push(free[k]); rec(); cur.pop(); used[k] = false; }
    })();
    return best;
  }
  // Beaucoup de visites : plus proche voisin puis amélioration 2-opt
  const left = free.slice(), nn = [];
  let prev = fixed.length ? fixed[fixed.length - 1] : 0;
  while (left.length) {
    left.sort((a, b) => M.min[prev][a] - M.min[prev][b]);
    prev = left.shift(); nn.push(prev);
  }
  let curOrder = nn, curS = schedule([...fixed, ...nn], appts, M, start), improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < curOrder.length - 1; i++) {
      for (let j = i + 1; j < curOrder.length; j++) {
        const cand = [...curOrder.slice(0, i), ...curOrder.slice(i, j + 1).reverse(), ...curOrder.slice(j + 1)];
        const s = schedule([...fixed, ...cand], appts, M, start);
        if (cost(s) < cost(curS)) { curOrder = cand; curS = s; improved = true; }
      }
    }
  }
  return cost(curS) < bc ? curS : best;
}

/**
 * Calcule la tournée.
 * @param home {lat, lon}
 * @param appts RDV du jour avec lat/lon (ceux sans coordonnées sont ignorés)
 * @param start minute de départ (480 = 8h00)
 */
export async function planDay(home, appts, start) {
  const placed = appts.filter((a) => a.lat != null && a.lon != null);
  const missing = appts.filter((a) => a.lat == null || a.lon == null).map((a) => a.id);
  const empty = { stops: [], km: 0, drive_min: 0, late_count: 0, wait_min: 0, back: null, geometry: null };
  if (!placed.length) return { source: 'none', missing, optimized: empty, entered: empty };

  const points = [home, ...placed];
  const M = await matrix(points);
  const idx = new Map(placed.map((a, i) => [a.id, i + 1]));
  const done = placed.filter((a) => a.done).sort((a, b) => new Date(a.done_at || 0) - new Date(b.done_at || 0)).map((a) => idx.get(a.id));
  const todo = placed.filter((a) => !a.done).map((a) => idx.get(a.id));

  const asEntered = schedule([...done, ...todo], placed, M, start);
  const best = optimize(done, todo, placed, M, start);
  const geom = await geometry([home, ...best.order.map((i) => placed[i - 1]), home]);
  const geomEntered = await geometry([home, ...asEntered.order.map((i) => placed[i - 1]), home]);

  const strip = (s, g) => ({ stops: s.stops, km: s.km, drive_min: s.drive_min, late_count: s.late_count, wait_min: s.wait_min, back: s.back, geometry: g });
  return { source: M.source, missing, optimized: strip(best, geom), entered: strip(asEntered, geomEntered) };
}
