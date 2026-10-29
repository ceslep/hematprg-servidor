/** Configuración de la conexión serie y del servidor, con persistencia en JSON. */
'use strict';

import fs from 'node:fs';
import { SerialPort } from 'serialport';

export const DEFAULT_CONFIG = Object.freeze({
  serialPath: 'COM3',
  baudRate: 115200,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  ackOnEnq: false,
  reconnectMs: 3000,
  httpPort: 3000,
  host: '127.0.0.1',
});

export const PARITIES = Object.freeze(['none', 'even', 'odd', 'mark', 'space']);

/** Claves que afectan al puerto serie (se aplican en caliente). */
export const SERIAL_KEYS = Object.freeze([
  'serialPath', 'baudRate', 'dataBits', 'parity', 'stopBits', 'ackOnEnq', 'reconnectMs',
]);

const PARITY_LETTER = Object.freeze({ none: 'N', even: 'E', odd: 'O', mark: 'M', space: 'S' });

/**
 * Valida y normaliza un objeto de configuración parcial.
 * @returns {{cfg: object, errors: string[]}}
 */
export function validateConfig(raw = {}) {
  const cfg = {};
  const errors = [];

  if (raw.serialPath !== undefined) {
    const value = String(raw.serialPath).trim();
    if (!/^[A-Za-z0-9._:\\/-]{1,64}$/.test(value)) errors.push('Puerto serie inválido (ej. COM3)');
    else cfg.serialPath = /^com\d+$/i.test(value) ? value.toUpperCase() : value;
  }
  if (raw.baudRate !== undefined) {
    const value = Number(raw.baudRate);
    if (!Number.isInteger(value) || value < 300 || value > 2_000_000) errors.push('Velocidad en baudios inválida');
    else cfg.baudRate = value;
  }
  if (raw.dataBits !== undefined) {
    const value = Number(raw.dataBits);
    if (![5, 6, 7, 8].includes(value)) errors.push('Bits de datos inválidos (5-8)');
    else cfg.dataBits = value;
  }
  if (raw.parity !== undefined) {
    const value = String(raw.parity).toLowerCase();
    if (!PARITIES.includes(value)) errors.push(`Paridad inválida (${PARITIES.join(', ')})`);
    else cfg.parity = value;
  }
  if (raw.stopBits !== undefined) {
    const value = Number(raw.stopBits);
    if (![1, 1.5, 2].includes(value)) errors.push('Bits de parada inválidos (1, 1.5, 2)');
    else cfg.stopBits = value;
  }
  if (raw.ackOnEnq !== undefined) {
    cfg.ackOnEnq = raw.ackOnEnq === true || raw.ackOnEnq === 'true' || raw.ackOnEnq === 1 || raw.ackOnEnq === '1';
  }
  if (raw.reconnectMs !== undefined) {
    const value = Number(raw.reconnectMs);
    if (!Number.isInteger(value) || value < 200 || value > 300_000) errors.push('Tiempo de reintento inválido (200-300000 ms)');
    else cfg.reconnectMs = value;
  }
  if (raw.httpPort !== undefined) {
    const value = Number(raw.httpPort);
    if (!Number.isInteger(value) || value < 1 || value > 65_535) errors.push('Puerto HTTP inválido (1-65535)');
    else cfg.httpPort = value;
  }
  if (raw.host !== undefined) {
    const value = String(raw.host).trim();
    if (!/^[A-Za-z0-9.:-]{1,64}$/.test(value)) errors.push('Host inválido (ej. 127.0.0.1)');
    else cfg.host = value;
  }

  return { cfg, errors };
}

/**
 * Carga la configuración: por defecto → variables de entorno → `config.json` (prioridad).
 * @param {string} configFile
 * @param {(...args: any[]) => void} [log]
 */
export function loadConfig(configFile, log = () => {}) {
  const cfg = { ...DEFAULT_CONFIG };

  if (process.env.PORT) cfg.httpPort = Number(process.env.PORT);
  if (process.env.HOST) cfg.host = process.env.HOST;
  if (process.env.SERIAL_PORT) cfg.serialPath = process.env.SERIAL_PORT;
  if (process.env.BAUD) cfg.baudRate = Number(process.env.BAUD);
  if (process.env.SERIAL_ACK) cfg.ackOnEnq = process.env.SERIAL_ACK === '1';
  if (process.env.RECONNECT_MS) cfg.reconnectMs = Number(process.env.RECONNECT_MS);

  try {
    if (fs.existsSync(configFile)) {
      const file = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      const { cfg: fileCfg, errors } = validateConfig(file);
      if (errors.length) log('[config] avisos en config.json:', errors.join('; '));
      Object.assign(cfg, fileCfg);
    }
  } catch (error) {
    log('[config] no se pudo leer config.json:', error.message);
  }

  return cfg;
}

/** Guarda la configuración en disco. */
export function saveConfig(configFile, cfg, log = () => {}) {
  try {
    fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2));
  } catch (error) {
    log('[config] no se pudo guardar config.json:', error.message);
  }
}

export function parityLetter(parity) {
  return PARITY_LETTER[parity] || 'N';
}

/** Ej. `8N1`, `7E1`. */
export function framing(cfg) {
  return `${cfg.dataBits}${parityLetter(cfg.parity)}${cfg.stopBits}`;
}

/** Copia con el resumen de framing para exponer por API. */
export function configSnapshot(cfg) {
  return { ...cfg, framing: framing(cfg) };
}

/** Puertos serie detectados en el sistema. */
export async function listSerialPorts(log = () => {}) {
  try {
    const ports = await SerialPort.list();
    return ports.map((port) => ({
      path: port.path,
      manufacturer: port.manufacturer || '',
      serialNumber: port.serialNumber || '',
      friendlyName: port.friendlyName || port.path,
      vendorId: port.vendorId || '',
      productId: port.productId || '',
      pnpId: port.pnpId || '',
    }));
  } catch (error) {
    log('[config] no se pudieron listar los puertos:', error.message);
    return [];
  }
}
