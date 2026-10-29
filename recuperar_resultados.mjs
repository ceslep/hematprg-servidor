/**
 * Recupera los resultados perdidos a partir de las tramas crudas de data/raw.
 * - Lee cada *_REPORT.bin, valida la trama y parsea el informe.
 * - Reconstruye id y fecha a partir del nombre del archivo original.
 * - Conserva los resultados ya existentes (semillas) y evita duplicados.
 *
 * Uso: node recuperar_resultados.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseReport } = require('./lib/parse-report.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
const RAW = path.join(DATA, 'raw');
const RESULTS_FILE = path.join(DATA, 'resultados.json');

const IGNORAR = new Set(['20261029_075028']); // tramas de la prueba e2e

function frameInfo(buf) {
  const stx = buf.indexOf(0x02);
  const etx = buf.lastIndexOf(0x03);
  if (stx < 0 || etx < 0 || etx <= stx) return null;
  const prefix = buf.subarray(stx - 2, stx).toString('latin1');
  const payload = buf.subarray(stx + 1, etx);
  const csText = buf.subarray(etx + 1, etx + 3).toString('ascii');
  const calc = buf.subarray(stx - 2, etx + 1).reduce((a, b) => a + b, 0) & 0xff;
  return { prefix, payload, checksumOk: calc === parseInt(csText, 16), calc, csText };
}

function stampToIso(stamp) {
  // stamp = YYYYMMDD_HHMMSS en hora local
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!m) return new Date().toISOString();
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return d.toISOString();
}

// 1) Cargar resultados existentes (semillas)
let existentes = [];
let deviceActual = null;
try {
  const data = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  existentes = Array.isArray(data.results) ? data.results : [];
  deviceActual = data.device || null;
} catch { /* sin archivo */ }
const semillas = existentes.filter((r) => String(r.id).startsWith('seed-'));
console.log(`Resultados existentes: ${existentes.length} (semillas: ${semillas.length})`);

// 2) Recorrer archivos de INFO y REPORT en orden
const files = fs.readdirSync(RAW).filter((f) => f.endsWith('.bin')).sort();
let device = deviceActual;
const recuperados = [];

for (const file of files) {
  const base = file.replace(/\.bin$/, '');
  const m = /^(\d{8}_\d{6})_(INFO|REPORT)$/.exec(base);
  if (!m) continue;
  const [, stamp, kind] = m;
  if (IGNORAR.has(stamp)) continue;

  const buf = fs.readFileSync(path.join(RAW, file));
  const info = frameInfo(buf);
  if (!info) continue;
  if (!info.checksumOk) {
    console.warn(`  ! checksum inválido en ${file}`);
    continue;
  }

  if (kind === 'INFO') {
    const parts = info.payload.toString('latin1').split('\t');
    device = { model: parts[0], version: parts[1], date: parts[2], time: parts[3], raw: info.payload.toString('latin1'), serial: device?.serial };
    continue;
  }

  const text = info.payload.toString('latin1');
  const rec = parseReport(text);
  const recno = rec.header.RecNo || 's/n';
  if (rec.header['Serial No.']) device = { ...(device || {}), serial: rec.header['Serial No.'] };
  recuperados.push({
    id: `${stamp}-${recno}`,
    received: stampToIso(stamp),
    prefix: info.prefix,
    device: device ? { ...device } : null,
    ...rec,
  });
}

console.log(`Resultados recuperados de tramas: ${recuperados.length}`);

// 3) Combinar, sin duplicar ids
const porId = new Map();
for (const r of [...recuperados, ...semillas]) porId.set(r.id, r);
const results = [...porId.values()].sort((a, b) => new Date(b.received) - new Date(a.received));

fs.writeFileSync(RESULTS_FILE, JSON.stringify({ device: device || deviceActual, results }, null, 2));
console.log(`Guardados ${results.length} resultados en ${RESULTS_FILE}`);
