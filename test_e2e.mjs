/**
 * Prueba end-to-end local (no forma parte del servidor):
 *  - se conecta al stream SSE
 *  - inyecta las tramas capturadas del equipo por /api/dev/replay
 *  - verifica que llega el evento 'resultado'
 *  - borra el resultado de prueba
 * Uso: node test_e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:3000';

const events = [];
let resultResolve;
const resultPromise = new Promise((resolve) => { resultResolve = resolve; });

const req = http.get(BASE + '/api/eventos', (res) => {
  res.setEncoding('utf8');
  let buf = '';
  res.on('data', (chunk) => {
    buf += chunk;
    const blocks = buf.split('\n\n');
    buf = blocks.pop() || '';
    for (const b of blocks) {
      const ev = /event: (\w+)/.exec(b);
      const data = /data: (.+)/.exec(b);
      if (ev) {
        const item = { event: ev[1], data: data ? JSON.parse(data[1]) : null };
        events.push(item);
        if (item.event === 'resultado') resultResolve(item.data);
      }
    }
  });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(500); // deja establecer la conexión SSE

const rawDir = path.join(HERE, '..', 'resultados', 'raw');
const hexOf = (f) => fs.readFileSync(path.join(rawDir, f)).toString('hex');
async function replay(hex) {
  const r = await fetch(BASE + '/api/dev/replay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hex }),
  });
  return r.json();
}

const antes = new Set((await (await fetch(BASE + '/api/resultados')).json()).resultados.map((r) => r.id));
const rawDirServidor = path.join(HERE, 'data', 'raw');
const rawAntes = new Set(fs.readdirSync(rawDirServidor));
const rawCapturas = path.join(HERE, '..', 'resultados', 'raw');

await replay(hexOf('20261028_173139_INFO.bin'));
await replay(hexOf('20261028_173141_REPORT.bin'));

const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 5000));
const nuevo = await Promise.race([resultPromise, timeout]);
req.destroy();

console.log('eventos SSE recibidos:', events.map((e) => e.event).join(', '));
if (nuevo) {
  console.log('resultado por SSE:', nuevo.id, '|', nuevo.header?.['Patient Name'], '| params:', Object.keys(nuevo.params || {}).length, '| graphs:', Object.keys(nuevo.graphs || {}).join(','));
}

// Limpieza: borrar SOLO el resultado y las tramas creadas por esta prueba
const list = await (await fetch(BASE + '/api/resultados')).json();
const creados = list.resultados.filter((r) => !antes.has(r.id));
for (const r of creados) {
  await fetch(BASE + '/api/resultados/' + encodeURIComponent(r.id), { method: 'DELETE' });
  console.log('borrado de prueba:', r.id);
}
for (const f of fs.readdirSync(rawDirServidor)) {
  if (!rawAntes.has(f)) {
    fs.unlinkSync(path.join(rawDirServidor, f));
    console.log('trama de prueba borrada:', f);
  }
}
const final = await (await fetch(BASE + '/api/resultados')).json();
console.log('total final:', final.total);
console.log(nuevo ? '✅ OK: SSE, parser y almacenamiento funcionan' : '❌ FALLO: no llegó evento resultado');
