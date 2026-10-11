import { defaultConfig, buildWorld, resolveDoorOffsets, WALLS } from './world.js';
import { PRESETS, COLORS, newVehicle, vehicleModel, syncNextId, bodyObb } from './vehicles.js';
import { parkValid } from './layout.js';
import { headingBin, DTH } from './planner.js';
import { Renderer, fmtFt } from './render.js';
import { parseLength } from './units.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'parking-buddy-config';

// ---------------------------------------------------------------- state

let config = loadConfig();
let world = buildWorld(config);
let result = null; // { ...planLayout result, snap: config used, mode, trials }
let stale = false;
let hoverId = null;
let drag = null;
const openDetails = new Set();

const renderer = new Renderer($('canvas'));
const anim = { playing: false, t: 0, timeline: null, last: 0 };

// ---------------------------------------------------------------- config persistence

function exampleConfig() {
  const c = defaultConfig();
  c.vehicles = ['medium', 'large', 'small'].map((p, i) => newVehicle(p, i));
  return c;
}

function loadConfig() {
  const fromHash = location.hash.startsWith('#c=') ? decodeConfig(location.hash.slice(3)) : null;
  let c = fromHash;
  if (!c) {
    try { c = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { c = null; }
  }
  if (!c || !c.building || !Array.isArray(c.vehicles)) c = exampleConfig();
  const d = defaultConfig();
  c.settings = { ...d.settings, ...c.settings };
  c.obstacles ||= [];
  c.doors ||= [];
  syncNextId(c.vehicles);
  resolveDoorOffsets(c.building, c.doors);
  return c;
}

function saveConfig() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* storage unavailable */ }
}

function encodeConfig(c) {
  const bytes = new TextEncoder().encode(JSON.stringify(c));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeConfig(s) {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- length inputs

const fmtNum = (v) => String(Math.round(v * 100) / 100);

function bindLength(input, get, set, { min = 0, max = 1000 } = {}) {
  input.value = fmtNum(get());
  input.addEventListener('change', () => {
    const v = parseLength(input.value);
    const ok = Number.isFinite(v) && v >= min && v <= max;
    input.classList.toggle('invalid', !ok);
    input.title = ok ? '' : `Enter a length between ${min} and ${max} ft`;
    if (!ok) return;
    set(v);
    input.value = fmtNum(v);
    configChanged();
  });
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

function lengthField(label, get, set, opts) {
  const input = el('input', { class: 'len' });
  bindLength(input, get, set, opts);
  return el('label', {}, label, input);
}

// ---------------------------------------------------------------- forms

function renderForms() {
  bindLength($('b-width'), () => config.building.width, (v) => { config.building.width = v; }, { min: 8, max: 400 });
  bindLength($('b-depth'), () => config.building.depth, (v) => { config.building.depth = v; }, { min: 8, max: 400 });
  for (const k of ['clearance', 'parkGap', 'endGap']) {
    bindLength($(`s-${k}`), () => config.settings[k], (v) => { config.settings[k] = v; }, { min: 0, max: 10 });
  }
  bindLength($('s-apron'), () => config.settings.apron, (v) => { config.settings.apron = v; }, { min: 0, max: 200 });
  for (const k of ['allowAngled', 'requireExit']) {
    const cb = $(`s-${k}`);
    cb.checked = !!config.settings[k];
    cb.onchange = () => { config.settings[k] = cb.checked; configChanged(); };
  }
  renderDoors();
  renderVehicles();
  renderObstacles();
}

function refreshForms() {
  // Rebind everything from scratch (used after reset / load).
  for (const id of ['b-width', 'b-depth', 's-clearance', 's-parkGap', 's-endGap', 's-apron']) {
    const old = $(id);
    const fresh = old.cloneNode();
    old.replaceWith(fresh);
  }
  renderForms();
}

// Offset inputs of the rendered door rows, refreshed when auto offsets move.
let doorOffsetInputs = [];

function renderDoors() {
  const box = $('doors');
  box.replaceChildren();
  doorOffsetInputs = config.doors.map((d, i) => {
    const wall = el('select', {
      onchange: (e) => { d.wall = e.target.value; configChanged(); },
    }, ...WALLS.map((w) => el('option', { value: w, selected: w === d.wall }, w)));
    const offset = el('input', { class: 'len' });
    // Typing an offset takes the door out of automatic placement.
    bindLength(offset, () => d.offset, (v) => { d.offset = v; d.auto = false; autoBox.checked = false; offset.classList.remove('auto'); }, { max: 400 });
    offset.classList.toggle('auto', !!d.auto);
    const autoBox = el('input', { type: 'checkbox', checked: !!d.auto, title: 'Space this door automatically along its wall' });
    autoBox.onchange = () => {
      d.auto = autoBox.checked;
      offset.classList.toggle('auto', d.auto);
      configChanged();
    };
    box.append(el('div', { class: 'door-row' },
      el('label', {}, `Door ${i + 1}`, wall),
      el('div', { class: 'field' },
        el('div', { class: 'field-head' }, el('span', {}, 'Offset'), el('label', { class: 'auto-toggle' }, autoBox, 'auto')),
        offset),
      lengthField('Width', () => d.width, (v) => { d.width = v; }, { min: 1, max: 100 }),
      el('button', { class: 'icon', title: 'Remove door', onclick: () => { config.doors.splice(i, 1); renderDoors(); configChanged(); } }, '✕'),
    ));
    return offset;
  });
}

function refreshDoorOffsets() {
  config.doors.forEach((d, i) => {
    const input = doorOffsetInputs[i];
    if (d.auto && input && document.activeElement !== input) input.value = fmtNum(d.offset);
  });
}

function vehicleById(id) {
  return config.vehicles.find((v) => v.id === id);
}

function describeVehicle(v) {
  return `${fmtFt(v.length)} × ${fmtFt(v.width)} · turning circle ${fmtFt(v.turningCircle)}`;
}

function renderVehicles() {
  const box = $('vehicles');
  box.replaceChildren();
  config.vehicles.forEach((v, i) => {
    const move = (delta) => {
      const j = i + delta;
      if (j < 0 || j >= config.vehicles.length) return;
      [config.vehicles[i], config.vehicles[j]] = [config.vehicles[j], config.vehicles[i]];
      renderVehicles();
      configChanged();
    };
    const color = el('input', { type: 'color', value: v.color, class: 'swatch', title: 'Colour' });
    color.style.padding = '0';
    color.style.width = '22px';
    color.style.height = '22px';
    color.oninput = () => { v.color = color.value; saveConfig(); requestDraw(); renderResults(); };
    const name = el('input', { class: 'name', value: v.name });
    name.onchange = () => { v.name = name.value; saveConfig(); requestDraw(); renderResults(); };

    const pinInfo = v.pin
      ? el('span', {}, el('span', { class: 'pin' }, 'pinned'), ' ',
        el('button', { class: 'icon', title: 'Let the planner choose the spot', onclick: () => { v.pin = null; renderVehicles(); configChanged(); } }, 'unpin'))
      : el('button', {
        class: 'icon', title: 'Pin this vehicle to a spot you choose (then drag it on the plan)',
        onclick: () => { pinVehicle(v); renderVehicles(); configChanged(); },
      }, 'pin');

    const m = vehicleModel(v);
    const details = el('details', {},
      el('summary', {}, 'Dimensions'),
      el('div', { class: 'grid3' },
        lengthField('Length', () => v.length, (x) => { v.length = x; }, { min: 4, max: 60 }),
        lengthField('Width (body)', () => v.width, (x) => { v.width = x; }, { min: 2, max: 12 }),
        lengthField('Width (mirrors)', () => v.mirrorWidth, (x) => { v.mirrorWidth = x; }, { min: 2, max: 14 }),
        lengthField('Wheelbase', () => v.wheelbase, (x) => { v.wheelbase = x; }, { min: 2, max: 40 }),
        lengthField('Front overhang', () => v.frontOverhang, (x) => { v.frontOverhang = x; }, { min: 0, max: 10 }),
        lengthField('Turning circle', () => v.turningCircle, (x) => { v.turningCircle = x; }, { min: 10, max: 120 }),
      ),
      el('p', { class: 'hint' }, `Turning circle is the curb-to-curb diameter from the spec sheet. Gives a minimum rear-axle turning radius of ${fmtFt(m.rMin)}.`),
    );
    details.open = openDetails.has(v.id);
    details.ontoggle = () => (details.open ? openDetails.add(v.id) : openDetails.delete(v.id));

    box.append(el('div', { class: 'item' },
      el('div', { class: 'item-head' },
        color, name,
        el('button', { class: 'icon', title: 'Move up (parks earlier)', onclick: () => move(-1) }, '↑'),
        el('button', { class: 'icon', title: 'Move down (parks later)', onclick: () => move(1) }, '↓'),
        el('button', {
          class: 'icon', title: 'Remove vehicle',
          onclick: () => { config.vehicles.splice(i, 1); renderVehicles(); configChanged(); },
        }, '✕'),
      ),
      el('div', { class: 'dims' }, describeVehicle(v), pinInfo),
      details,
    ));
  });
}

function renderObstacles() {
  const box = $('obstacles');
  box.replaceChildren();
  config.obstacles.forEach((o, i) => {
    box.append(el('div', { class: 'obst-row' },
      lengthField('X', () => o.x, (v) => { o.x = v; }, { max: 400 }),
      lengthField('Y', () => o.y, (v) => { o.y = v; }, { max: 400 }),
      lengthField('W', () => o.w, (v) => { o.w = v; }, { min: 0.1, max: 400 }),
      lengthField('D', () => o.d, (v) => { o.d = v; }, { min: 0.1, max: 400 }),
      el('button', { class: 'icon', title: 'Remove', onclick: () => { config.obstacles.splice(i, 1); renderObstacles(); configChanged(); } }, '✕'),
    ));
  });
}

function setupStaticControls() {
  const preset = $('preset');
  for (const [k, p] of Object.entries(PRESETS)) preset.append(el('option', { value: k }, p.label));
  preset.value = 'medium';
  $('add-vehicle').onclick = () => {
    config.vehicles.push(newVehicle(preset.value, config.vehicles.length));
    renderVehicles();
    configChanged();
  };
  $('add-door').onclick = () => {
    config.doors.push({ wall: 'front', offset: 0, width: 9, auto: true });
    renderDoors();
    configChanged();
  };
  $('add-obstacle').onclick = () => {
    config.obstacles.push({ x: config.building.width / 2 - 0.5, y: config.building.depth / 2 - 0.5, w: 1, d: 1 });
    renderObstacles();
    configChanged();
  };
  $('btn-run').onclick = () => runPlan('plan', { animate: true });
  $('btn-explore').onclick = () => runPlan('explore', { animate: true });
  $('btn-cancel').onclick = cancelJob;
  $('btn-play').onclick = togglePlay;
  $('btn-restart').onclick = () => { anim.t = 0; play(); };
  $('btn-end').onclick = () => { finishAnimation(); };
  for (const id of ['show-paths', 'show-clearance']) $(id).onchange = requestDraw;
  $('btn-reset').onclick = () => {
    if (!confirm('Replace the current setup with the example?')) return;
    config = exampleConfig();
    history.replaceState(null, '', location.pathname);
    refreshForms();
    configChanged();
  };
  $('btn-share').onclick = async () => {
    const url = `${location.origin}${location.pathname}#c=${encodeConfig(config)}`;
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      flash($('btn-share'), 'Link copied');
    } catch {
      prompt('Copy this link:', url);
    }
  };
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    if ((e.key === 'r' || e.key === 'R') && hoverId != null) rotateVehicle(hoverId, e.shiftKey ? -90 : 90);
  });
}

function flash(button, text) {
  const old = button.textContent;
  button.textContent = text;
  setTimeout(() => { button.textContent = old; }, 1500);
}

// ---------------------------------------------------------------- planning

let worker = null;
let jobId = 0;
let autoTimer = null;

function configChanged() {
  resolveDoorOffsets(config.building, config.doors);
  refreshDoorOffsets();
  saveConfig();
  world = buildWorld(config);
  renderer.fit(world.bounds);
  if (result) stale = true;
  renderResults();
  requestDraw();
  if ($('auto-run').checked) {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => runPlan('plan', { animate: false }), 400);
  }
}

function cancelJob() {
  if (worker) worker.terminate();
  worker = null;
  $('busy').hidden = true;
}

function runPlan(type, { animate }) {
  clearTimeout(autoTimer);
  cancelJob();
  const snap = JSON.parse(JSON.stringify(config));
  const id = ++jobId;
  const trials = Math.max(2, Math.min(200, parseInt($('trials').value, 10) || 20));
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  $('busy').hidden = false;
  $('busy-text').textContent = 'Planning…';
  let bestNote = '';
  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.id !== id) return;
    if (msg.type === 'progress') {
      const what = msg.name === 'exit check' ? 'checking exits' : `parking ${msg.name}`;
      $('busy-text').textContent = type === 'explore'
        ? `Layout ${msg.trial + 1}/${msg.trials}: ${what}${bestNote}`
        : `${what} (${Math.min(msg.step + 1, msg.total)}/${msg.total})…`;
    } else if (msg.type === 'improved') {
      bestNote = ` · best so far ${msg.parkedCount} parked, ${msg.freeExit} free`;
    } else if (msg.type === 'result') {
      cancelJob();
      result = { ...msg.result, snap, mode: type, trials };
      stale = false;
      anim.timeline = buildTimeline(result);
      if (animate) { anim.t = 0; play(); } else finishAnimation();
      renderResults();
    } else if (msg.type === 'error') {
      cancelJob();
      console.error(msg.message);
      $('results').textContent = `Planner error: ${msg.message.split('\n')[0]}`;
    }
  };
  worker.onerror = (e) => {
    cancelJob();
    $('results').textContent = `Could not start the planner (${e.message || 'worker error'}). Serve this page over http(s) rather than opening the file directly.`;
  };
  worker.postMessage({ type, config: snap, id, trials });
}

// ---------------------------------------------------------------- animation

const PAUSE = 2.5; // ft-equivalents spent stopped when changing gear
const GAP = 5; // between vehicles

function buildTimeline(res) {
  const items = [];
  res.results.forEach((r) => {
    if (!r.parked) return;
    const v = res.snap.vehicles.find((x) => x.id === r.id);
    items.push({ r, v, model: vehicleModel(v) });
  });
  items.sort((a, b) => a.r.seq - b.r.seq);
  let t = 0;
  for (const it of items) {
    const p = it.r.path;
    const arrive = new Float64Array(p.length);
    const pause = new Float64Array(p.length);
    for (let i = 1; i < p.length; i++) {
      pause[i] = i > 1 && p[i].dir !== p[i - 1].dir ? PAUSE : 0;
      arrive[i] = arrive[i - 1] + pause[i] + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    }
    it.arrive = arrive;
    it.pause = pause;
    it.start = t;
    it.end = t + arrive[arrive.length - 1];
    t = it.end + GAP;
  }
  return { items, total: Math.max(0, t - GAP) };
}

function lerpAngle(a, b, u) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * u;
}

// State of a timeline item at animation time t.
function itemState(it, t) {
  const p = it.r.path;
  const local = t - it.start;
  if (local < 0) return null;
  if (local >= it.end - it.start) {
    const q = p[p.length - 1];
    return { pose: { x: q.x, y: q.y, th: q.th }, steer: 0, upTo: p.length, done: true };
  }
  let lo = 1, hi = p.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (it.arrive[mid] < local) lo = mid + 1; else hi = mid;
  }
  const i = lo;
  const seg = it.arrive[i] - it.arrive[i - 1] - it.pause[i];
  const u = seg > 0 ? Math.max(0, Math.min(1, (local - it.arrive[i - 1] - it.pause[i]) / seg)) : 1;
  const a = p[i - 1], b = p[i];
  return {
    pose: { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, th: lerpAngle(a.th, b.th, u) },
    steer: b.steer, upTo: i + 1, done: false,
  };
}

function play() {
  if (!anim.timeline) return;
  if (anim.t >= anim.timeline.total) anim.t = 0;
  anim.playing = true;
  anim.last = performance.now();
  requestAnimationFrame(tick);
}

function togglePlay() {
  if (anim.playing) { anim.playing = false; requestDraw(); } else play();
}

function finishAnimation() {
  anim.playing = false;
  if (anim.timeline) anim.t = anim.timeline.total;
  requestDraw();
}

function tick(now) {
  if (!anim.playing) return;
  const dt = Math.min(0.1, (now - anim.last) / 1000);
  anim.last = now;
  anim.t += dt * Number($('speed').value);
  if (anim.t >= anim.timeline.total) {
    anim.t = anim.timeline.total;
    anim.playing = false;
  }
  draw();
  if (anim.playing) requestAnimationFrame(tick);
}

const animDone = () => !anim.timeline || (!anim.playing && anim.t >= anim.timeline.total);

// ---------------------------------------------------------------- scene / drawing

let drawQueued = false;
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

// True when a vehicle's pin was changed after the last run.
function pinMoved(id) {
  const cur = vehicleById(id);
  if (!cur?.pin || !stale) return false;
  const old = result?.snap.vehicles.find((x) => x.id === id)?.pin;
  return !old || old.x !== cur.pin.x || old.y !== cur.pin.y || old.th !== cur.pin.th;
}

// Final (or pinned) pose of each vehicle, for dragging and spacing checks.
function restingPoses() {
  const out = new Map();
  if (result) {
    for (const r of result.results) {
      if (!r.parked || !vehicleById(r.id) || pinMoved(r.id)) continue;
      const v = result.snap.vehicles.find((x) => x.id === r.id);
      out.set(r.id, { v, model: vehicleModel(v), pose: r.pose });
    }
  }
  for (const v of config.vehicles) {
    if (v.pin && !out.has(v.id)) out.set(v.id, { v, model: vehicleModel(v), pose: v.pin, ghost: true });
  }
  if (drag) {
    const cur = vehicleById(drag.id);
    out.set(drag.id, { v: cur, model: vehicleModel(cur), pose: { x: drag.x, y: drag.y, th: drag.th } });
  }
  return out;
}

function draw() {
  const showPaths = $('show-paths').checked;
  const vehicles = [];
  const failedPins = new Set();
  if (result) for (const r of result.results) if (!r.parked) failedPins.add(r.id);
  const waiting = new Set();

  if (anim.timeline && !drag) {
    for (const it of anim.timeline.items) {
      const cur = vehicleById(it.v.id);
      if (!cur || pinMoved(cur.id)) continue;
      const st = itemState(it, anim.t);
      // Not its turn yet: keep it off the plan rather than at its final spot.
      if (!st) { waiting.add(it.v.id); continue; }
      vehicles.push({
        id: it.v.id, model: it.model, pose: st.pose, steer: st.steer, color: cur.color,
        label: st.done || animDone() ? cur.name : '', path: showPaths ? it.r.path : null, pathUpTo: st.upTo,
        highlight: hoverId === it.v.id && animDone(), moving: !st.done,
      });
    }
  }
  const shown = new Set([...vehicles.map((v) => v.id), ...waiting]);
  for (const [id, s] of restingPoses()) {
    if (shown.has(id)) continue;
    const cur = vehicleById(id);
    if (!cur) continue;
    const isDrag = drag && drag.id === id;
    vehicles.push({
      id, model: vehicleModel(cur), pose: s.pose, color: cur.color, label: cur.name,
      ghost: !isDrag && s.ghost, invalid: isDrag ? !drag.valid : failedPins.has(id) && !!cur.pin,
      highlight: hoverId === id,
    });
  }
  renderer.draw({
    world, vehicles,
    options: {
      showPaths, showClearance: $('show-clearance').checked,
      clearance: config.settings.clearance, parkGap: config.settings.parkGap, endGap: config.settings.endGap,
    },
  });
}

// ---------------------------------------------------------------- results panel

function renderResults() {
  const box = $('results');
  box.replaceChildren();
  if (!result) return;
  const n = result.results.length;
  const summary = el('div', { class: 'summary' },
    el('span', { class: result.parkedCount === n ? 'ok' : 'bad' }, `${result.parkedCount} of ${n} vehicles parked`),
    ' · ',
    el('span', { class: result.freeExit === result.parkedCount ? 'ok' : 'bad' },
      `${result.freeExit} can drive out without moving others`),
    result.mode === 'explore' ? el('span', { class: 'stale' }, `best of ${result.trials} layouts tried`) : null,
    stale ? el('span', { class: 'stale' }, 'Setup changed since this run.') : null,
  );
  const name = (id) => vehicleById(id)?.name ?? result.snap.vehicles.find((v) => v.id === id)?.name ?? '?';
  const rows = result.results.map((r) => {
    const v = result.snap.vehicles.find((x) => x.id === r.id);
    const cur = vehicleById(r.id);
    const sw = el('span', { class: 'swatch', style: `display:inline-block;background:${cur?.color ?? v.color}` });
    let status;
    if (!r.parked) {
      status = el('span', { class: 'status-bad' }, `✗ Not parked: ${r.reason}`);
    } else {
      const how = r.moves <= 1 ? (r.firstDir < 0 ? 'backs straight in' : 'drives straight in') : `${r.moves}-point manoeuvre`;
      const door = r.door != null ? `Door ${r.door + 1}` : 'door';
      const exit = r.exit?.ok
        ? el('span', { class: 'status-ok' }, '✓ can leave')
        : el('span', { class: 'status-bad' }, r.exit?.blockedBy?.length
          ? `✗ blocked in by ${r.exit.blockedBy.map(name).join(' or ')}`
          : '✗ boxed in (more than one vehicle must move)');
      status = el('span', {},
        `via ${door}, ${how} · `, exit,
        ' ',
        r.spacingOk === false ? el('span', { class: 'status-warn' }, ' · ⚠ tighter than the parked-gap rule') : null,
        vehicleById(r.id)?.pin ? el('span', { class: 'pin' }, 'pinned') : null);
    }
    return el('tr', {}, el('td', {}, sw), el('td', {}, el('strong', {}, name(r.id))), el('td', {}, status));
  });
  box.append(summary, el('table', {}, el('tbody', {}, ...rows)));
}

// ---------------------------------------------------------------- dragging / pins

function pinVehicle(v) {
  const rest = restingPoses().get(v.id);
  if (rest) {
    v.pin = { ...rest.pose };
  } else {
    const m = vehicleModel(v);
    v.pin = { x: config.building.width / 2, y: config.building.depth / 2 - m.bodyOffset, th: Math.PI / 2 };
  }
}

function snapTh(th) {
  return headingBin(th) * DTH;
}

function hitTest(wx, wy) {
  const poses = [...restingPoses()];
  for (let i = poses.length - 1; i >= 0; i--) {
    const [id, s] = poses[i];
    const b = bodyObb(s.model, s.pose.x, s.pose.y, s.pose.th);
    const dx = wx - b.cx, dy = wy - b.cy;
    if (Math.abs(dx * b.c + dy * b.s) <= b.hx && Math.abs(-dx * b.s + dy * b.c) <= b.hy) return id;
  }
  return null;
}

function dragValid(id, x, y, th) {
  const cur = vehicleById(id);
  const others = [];
  for (const [oid, s] of restingPoses()) {
    if (oid !== id) others.push({ body: bodyObb(s.model, s.pose.x, s.pose.y, s.pose.th) });
  }
  return parkValid(world, vehicleModel(cur), x, y, th, others);
}

function rotateVehicle(id, deg) {
  const v = vehicleById(id);
  if (!v || !animDone()) return;
  if (!v.pin) pinVehicle(v);
  const m = vehicleModel(v);
  const cx = v.pin.x + Math.cos(v.pin.th) * m.bodyOffset, cy = v.pin.y + Math.sin(v.pin.th) * m.bodyOffset;
  const th = snapTh(v.pin.th + (deg * Math.PI) / 180);
  v.pin = { x: cx - Math.cos(th) * m.bodyOffset, y: cy - Math.sin(th) * m.bodyOffset, th };
  renderVehicles();
  configChanged();
}

function setupCanvas() {
  const canvas = $('canvas');
  const pointerWorld = (e) => {
    const r = canvas.getBoundingClientRect();
    return renderer.toWorld(e.clientX - r.left, e.clientY - r.top);
  };
  canvas.addEventListener('pointerdown', (e) => {
    const [wx, wy] = pointerWorld(e);
    const id = hitTest(wx, wy);
    if (id == null) return;
    if (!animDone()) finishAnimation();
    const s = restingPoses().get(id);
    drag = { id, dx: s.pose.x - wx, dy: s.pose.y - wy, x: s.pose.x, y: s.pose.y, th: s.pose.th, sx: e.clientX, sy: e.clientY, moved: false, valid: true };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    const [wx, wy] = pointerWorld(e);
    if (drag) {
      drag.moved ||= Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3;
      drag.x = wx + drag.dx;
      drag.y = wy + drag.dy;
      drag.valid = dragValid(drag.id, drag.x, drag.y, drag.th);
      requestDraw();
      return;
    }
    const id = animDone() ? hitTest(wx, wy) : null;
    if (id !== hoverId) { hoverId = id; requestDraw(); }
    canvas.style.cursor = id != null ? 'grab' : 'default';
  });
  const endDrag = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    canvas.style.cursor = 'grab';
    if (d.moved) {
      const v = vehicleById(d.id);
      v.pin = { x: d.x, y: d.y, th: snapTh(d.th) };
      renderVehicles();
      configChanged();
    }
    requestDraw();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    if (hoverId == null) return;
    e.preventDefault();
    rotateVehicle(hoverId, (e.deltaY > 0 ? -1 : 1) * (e.shiftKey ? 15 : 5));
  }, { passive: false });

  const ro = new ResizeObserver(() => {
    renderer.resize();
    renderer.fit(world.bounds);
    draw();
  });
  ro.observe(canvas.parentElement);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', requestDraw);
}

// ---------------------------------------------------------------- boot

setupStaticControls();
renderForms();
setupCanvas();
runPlan('plan', { animate: true });
