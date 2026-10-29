/**
 * Servidor local de resultados — Diatron Aquarius 3 por USB-Serie
 * ---------------------------------------------------------------
 * - Escucha siempre el puerto serie (COM3, 115200 8N1) y se reconecta solo.
 * - Decodifica el protocolo Diatron:
 *      SOH + prefijo(2) + STX + texto + ETX + checksum(2 hex) + EOT
 * - Guarda los resultados en JSON y los publica por SSE al panel web.
 *
 * Ejecutar:  node server.js            (o  npm start)
 * Panel:     http://127.0.0.1:3000
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { SerialPort } = require('serialport');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const RAW_DIR = path.join(DATA_DIR, 'raw');
const RESULTS_FILE = path.join(DATA_DIR, 'resultados.json');
const LOG_FILE = path.join(DATA_DIR, 'servidor.log');
const PID_FILE = path.join(DATA_DIR, 'servidor.pid');

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULT_CFG = {
  serialPath: 'COM3',
  baudRate: 115200,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  ackOnEnq: false,
  reconnectMs: 3000,
  httpPort: 3000,
  host: '127.0.0.1',
};

const PARITIES = ['none', 'even', 'odd', 'mark', 'space'];

const SOH = 0x01, STX = 0x02, ETX = 0x03, EOT = 0x04;
const ENQ = 0x05, ACK = 0x06;

for (const dir of [DATA_DIR, RAW_DIR]) fs.mkdirSync(dir, { recursive: true });

/* ------------------------------------------------------------------ */
/*  Utilidades                                                        */
/* ------------------------------------------------------------------ */

const LOG_MAX_BYTES = 2 * 1024 * 1024;
let logBytes = null;

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  try {
    if (logBytes === null) logBytes = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0;
    if (logBytes > LOG_MAX_BYTES) {
      try { fs.renameSync(LOG_FILE, LOG_FILE + '.1'); } catch { /* ignore */ }
      logBytes = 0;
    }
    fs.appendFileSync(LOG_FILE, line + '\n');
    logBytes += Buffer.byteLength(line) + 1;
  } catch { /* ignore */ }
}

const hex = (buf) => Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join(' ');

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* ------------------------------------------------------------------ */
/*  Configuración de conexión (persistida en data/config.json)        */
/* ------------------------------------------------------------------ */

function validateConfig(raw = {}) {
  const cfg = {};
  const errors = [];

  if (raw.serialPath !== undefined) {
    const v = String(raw.serialPath).trim();
    if (!/^[A-Za-z0-9._:\\/-]{1,64}$/.test(v)) errors.push('Puerto serie inválido (ej. COM3)');
    else cfg.serialPath = /^com\d+$/i.test(v) ? v.toUpperCase() : v;
  }
  if (raw.baudRate !== undefined) {
    const v = Number(raw.baudRate);
    if (!Number.isInteger(v) || v < 300 || v > 2000000) errors.push('Velocidad en baudios inválida');
    else cfg.baudRate = v;
  }
  if (raw.dataBits !== undefined) {
    const v = Number(raw.dataBits);
    if (![5, 6, 7, 8].includes(v)) errors.push('Bits de datos inválidos (5-8)');
    else cfg.dataBits = v;
  }
  if (raw.parity !== undefined) {
    const v = String(raw.parity).toLowerCase();
    if (!PARITIES.includes(v)) errors.push(`Paridad inválida (${PARITIES.join(', ')})`);
    else cfg.parity = v;
  }
  if (raw.stopBits !== undefined) {
    const v = Number(raw.stopBits);
    if (![1, 1.5, 2].includes(v)) errors.push('Bits de parada inválidos (1, 1.5, 2)');
    else cfg.stopBits = v;
  }
  if (raw.ackOnEnq !== undefined) {
    cfg.ackOnEnq = raw.ackOnEnq === true || raw.ackOnEnq === 'true' || raw.ackOnEnq === 1 || raw.ackOnEnq === '1';
  }
  if (raw.reconnectMs !== undefined) {
    const v = Number(raw.reconnectMs);
    if (!Number.isInteger(v) || v < 200 || v > 300000) errors.push('Tiempo de reintento inválido (200-300000 ms)');
    else cfg.reconnectMs = v;
  }
  if (raw.httpPort !== undefined) {
    const v = Number(raw.httpPort);
    if (!Number.isInteger(v) || v < 1 || v > 65535) errors.push('Puerto HTTP inválido (1-65535)');
    else cfg.httpPort = v;
  }
  if (raw.host !== undefined) {
    const v = String(raw.host).trim();
    if (!/^[A-Za-z0-9.:-]{1,64}$/.test(v)) errors.push('Host inválido (ej. 127.0.0.1)');
    else cfg.host = v;
  }
  return { cfg, errors };
}

function loadConfig() {
  const out = { ...DEFAULT_CFG };
  // Variables de entorno = valores por defecto iniciales
  if (process.env.PORT) out.httpPort = Number(process.env.PORT);
  if (process.env.HOST) out.host = process.env.HOST;
  if (process.env.SERIAL_PORT) out.serialPath = process.env.SERIAL_PORT;
  if (process.env.BAUD) out.baudRate = Number(process.env.BAUD);
  if (process.env.SERIAL_ACK) out.ackOnEnq = process.env.SERIAL_ACK === '1';
  if (process.env.RECONNECT_MS) out.reconnectMs = Number(process.env.RECONNECT_MS);

  // El archivo guardado desde el panel tiene prioridad
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      const { cfg, errors } = validateConfig(file);
      if (errors.length) log('[config] avisos en config.json:', errors.join('; '));
      Object.assign(out, cfg);
    }
  } catch (e) {
    log('[config] no se pudo leer config.json:', e.message);
  }
  return out;
}

function persistConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(CFG, null, 2));
  } catch (e) {
    log('[config] no se pudo guardar config.json:', e.message);
  }
}

function parityLetter(p) {
  return ({ none: 'N', even: 'E', odd: 'O', mark: 'M', space: 'S' })[p] || 'N';
}

function framing(cfg = CFG) {
  return `${cfg.dataBits}${parityLetter(cfg.parity)}${cfg.stopBits}`;
}

function configSnapshot() {
  return { ...CFG, framing: framing(CFG) };
}

async function listSerialPorts() {
  try {
    const ports = await SerialPort.list();
    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer || '',
      serialNumber: p.serialNumber || '',
      friendlyName: p.friendlyName || p.path,
      vendorId: p.vendorId || '',
      productId: p.productId || '',
      pnpId: p.pnpId || '',
    }));
  } catch (e) {
    log('[config] no se pudieron listar los puertos:', e.message);
    return [];
  }
}

const CFG = loadConfig();

/* ------------------------------------------------------------------ */
/*  Parser del informe (texto del Aquarius 3)                         */
/* ------------------------------------------------------------------ */

const { parseReport } = require('./lib/parse-report');

/* ------------------------------------------------------------------ */
/*  Almacén de resultados                                             */
/* ------------------------------------------------------------------ */

const store = {
  results: [],
  device: null,

  load() {
    try {
      if (fs.existsSync(RESULTS_FILE)) {
        const data = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
        this.results = Array.isArray(data.results) ? data.results : [];
        this.device = data.device || null;
        log(`[store] ${this.results.length} resultados cargados`);
        return;
      }
    } catch (e) { log('[store] error cargando:', e.message); }
    this.seedFromExisting();
  },

  seedFromExisting() {
    // Importa los JSON ya capturados por el receptor Python en ../resultados
    const legacy = path.join(ROOT, '..', 'resultados');
    try {
      if (!fs.existsSync(legacy)) return;
      const files = fs.readdirSync(legacy).filter((f) => /^resultado_.*\.json$/.test(f));
      for (const f of files) {
        try {
          const rec = JSON.parse(fs.readFileSync(path.join(legacy, f), 'utf8'));
          const meta = rec._meta || {};
          const stampTxt = meta.received || new Date().toISOString();
          const id = `seed-${f.replace(/\.json$/, '')}`;
          this.results.push({
            id,
            received: stampTxt,
            header: rec.header || {},
            params: rec.params || {},
            flags: rec.flags || [],
            graphs: rec.graphs || {},
            raw_text: rec.raw_text || '',
            device: this.device,
            prefix: meta.prefix || null,
          });
        } catch (e) { log(`[store] no se pudo importar ${f}:`, e.message); }
      }
      if (this.results.length) {
        log(`[store] importados ${this.results.length} resultados existentes`);
        this.save();
      }
    } catch (e) { log('[store] seed error:', e.message); }
  },

  save() {
    try {
      fs.writeFileSync(RESULTS_FILE, JSON.stringify({ device: this.device, results: this.results }, null, 2));
    } catch (e) { log('[store] error guardando:', e.message); }
  },

  add(result) {
    this.results.unshift(result);
    this.save();
    return result;
  },
};

/* ------------------------------------------------------------------ */
/*  Parser de tramas serie                                            */
/* ------------------------------------------------------------------ */

class FrameParser {
  constructor(onFrame, onEvent) {
    this.buf = Buffer.alloc(0);
    this.onFrame = onFrame;
    this.onEvent = onEvent || (() => {});
    this.pending = null;
  }

  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    let progressed = true;
    while (progressed) {
      progressed = false;
      if (this.buf.length === 0) break;

      if (this.buf[0] === ENQ) {
        this.onEvent({ type: 'enq' });
        this.buf = this.buf.subarray(1);
        progressed = true;
        continue;
      }

      if (this.buf[0] === SOH) {
        // SOH + 2 prefijo + STX
        if (this.buf.length < 4) break;
        if (this.buf[3] !== STX) {
          this.onEvent({ type: 'ruido', byte: this.buf[0] });
          this.buf = this.buf.subarray(1);
          progressed = true;
          continue;
        }
        const etx = this.buf.indexOf(ETX, 4);
        if (etx < 0) break;
        if (this.buf.length < etx + 3) break;

        const prefix = this.buf.subarray(1, 3);
        const payload = this.buf.subarray(4, etx);
        const csText = this.buf.subarray(etx + 1, etx + 3).toString('ascii');
        const calc = this.buf.subarray(1, etx + 1).reduce((a, b) => a + b, 0) & 0xff;
        const given = parseInt(csText, 16);
        let end = etx + 3;
        if (this.buf.length > end && this.buf[end] === EOT) end++;
        const frame = Buffer.from(this.buf.subarray(0, end));
        this.buf = this.buf.subarray(end);
        this.onFrame({ prefix, prefixText: prefix.toString('latin1'), payload, checksumOk: calc === given, calc, given, csText, frame });
        progressed = true;
        continue;
      }

      this.onEvent({ type: 'ruido', byte: this.buf[0] });
      this.buf = this.buf.subarray(1);
      progressed = true;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Estado + SSE                                                      */
/* ------------------------------------------------------------------ */

const status = {
  startedAt: new Date().toISOString(),
  serial: {
    path: CFG.serialPath,
    baudRate: CFG.baudRate,
    dataBits: CFG.dataBits,
    parity: CFG.parity,
    stopBits: CFG.stopBits,
    framing: framing(CFG),
    connected: false,
    reconnecting: false,
    lastError: null,
    openedAt: null,
    lastDataAt: null,
    bytes: 0,
    frames: 0,
  },
  config: configSnapshot(),
  httpActual: { host: CFG.host, port: CFG.httpPort },
  device: null,
  totalResultados: 0,
};

const sseClients = new Set();

function sendSse(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch { /* cliente cerrado */ }
}

function broadcast(event, data) {
  for (const res of sseClients) sendSse(res, event, data);
}

function statusSnapshot() {
  return {
    ...status,
    serial: { ...status.serial },
    config: configSnapshot(),
    device: status.device,
    totalResultados: store.results.length,
  };
}

function updateStatus(patch) {
  Object.assign(status.serial, patch);
  broadcast('estado', statusSnapshot());
}

function refreshSerialStatusFromConfig() {
  status.serial.path = CFG.serialPath;
  status.serial.baudRate = CFG.baudRate;
  status.serial.dataBits = CFG.dataBits;
  status.serial.parity = CFG.parity;
  status.serial.stopBits = CFG.stopBits;
  status.serial.framing = framing(CFG);
  status.config = configSnapshot();
}

/* ------------------------------------------------------------------ */
/*  Gestor del puerto serie                                           */
/* ------------------------------------------------------------------ */

class SerialManager {
  constructor() {
    this.port = null;
    this.opening = false;
    this.retryTimer = null;
    this.manualClose = false;
    this.reopenDone = true;
    this.failCount = 0;
    this.parser = new FrameParser(
      (frame) => this.handleFrame(frame),
      (ev) => this.handleEvent(ev),
    );
  }

  start() {
    this.open();
  }

  scheduleReconnect(reason) {
    if (this.retryTimer) return;
    status.serial.reconnecting = true;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, CFG.reconnectMs);
  }

  open() {
    if (this.opening || (this.port && this.port.isOpen)) return;
    this.opening = true;
    status.serial.reconnecting = false;
    if (this.failCount === 0) log(`[serial] abriendo ${CFG.serialPath} @ ${CFG.baudRate} ${framing(CFG)}`);
    const port = new SerialPort({
      path: CFG.serialPath,
      baudRate: CFG.baudRate,
      dataBits: CFG.dataBits,
      stopBits: CFG.stopBits,
      parity: CFG.parity,
      autoOpen: false,
    });
    this.port = port;

    port.open((err) => {
      this.opening = false;
      if (err) {
        this.failCount += 1;
        if (this.failCount === 1 || this.failCount % 20 === 0) {
          log(`[serial] no se pudo abrir ${CFG.serialPath}: ${err.message} (intento ${this.failCount})`);
        }
        updateStatus({ connected: false, lastError: err.message });
        try { port.destroy(); } catch { /* ignore */ }
        this.port = null;
        this.scheduleReconnect('open');
        return;
      }
      if (this.failCount > 0) log(`[serial] conexión recuperada tras ${this.failCount} intento(s)`);
      this.failCount = 0;
      this.parser.buf = Buffer.alloc(0);
      updateStatus({ connected: true, lastError: null, reconnecting: false, openedAt: new Date().toISOString() });
      log(`[serial] puerto abierto y escuchando (${framing(CFG)})`);

      port.on('data', (data) => {
        status.serial.bytes += data.length;
        status.serial.lastDataAt = new Date().toISOString();
        this.parser.push(data);
      });

      port.on('error', (e) => {
        log('[serial] error:', e.message);
        updateStatus({ connected: false, lastError: e.message });
      });

      port.on('close', () => {
        log('[serial] puerto cerrado');
        updateStatus({ connected: false });
        if (this.port === port) this.port = null;
        if (this.manualClose) return;
        this.scheduleReconnect('close');
      });
    });
  }

  /** Aplica una configuración ya validada: persiste y reconecta si cambió lo serie. */
  apply(newCfg) {
    const serialKeys = ['serialPath', 'baudRate', 'dataBits', 'parity', 'stopBits', 'ackOnEnq', 'reconnectMs'];
    const serialChanged = serialKeys.some((k) => newCfg[k] !== undefined && newCfg[k] !== CFG[k]);
    Object.assign(CFG, newCfg);
    persistConfig();
    refreshSerialStatusFromConfig();
    broadcast('estado', statusSnapshot());
    if (serialChanged) {
      log('[config] reconectando puerto serie con la nueva configuración');
      this.closeAndReopen();
    }
    return { serialChanged };
  }

  closeAndReopen() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    const port = this.port;
    this.port = null;
    this.manualClose = true;
    this.reopenDone = false;
    const done = () => {
      if (this.reopenDone) return;
      this.reopenDone = true;
      this.manualClose = false;
      this.opening = false;
      this.open();
    };
    if (port && port.isOpen) {
      try { port.close(() => done()); } catch { done(); }
    } else {
      try { port && port.destroy(); } catch { /* ignore */ }
      done();
    }
  }

  handleEvent(ev) {
    if (ev.type === 'enq') {
      log('[serial] ENQ recibido');
      if (CFG.ackOnEnq && this.port && this.port.isOpen) this.port.write(Buffer.from([ACK]));
    }
  }

  handleFrame(frame) {
    status.serial.frames++;
    const kind = frame.payload.includes(Buffer.from('Serial No.:')) ? 'REPORT'
      : frame.payload.subarray(0, 12).toString('latin1').startsWith('Aquarius') ? 'INFO' : 'UNKNOWN';
    log(`[serial] trama ${kind} prefijo=${frame.prefixText} ${frame.payload.length}B checksum=${frame.checksumOk ? 'OK' : 'MAL'}`);

    if (!frame.checksumOk) {
      log('[serial] checksum inválido, se descarta');
      return;
    }

    const ts = stamp();
    const rawBase = path.join(RAW_DIR, `${ts}_${kind}`);
    try {
      fs.writeFileSync(rawBase + '.bin', frame.frame);
      fs.writeFileSync(rawBase + '.hex', hex(frame.frame));
    } catch (e) { log('[serial] no se pudo guardar trama:', e.message); }

    if (kind === 'INFO') {
      const parts = frame.payload.toString('latin1').split('\t');
      const device = { model: parts[0], version: parts[1], date: parts[2], time: parts[3], raw: frame.payload.toString('latin1') };
      status.device = device;
      store.device = device;
      store.save();
      log('[serial] equipo:', JSON.stringify(device));
      broadcast('estado', statusSnapshot());
      broadcast('equipo', device);
      return;
    }

    if (kind === 'REPORT') {
      const rec = parseReport(frame.payload.toString('latin1'));
      if (status.device && rec.header && rec.header['Serial No.']) {
        status.device.serial = rec.header['Serial No.'];
        store.device = status.device;
        broadcast('estado', statusSnapshot());
      }
      const result = {
        id: `${ts}-${rec.header.RecNo || 's/n'}`,
        received: new Date().toISOString(),
        prefix: frame.prefixText,
        device: status.device,
        ...rec,
      };
      store.add(result);
      log(`[store] resultado ${result.id} (${rec.header['Patient Name'] || 'sin nombre'}) guardado`);
      broadcast('resultado', result);
      broadcast('estado', statusSnapshot());
      return;
    }

    log('[serial] trama desconocida ignorada');
  }
}

/* ------------------------------------------------------------------ */
/*  HTTP                                                              */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No encontrado'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

function collectBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('cuerpo demasiado grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    // SSE
    if (p === '/api/eventos') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write('retry: 3000\n\n');
      sendSse(res, 'estado', statusSnapshot());
      sseClients.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 20000);
      req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
      return;
    }

    if (p === '/api/estado') return json(res, 200, statusSnapshot());
    if (p === '/api/equipo') return json(res, 200, status.device || {});

    /* -------- configuración de la conexión -------- */
    if (p === '/api/config' && req.method === 'GET') {
      return json(res, 200, {
        config: configSnapshot(),
        defaults: DEFAULT_CFG,
        serial: status.serial,
        httpActual: status.httpActual,
        ports: await listSerialPorts(),
      });
    }

    if (p === '/api/puertos' && req.method === 'GET') {
      return json(res, 200, { ports: await listSerialPorts() });
    }

    if (p === '/api/config' && req.method === 'POST') {
      const body = await collectBody(req);
      let raw;
      try { raw = JSON.parse(body.toString('utf8') || '{}'); } catch { return json(res, 400, { error: 'JSON inválido' }); }
      const { cfg, errors } = validateConfig(raw);
      if (errors.length) return json(res, 400, { error: 'Configuración inválida', errors });

      const before = { ...CFG };
      const { serialChanged } = serialManager.apply(cfg);
      const httpChanged = (cfg.httpPort !== undefined && cfg.httpPort !== before.httpPort)
        || (cfg.host !== undefined && cfg.host !== before.host);

      log(`[config] guardada: ${JSON.stringify(configSnapshot())} (serialChanged=${serialChanged}, httpChanged=${httpChanged})`);
      return json(res, 200, {
        ok: true,
        config: configSnapshot(),
        serialChanged,
        requiresRestart: httpChanged,
        message: httpChanged
          ? 'Guardado. Los cambios de host/puerto HTTP se aplicarán al reiniciar el servidor.'
          : 'Configuración aplicada; reconectando el puerto serie…',
      });
    }

    if (p === '/api/resultados') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const list = store.results
        .filter((r) => !q || JSON.stringify({ h: r.header, p: r.params }).toLowerCase().includes(q))
        .map((r) => ({
          id: r.id,
          received: r.received,
          header: r.header,
          flags: r.flags || [],
          alertas: Object.entries(r.params || {})
            .filter(([, v]) => v.flags)
            .map(([k, v]) => `${k}:${v.flags}`),
          params: { WBC: r.params?.WBC?.value, RBC: r.params?.RBC?.value, HGB: r.params?.HGB?.value, PLT: r.params?.PLT?.value },
        }));
      return json(res, 200, { total: store.results.length, resultados: list, device: status.device });
    }

    if (req.method === 'GET' && p.startsWith('/api/resultados/')) {
      const id = decodeURIComponent(p.slice('/api/resultados/'.length));
      const r = store.results.find((x) => x.id === id);
      if (!r) return json(res, 404, { error: 'no encontrado' });
      return json(res, 200, r);
    }

    if (p === '/api/export.json') return json(res, 200, { device: status.device, results: store.results });

    if (p.startsWith('/api/resultados/') && req.method === 'DELETE') {
      const id = decodeURIComponent(p.slice('/api/resultados/'.length));
      const idx = store.results.findIndex((x) => x.id === id);
      if (idx < 0) return json(res, 404, { error: 'no encontrado' });
      store.results.splice(idx, 1);
      store.save();
      broadcast('estado', statusSnapshot());
      return json(res, 200, { ok: true });
    }

    // Solo para pruebas locales: inyecta una trama cruda en hexadecimal
    if (p === '/api/dev/replay' && req.method === 'POST') {
      const body = await collectBody(req);
      const obj = JSON.parse(body.toString('utf8') || '{}');
      const raw = Buffer.from(String(obj.hex || '').replace(/[^0-9a-fA-F]/g, ''), 'hex');
      if (!raw.length) return json(res, 400, { error: 'hex vacío' });
      serialManager.parser.push(raw);
      return json(res, 200, { ok: true, bytes: raw.length });
    }

    if (req.method === 'GET') return serveStatic(req, res, p);
    return json(res, 405, { error: 'método no permitido' });
  } catch (e) {
    log('[http] error:', e.message);
    return json(res, 500, { error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/*  Arranque                                                          */
/* ------------------------------------------------------------------ */

store.load();
status.totalResultados = store.results.length;

const serialManager = new SerialManager();
serialManager.start();

server.listen(CFG.httpPort, CFG.host, () => {
  status.httpActual = { host: CFG.host, port: CFG.httpPort };
  try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch { /* ignore */ }
  log(`[http] panel en http://${CFG.host}:${CFG.httpPort} (pid ${process.pid})`);
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║  HEMATOLOGÍA · Resultados en vivo                        ║');
  console.log(`  ║  Panel:  http://${CFG.host}:${CFG.httpPort}${' '.repeat(Math.max(0, 35 - String(CFG.httpPort).length))}║`);
  console.log(`  ║  Serie:  ${CFG.serialPath} @ ${CFG.baudRate} ${framing(CFG)}${' '.repeat(Math.max(0, 33 - `${CFG.serialPath} @ ${CFG.baudRate} ${framing(CFG)}`.length))}║`);
  console.log(`  ║  Config: data/config.json${' '.repeat(Math.max(0, 33 - 'data/config.json'.length))}║`);
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log('');
  broadcast('estado', statusSnapshot());
});

server.on('error', (e) => {
  log('[http] error del servidor:', e.message);
  if (e.code === 'EADDRINUSE') {
    console.error(`El puerto ${CFG.httpPort} está ocupado. Use PORT=3001 node server.js`);
    process.exit(1);
  }
});

process.on('SIGINT', () => {
  log('[app] cerrando...');
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  try { if (serialManager.port && serialManager.port.isOpen) serialManager.port.close(); } catch { /* ignore */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
});
process.on('SIGTERM', () => {
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  process.exit(0);
});
process.on('exit', () => { try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ } });
process.on('uncaughtException', (e) => log('[app] excepción no capturada:', e.stack || e.message));
process.on('unhandledRejection', (e) => log('[app] promesa rechazada:', e && (e.stack || e.message)));
