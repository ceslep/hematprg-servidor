/* Panel de resultados — Hematología (Diatron Aquarius 3) */
'use strict';

import { esc, fmtFecha, fmtRecibido } from './js/format.js';
import { drawGraph } from './js/graphs.js';

const $ = (sel) => document.querySelector(sel);
const el = {
  dot: $('#dot'),
  statusText: $('#statusText'),
  deviceChip: $('#deviceChip'),
  count: $('#count'),
  list: $('#list'),
  search: $('#search'),
  detail: $('#detail'),
  toastWrap: $('#toasts'),
};

const state = {
  status: null,
  results: [],
  selectedId: null,
  detail: null,
  query: '',
};

/* ---------------- utilidades ---------------- */

function toast(html) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = html;
  el.toastWrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 4200);
  setTimeout(() => t.remove(), 4800);
}

/* ---------------- SSE ---------------- */

let es = null;
let pollTimer = null;

function connectSse() {
  if (es) es.close();
  es = new EventSource('/api/eventos');
  es.addEventListener('estado', (ev) => { state.status = JSON.parse(ev.data); renderStatus(); });
  es.addEventListener('equipo', (ev) => { renderDevice(JSON.parse(ev.data)); });
  es.addEventListener('resultado', (ev) => {
    const r = JSON.parse(ev.data);
    loadList({ keepSelection: true, nuevo: r });
  });
  es.onopen = () => { clearInterval(pollTimer); pollTimer = null; };
  es.onerror = () => {
    if (!pollTimer) pollTimer = setInterval(() => { loadStatus(); loadList({ keepSelection: true }); }, 5000);
  };
}

/* ---------------- estado ---------------- */

function renderStatus() {
  const s = state.status;
  if (!s) return;
  const serial = s.serial || {};
  const cfg = s.config || {};
  const on = !!serial.connected;
  const frame = serial.framing || cfg.framing || `${serial.dataBits || 8}N${serial.stopBits || 1}`;
  el.dot.className = 'dot ' + (on ? 'on' : (serial.reconnecting ? 'warn' : 'off'));
  let txt = on
    ? `Serie conectada · ${serial.path} @ ${serial.baudRate} ${frame}`
    : (serial.reconnecting
      ? `Reintentando ${serial.path} @ ${serial.baudRate} ${frame}…`
      : `Esperando puerto ${serial.path} @ ${serial.baudRate} ${frame}…`);
  if (!on && serial.lastError) txt += ` — ${serial.lastError}`;
  el.statusText.textContent = txt;
  el.count.textContent = s.totalResultados ?? state.results.length;
  if (s.device) renderDevice(s.device);

  const ep = $('#emptyPort');
  const eb = $('#emptyBaud');
  const ef = $('#emptyFrame');
  if (ep) ep.textContent = serial.path || '—';
  if (eb) eb.textContent = serial.baudRate || '—';
  if (ef) ef.textContent = frame;
}

function renderDevice(d) {
  if (!d || !d.model) {
    el.deviceChip.innerHTML = '<b>Equipo</b><br>esperando identificación…';
    return;
  }
  const serie = d.serial ? `Serie ${esc(d.serial)}` : 'USB-Serie';
  el.deviceChip.innerHTML = `<b>${esc(d.model)}</b> · fw ${esc(d.version || '?')}<br>${serie}`;
}

async function loadStatus() {
  try {
    state.status = await (await fetch('/api/estado')).json();
    renderStatus();
  } catch { /* ignore */ }
}

/* ---------------- lista ---------------- */

async function loadList({ keepSelection = false, nuevo = null } = {}) {
  try {
    const data = await (await fetch('/api/resultados' + (state.query ? '?q=' + encodeURIComponent(state.query) : ''))).json();
    state.results = data.resultados || [];
    renderList();
    if (nuevo) {
      toast(`Nuevo resultado: <b>${esc(nuevo.header?.['Patient Name'] || nuevo.header?.RecNo || '')}</b>`);
      if (!state.selectedId) selectResult(nuevo.id);
      else if (keepSelection && !state.results.some((r) => r.id === state.selectedId)) selectResult(nuevo.id);
    }
  } catch { /* ignore */ }
}

function renderList() {
  if (!state.results.length) {
    el.list.innerHTML = `<div class="empty-list">Aún no hay resultados.<br>Corra una muestra en el equipo: el resultado llegará por USB automáticamente.</div>`;
    return;
  }
  el.list.innerHTML = '';
  for (const r of state.results) {
    const h = r.header || {};
    const alertas = r.alertas || [];
    const btn = document.createElement('button');
    btn.className = 'item' + (r.id === state.selectedId ? ' active' : '');
    btn.innerHTML = `
      <div class="row1">
        <span class="name">${esc(h['Patient Name'] || 'Sin nombre')}${alertas.length ? `<span class="badge-alert">${alertas.length}</span>` : ''}</span>
        <span class="rec">#${esc(h.RecNo || '—')}</span>
      </div>
      <div class="row2">
        <span>${esc(h['Sample ID'] || '—')}</span>
        <span>${esc(fmtFecha(h['Test date(ymd)'], h['Test time(hm)']))}</span>
      </div>
      <div class="mini">
        <span>WBC <b>${esc(r.params?.WBC ?? '—')}</b></span>
        <span>HGB <b>${esc(r.params?.HGB ?? '—')}</b></span>
        <span>PLT <b>${esc(r.params?.PLT ?? '—')}</b></span>
      </div>`;
    btn.addEventListener('click', () => selectResult(r.id));
    el.list.appendChild(btn);
  }
}

/* ---------------- detalle ---------------- */

async function selectResult(id) {
  state.selectedId = id;
  renderList();
  try {
    state.detail = await (await fetch('/api/resultados/' + encodeURIComponent(id))).json();
    renderDetail();
  } catch {
    el.detail.innerHTML = '<div class="empty-state"><div><h2>No se pudo cargar el resultado</h2></div></div>';
  }
}

function renderDetail() {
  const r = state.detail;
  if (!r) return;
  const h = r.header || {};
  const params = r.params || {};
  const alerts = Object.entries(params).filter(([, v]) => v.flags);

  const cardsHtml = alerts.length
    ? `<div class="alert-row">${alerts.map(([k, v]) => `<span class="alert ${v.flags === 'L' ? 'low' : ''}">${esc(k)} ${esc(v.flags)} · ${esc(v.value)} ${esc(v.unit)}</span>`).join('')}</div>`
    : '<div class="alert-row"><span class="alert" style="background:#e8f8f0;color:#128a5b;border-color:#b9e6cf">Sin alertas</span></div>';

  const rows = Object.entries(params).map(([name, p]) => `
    <tr class="${p.flags ? 'has-flag' : ''}">
      <td class="param">${esc(name)}</td>
      <td class="value">${esc(p.value)}</td>
      <td>${esc(p.unit)}</td>
      <td class="range">${esc(p.range)}</td>
      <td>${p.flags ? `<span class="flag ${esc(p.flags)}">${esc(p.flags)}</span>` : ''}</td>
    </tr>`).join('');

  const graphs = Object.values(r.graphs || {});
  const graphsHtml = graphs.length ? `
    <div class="section-title">Histogramas</div>
    <div class="graphs" id="graphs"></div>` : '';

  el.detail.innerHTML = `
    <div class="patient-card">
      <div class="who">
        <h2>${esc(h['Patient Name'] || 'Sin nombre')}</h2>
        <div class="sub">Muestra <b>${esc(h['Sample ID'] || '—')}</b> · ID paciente ${esc(h['Patient ID'] || '—')}</div>
      </div>
      <div class="meta-grid">
        <div class="meta">Registro<b>#${esc(h.RecNo || '—')}</b></div>
        <div class="meta">Fecha análisis<b>${esc(fmtFecha(h['Test date(ymd)'], h['Test time(hm)']))}</b></div>
        <div class="meta">Modo<b>${esc(h.Mode || '—')}</b></div>
        <div class="meta">Sexo / Edad<b>${esc(h.Sex || '—')} · ${esc(h.Age || '—')} ${esc(h.Age_unit || '')}</b></div>
        <div class="meta">Recibido<b>${esc(fmtRecibido(r.received))}</b></div>
      </div>
    </div>
    ${cardsHtml}
    <div class="section-title">Parámetros</div>
    <table class="params">
      <thead><tr><th>Parámetro</th><th>Resultado</th><th>Unidad</th><th>Rango de referencia</th><th>Flag</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${graphsHtml}
    <div class="toolbar">
      <button class="btn primary" id="btnJson">Descargar JSON</button>
      <button class="btn" id="btnPrint">Imprimir</button>
      <button class="btn" id="btnCopy">Copiar informe</button>
    </div>
    <details class="raw"><summary>Ver informe original del equipo</summary><pre>${esc(r.raw_text || '')}</pre></details>`;

  if (graphs.length) {
    const wrap = $('#graphs');
    for (const g of graphs) {
      const card = document.createElement('div');
      card.className = 'graph-card';
      card.innerHTML = `<h3>${esc(g.name)}</h3><canvas></canvas>
        <div class="legend"><span>Escala: ${esc(g['Scale(fl)'] ?? '—')} fl</span><span>Canales: ${esc(g.Channels ?? '—')}</span></div>`;
      wrap.appendChild(card);
      drawGraph(card.querySelector('canvas'), g);
    }
  }

  $('#btnJson').addEventListener('click', () => downloadJson(r));
  $('#btnPrint').addEventListener('click', () => window.print());
  $('#btnCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(r.raw_text || '');
      toast('Informe copiado al portapapeles');
    } catch { toast('No se pudo copiar'); }
  });
}

function downloadJson(r) {
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `resultado_${r.header?.RecNo || 'sin_rec'}_${(r.received || '').slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------------- configuración de conexión ---------------- */

const BAUD_OPTIONS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

function fillBaud(select, value) {
  select.innerHTML = '';
  const list = [...BAUD_OPTIONS];
  const n = Number(value);
  if (n && !list.includes(n)) list.push(n);
  list.sort((a, b) => a - b);
  for (const b of list) {
    const o = document.createElement('option');
    o.value = String(b);
    o.textContent = String(b);
    select.appendChild(o);
  }
  select.value = String(n || 115200);
}

function cfgMsg(text, kind = 'ok') {
  const box = $('#cfgMsg');
  if (!text) { box.hidden = true; box.textContent = ''; return; }
  box.hidden = false;
  box.className = 'cfg-msg ' + kind;
  box.textContent = text;
}

async function refreshPorts(selected) {
  const info = $('#cfgPortsInfo');
  info.textContent = 'Buscando puertos…';
  try {
    const data = await (await fetch('/api/puertos')).json();
    const ports = data.ports || [];
    const dl = $('#listaPuertos');
    dl.innerHTML = '';
    for (const p of ports) {
      const o = document.createElement('option');
      o.value = p.path;
      o.label = `${p.path} · ${p.friendlyName || p.manufacturer || ''}`;
      dl.appendChild(o);
    }
    info.textContent = ports.length
      ? 'Detectados: ' + ports.map((p) => `${p.path}${p.manufacturer ? ' (' + p.manufacturer + ')' : ''}`).join(', ')
      : 'No se detectó ningún puerto serie. Conecte el cable USB-Serie y pulse 🔄.';
    if (selected) $('#cfgPort').value = selected;
    return ports;
  } catch {
    info.textContent = 'No se pudieron consultar los puertos serie.';
    return [];
  }
}

function populateConfig(cfg) {
  $('#cfgPort').value = cfg.serialPath || 'COM3';
  fillBaud($('#cfgBaud'), cfg.baudRate);
  $('#cfgDataBits').value = String(cfg.dataBits ?? 8);
  $('#cfgParity').value = cfg.parity || 'none';
  $('#cfgStopBits').value = String(cfg.stopBits ?? 1);
  $('#cfgReconnect').value = cfg.reconnectMs ?? 3000;
  $('#cfgAck').checked = !!cfg.ackOnEnq;
  $('#cfgHost').value = cfg.host || '127.0.0.1';
  $('#cfgHttpPort').value = cfg.httpPort ?? 3000;
  const pl = ({ none: 'N', even: 'E', odd: 'O', mark: 'M', space: 'S' })[cfg.parity || 'none'] || 'N';
  const frame = cfg.framing || `${cfg.dataBits ?? 8}${pl}${cfg.stopBits ?? 1}`;
  $('#cfgCurrent').textContent = cfg.serialPath
    ? `Actual: ${cfg.serialPath} @ ${cfg.baudRate} ${frame}`
    : '';
}

async function openConfig() {
  cfgMsg('');
  $('#modalConfig').hidden = false;
  try {
    const data = await (await fetch('/api/config')).json();
    state.cfgData = data;
    populateConfig(data.config || data.defaults || {});
    await refreshPorts(data.config?.serialPath);
    const st = state.status?.serial;
    if (st && !st.connected) {
      cfgMsg(`El puerto ${st.path} no está conectado${st.lastError ? ': ' + st.lastError : '.'}`, 'warn');
    }
  } catch (e) {
    cfgMsg('No se pudo cargar la configuración del servidor: ' + e.message, 'err');
  }
}

function closeConfig() {
  $('#modalConfig').hidden = true;
}

async function saveConfig(ev) {
  ev.preventDefault();
  const btn = $('#btnSaveCfg');
  const body = {
    serialPath: $('#cfgPort').value.trim(),
    baudRate: Number($('#cfgBaud').value),
    dataBits: Number($('#cfgDataBits').value),
    parity: $('#cfgParity').value,
    stopBits: Number($('#cfgStopBits').value),
    reconnectMs: Number($('#cfgReconnect').value),
    ackOnEnq: $('#cfgAck').checked,
    host: $('#cfgHost').value.trim(),
    httpPort: Number($('#cfgHttpPort').value),
  };
  btn.disabled = true;
  btn.textContent = 'Aplicando…';
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      cfgMsg(data.errors ? data.errors.join(' · ') : (data.error || 'Error al guardar la configuración'), 'err');
      return;
    }
    populateConfig(data.config);
    state.status = await (await fetch('/api/estado')).json();
    renderStatus();
    if (data.requiresRestart) {
      cfgMsg(data.message || 'Guardado. Reinicie el servidor para aplicar los cambios de host/puerto HTTP.', 'warn');
    } else {
      cfgMsg(data.message || 'Configuración aplicada.', 'ok');
      toast('⚙ Configuración aplicada');
      setTimeout(closeConfig, 900);
    }
  } catch (e) {
    cfgMsg('No se pudo contactar al servidor: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Aplicar y reconectar';
  }
}

function wireConfig() {
  $('#btnConfig').addEventListener('click', openConfig);
  $('#btnCerrarConfig').addEventListener('click', closeConfig);
  $('#btnCancelCfg').addEventListener('click', closeConfig);
  $('#formConfig').addEventListener('submit', saveConfig);
  $('#btnPuertos').addEventListener('click', () => refreshPorts($('#cfgPort').value.trim()));
  $('#btnResetCfg').addEventListener('click', async () => {
    try {
      const data = state.cfgData || await (await fetch('/api/config')).json();
      populateConfig(data.defaults);
      cfgMsg('Valores por defecto cargados. Pulse «Aplicar y reconectar» para guardarlos.', 'warn');
    } catch { cfgMsg('No se pudieron cargar los valores por defecto.', 'err'); }
  });
  $('#modalConfig').addEventListener('click', (e) => {
    if (e.target === $('#modalConfig')) closeConfig();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modalConfig').hidden) closeConfig();
  });
}

/* ---------------- eventos ---------------- */

el.search.addEventListener('input', () => {
  state.query = el.search.value.trim();
  loadList({ keepSelection: true });
});

window.addEventListener('resize', () => {
  if (state.detail) {
    const graphs = Object.values(state.detail.graphs || {});
    document.querySelectorAll('#graphs canvas').forEach((c) => {
      const name = c.closest('.graph-card').querySelector('h3').textContent;
      const g = graphs.find((x) => x.name === name);
      if (g) drawGraph(c, g);
    });
  }
});

/* ---------------- arranque ---------------- */

(async function init() {
  await loadStatus();
  await loadList();
  if (!state.selectedId && state.results.length) selectResult(state.results[0].id);
  wireConfig();
  connectSse();
  // refresco de estado periódico (por si SSE se cae)
  setInterval(loadStatus, 15000);
})();
