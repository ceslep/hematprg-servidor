/** Estado en memoria del servidor (conexión serie, equipo, configuración). */
'use strict';

import { framing } from './config.js';

/**
 * @param {object} config Configuración inicial (mutable, compartida).
 */
export function createStatus(config) {
  const state = {
    startedAt: new Date().toISOString(),
    serial: {
      path: config.serialPath,
      baudRate: config.baudRate,
      dataBits: config.dataBits,
      parity: config.parity,
      stopBits: config.stopBits,
      framing: framing(config),
      connected: false,
      reconnecting: false,
      lastError: null,
      openedAt: null,
      lastDataAt: null,
      bytes: 0,
      frames: 0,
    },
    config: { ...config, framing: framing(config) },
    httpActual: { host: config.host, port: config.httpPort },
    device: null,
  };

  return {
    state,

    /** Aplica un parche a los campos de la conexión serie. */
    setSerial(patch) {
      Object.assign(state.serial, patch);
    },

    /** Refleja en el estado una configuración nueva (aplicada en caliente). */
    refreshConfig(cfg) {
      state.config = { ...cfg, framing: framing(cfg) };
      Object.assign(state.serial, {
        path: cfg.serialPath,
        baudRate: cfg.baudRate,
        dataBits: cfg.dataBits,
        parity: cfg.parity,
        stopBits: cfg.stopBits,
        framing: framing(cfg),
      });
    },

    /** Instantánea inmutable para la API y SSE. */
    snapshot(totalResultados) {
      return {
        ...state,
        serial: { ...state.serial },
        config: { ...state.config },
        device: state.device,
        totalResultados,
      };
    },
  };
}
