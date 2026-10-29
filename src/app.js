/** Servidor HTTP: API REST, SSE en vivo y panel web estático. */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

import {
  configSnapshot, DEFAULT_CONFIG, listSerialPorts, saveConfig, validateConfig,
} from './config.js';

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
});

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function collectBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function serveStatic(res, publicDir, urlPath) {
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(publicDir, relative);
  if (!file.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

/**
 * @param {{config: object, configFile: string, logger: object, store: object, status: object,
 *          bus: object, serialManager: object, publicDir: string, dataDir: string,
 *          snapshot: () => object}} deps
 * @returns {http.Server}
 */
export function createServer({ config, configFile, logger, store, status, bus, serialManager, publicDir, dataDir, snapshot }) {
  const writeEvent = (res, event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch { /* cliente cerrado */ }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    try {
      // -------- SSE en vivo --------
      if (pathname === '/api/eventos') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        res.write('retry: 3000\n\n');
        writeEvent(res, 'estado', snapshot());

        const listeners = ['estado', 'equipo', 'resultado'].map((event) => {
          const listener = (data) => writeEvent(res, event, data);
          bus.on(event, listener);
          return [event, listener];
        });
        const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 20_000);

        req.on('close', () => {
          clearInterval(ping);
          for (const [event, listener] of listeners) bus.off(event, listener);
        });
        return;
      }

      if (pathname === '/api/estado') return sendJson(res, 200, snapshot());
      if (pathname === '/api/equipo') return sendJson(res, 200, status.state.device || {});

      // -------- configuración de la conexión --------
      if (pathname === '/api/config' && req.method === 'GET') {
        return sendJson(res, 200, {
          config: configSnapshot(config),
          defaults: DEFAULT_CONFIG,
          serial: status.state.serial,
          httpActual: status.state.httpActual,
          ports: await listSerialPorts(logger.log),
        });
      }

      if (pathname === '/api/puertos' && req.method === 'GET') {
        return sendJson(res, 200, { ports: await listSerialPorts(logger.log) });
      }

      if (pathname === '/api/config' && req.method === 'POST') {
        const body = await collectBody(req);
        let raw;
        try { raw = JSON.parse(body.toString('utf8') || '{}'); } catch { return sendJson(res, 400, { error: 'JSON inválido' }); }

        const { cfg, errors } = validateConfig(raw);
        if (errors.length) return sendJson(res, 400, { error: 'Configuración inválida', errors });

        const before = { ...config };
        const { serialChanged } = serialManager.apply(cfg);
        saveConfig(configFile, config, logger.log);

        const httpChanged = (cfg.httpPort !== undefined && cfg.httpPort !== before.httpPort)
          || (cfg.host !== undefined && cfg.host !== before.host);
        logger.log(`[config] guardada: ${JSON.stringify(configSnapshot(config))} (serialChanged=${serialChanged}, httpChanged=${httpChanged})`);

        return sendJson(res, 200, {
          ok: true,
          config: configSnapshot(config),
          serialChanged,
          requiresRestart: httpChanged,
          message: httpChanged
            ? 'Guardado. Los cambios de host/puerto HTTP se aplicarán al reiniciar el servidor.'
            : 'Configuración aplicada; reconectando el puerto serie…',
        });
      }

      // -------- resultados --------
      if (pathname === '/api/resultados') {
        const query = url.searchParams.get('q') || '';
        const list = store.search(query).map((result) => ({
          id: result.id,
          received: result.received,
          header: result.header,
          flags: result.flags || [],
          alertas: Object.entries(result.params || {})
            .filter(([, value]) => value.flags)
            .map(([key, value]) => `${key}:${value.flags}`),
          params: {
            WBC: result.params?.WBC?.value,
            RBC: result.params?.RBC?.value,
            HGB: result.params?.HGB?.value,
            PLT: result.params?.PLT?.value,
          },
        }));
        return sendJson(res, 200, { total: store.total, resultados: list, device: status.state.device });
      }

      if (req.method === 'GET' && pathname.startsWith('/api/resultados/')) {
        const id = decodeURIComponent(pathname.slice('/api/resultados/'.length));
        const result = store.find(id);
        if (!result) return sendJson(res, 404, { error: 'no encontrado' });
        return sendJson(res, 200, result);
      }

      if (pathname.startsWith('/api/resultados/') && req.method === 'DELETE') {
        const id = decodeURIComponent(pathname.slice('/api/resultados/'.length));
        if (!store.remove(id)) return sendJson(res, 404, { error: 'no encontrado' });
        bus.emit('estado', snapshot());
        return sendJson(res, 200, { ok: true });
      }

      if (pathname === '/api/export.json') {
        return sendJson(res, 200, { device: status.state.device, results: store.results });
      }

      // -------- solo pruebas locales: inyectar trama cruda --------
      if (pathname === '/api/dev/replay' && req.method === 'POST') {
        const body = await collectBody(req);
        const payload = JSON.parse(body.toString('utf8') || '{}');
        const raw = Buffer.from(String(payload.hex || '').replace(/[^0-9a-fA-F]/g, ''), 'hex');
        if (!raw.length) return sendJson(res, 400, { error: 'hex vacío' });
        serialManager.parser.push(raw);
        return sendJson(res, 200, { ok: true, bytes: raw.length });
      }

      if (req.method === 'GET') return serveStatic(res, publicDir, pathname);
      return sendJson(res, 405, { error: 'método no permitido' });
    } catch (error) {
      logger.log('[http] error:', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  });

  return server;
}
