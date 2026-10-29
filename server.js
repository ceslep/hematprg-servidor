#!/usr/bin/env node
/**
 * Servidor de resultados — Diatron Aquarius 3 por USB-Serie
 * ---------------------------------------------------------
 * Punto de entrada. La lógica está repartida en `src/`:
 *   config.js          configuración y puertos
 *   protocol.js        tramas Diatron (parser incremental)
 *   parse-report.js    informe de texto → objeto
 *   serial-manager.js  apertura, reconexión y decodificación
 *   store.js           almacén JSON de resultados
 *   status.js          estado en memoria
 *   bus.js             eventos internos (SSE)
 *   app.js             HTTP + SSE + estáticos
 *   logger.js          log con rotación
 *
 * Ejecutar:  node server.js        (o  npm start)
 * Panel:     http://127.0.0.1:3000
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from './src/app.js';
import { Bus } from './src/bus.js';
import { framing, loadConfig } from './src/config.js';
import { createLogger } from './src/logger.js';
import { SerialManager } from './src/serial-manager.js';
import { createStatus } from './src/status.js';
import { ResultStore } from './src/store.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const RAW_DIR = path.join(DATA_DIR, 'raw');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PID_FILE = path.join(DATA_DIR, 'servidor.pid');

fs.mkdirSync(RAW_DIR, { recursive: true });

const logger = createLogger(path.join(DATA_DIR, 'servidor.log'));
const config = loadConfig(CONFIG_FILE, logger.log);

const store = new ResultStore({
  file: path.join(DATA_DIR, 'resultados.json'),
  seedDir: path.join(ROOT, '..', 'resultados'),
  log: logger.log,
});
store.load();

const status = createStatus(config);
const bus = new Bus();
const snapshot = () => status.snapshot(store.total);

const serialManager = new SerialManager({
  config,
  logger,
  status,
  store,
  bus,
  snapshot,
  rawDir: RAW_DIR,
});

const server = createServer({
  config,
  configFile: CONFIG_FILE,
  logger,
  store,
  status,
  bus,
  serialManager,
  publicDir: path.join(ROOT, 'public'),
  dataDir: DATA_DIR,
  snapshot,
});

server.on('error', (error) => {
  logger.log('[http] error del servidor:', error.message);
  if (error.code === 'EADDRINUSE') {
    console.error(`El puerto ${config.httpPort} está ocupado. Use PORT=3001 node server.js`);
    process.exit(1);
  }
});

server.listen(config.httpPort, config.host, () => {
  status.state.httpActual = { host: config.host, port: config.httpPort };
  try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch { /* ignore */ }
  logger.log(`[http] panel en http://${config.host}:${config.httpPort} (pid ${process.pid})`);

  const panelUrl = `http://${config.host}:${config.httpPort}`;
  const serialLine = `${config.serialPath} @ ${config.baudRate} ${framing(config)}`;
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║  HEMATOLOGÍA · Resultados en vivo                        ║');
  console.log(`  ║  Panel:  ${panelUrl.padEnd(48)}║`);
  console.log(`  ║  Serie:  ${serialLine.padEnd(48)}║`);
  console.log('  ║  Módulos: ES Modules (Node.js)                           ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log('');

  bus.emit('estado', snapshot());
});

serialManager.start();

function cleanupPid() {
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
}

process.on('SIGINT', () => {
  logger.log('[app] cerrando...');
  cleanupPid();
  try { serialManager.port?.close(); } catch { /* ignore */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
});

process.on('SIGTERM', () => {
  cleanupPid();
  process.exit(0);
});

process.on('exit', cleanupPid);
process.on('uncaughtException', (error) => logger.log('[app] excepción no capturada:', error.stack || error.message));
process.on('unhandledRejection', (error) => logger.log('[app] promesa rechazada:', error?.stack || error));
