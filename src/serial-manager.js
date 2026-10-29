/** Gestión del puerto serie: apertura, reconexión automática y decodificación. */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { SerialPort } from 'serialport';

import { framing, SERIAL_KEYS } from './config.js';
import { FrameParser, ACK } from './protocol.js';
import { parseReport } from './parse-report.js';
import { hex, stamp } from './util.js';

export class SerialManager {
  #config;
  #logger;
  #status;
  #store;
  #bus;
  #snapshot;
  #rawDir;
  #port = null;
  #opening = false;
  #retryTimer = null;
  #manualClose = false;
  #reopenDone = true;
  #failCount = 0;

  /**
   * @param {{config: object, logger: object, status: object, store: object, bus: object,
   *          snapshot: () => object, rawDir: string}} deps
   */
  constructor({ config, logger, status, store, bus, snapshot, rawDir }) {
    this.#config = config;
    this.#logger = logger;
    this.#status = status;
    this.#store = store;
    this.#bus = bus;
    this.#snapshot = snapshot;
    this.#rawDir = rawDir;
    this.parser = new FrameParser({
      onFrame: (frame) => this.#handleFrame(frame),
      onEvent: (event) => this.#handleEvent(event),
    });
  }

  get port() {
    return this.#port;
  }

  start() {
    this.#open();
  }

  #emitStatus() {
    this.#bus.emit('estado', this.#snapshot());
  }

  #scheduleReconnect(reason) {
    if (this.#retryTimer) return;
    this.#status.setSerial({ reconnecting: true });
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#open();
    }, this.#config.reconnectMs);
  }

  #open() {
    if (this.#opening || (this.#port && this.#port.isOpen)) return;
    this.#opening = true;
    this.#status.setSerial({ reconnecting: false });
    if (this.#failCount === 0) {
      this.#logger.log(`[serial] abriendo ${this.#config.serialPath} @ ${this.#config.baudRate} ${framing(this.#config)}`);
    }

    const port = new SerialPort({
      path: this.#config.serialPath,
      baudRate: this.#config.baudRate,
      dataBits: this.#config.dataBits,
      stopBits: this.#config.stopBits,
      parity: this.#config.parity,
      autoOpen: false,
    });
    this.#port = port;

    port.open((error) => {
      this.#opening = false;

      if (error) {
        this.#failCount += 1;
        if (this.#failCount === 1 || this.#failCount % 20 === 0) {
          this.#logger.log(`[serial] no se pudo abrir ${this.#config.serialPath}: ${error.message} (intento ${this.#failCount})`);
        }
        this.#status.setSerial({ connected: false, lastError: error.message });
        try { port.destroy(); } catch { /* ignore */ }
        this.#port = null;
        this.#scheduleReconnect('open');
        return;
      }

      if (this.#failCount > 0) this.#logger.log(`[serial] conexión recuperada tras ${this.#failCount} intento(s)`);
      this.#failCount = 0;
      this.parser.reset();
      this.#status.setSerial({ connected: true, lastError: null, reconnecting: false, openedAt: new Date().toISOString() });
      this.#logger.log(`[serial] puerto abierto y escuchando (${framing(this.#config)})`);
      this.#emitStatus();

      port.on('data', (data) => {
        this.#status.state.serial.bytes += data.length;
        this.#status.state.serial.lastDataAt = new Date().toISOString();
        this.parser.push(data);
      });

      port.on('error', (streamError) => {
        this.#logger.log('[serial] error:', streamError.message);
        this.#status.setSerial({ connected: false, lastError: streamError.message });
        this.#emitStatus();
      });

      port.on('close', () => {
        this.#logger.log('[serial] puerto cerrado');
        this.#status.setSerial({ connected: false });
        this.#emitStatus();
        if (this.#port === port) this.#port = null;
        if (this.#manualClose) return;
        this.#scheduleReconnect('close');
      });
    });
  }

  /**
   * Aplica configuración ya validada y reconecta si cambió algo del puerto serie.
   * @returns {{serialChanged: boolean}}
   */
  apply(newConfig) {
    const serialChanged = SERIAL_KEYS.some((key) => newConfig[key] !== undefined && newConfig[key] !== this.#config[key]);
    Object.assign(this.#config, newConfig);
    this.#status.refreshConfig(this.#config);
    this.#emitStatus();

    if (serialChanged) {
      this.#logger.log('[config] reconectando puerto serie con la nueva configuración');
      this.#closeAndReopen();
    }
    return { serialChanged };
  }

  #closeAndReopen() {
    if (this.#retryTimer) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }

    const port = this.#port;
    this.#port = null;
    this.#manualClose = true;
    this.#reopenDone = false;

    const done = () => {
      if (this.#reopenDone) return;
      this.#reopenDone = true;
      this.#manualClose = false;
      this.#opening = false;
      this.#open();
    };

    if (port && port.isOpen) {
      try { port.close(() => done()); } catch { done(); }
    } else {
      try { port && port.destroy(); } catch { /* ignore */ }
      done();
    }
  }

  #handleEvent(event) {
    if (event.type === 'enq') {
      this.#logger.log('[serial] ENQ recibido');
      if (this.#config.ackOnEnq && this.#port && this.#port.isOpen) this.#port.write(Buffer.from([ACK]));
    }
  }

  #handleFrame(frame) {
    this.#status.state.serial.frames += 1;
    const text = frame.payload.toString('latin1');
    const kind = frame.payload.includes(Buffer.from('Serial No.:'))
      ? 'REPORT'
      : frame.payload.subarray(0, 12).toString('latin1').startsWith('Aquarius') ? 'INFO' : 'UNKNOWN';

    this.#logger.log(`[serial] trama ${kind} prefijo=${frame.prefixText} ${frame.payload.length}B checksum=${frame.checksumOk ? 'OK' : 'MAL'}`);
    if (!frame.checksumOk) {
      this.#logger.log('[serial] checksum inválido, se descarta');
      return;
    }

    const timestamp = stamp();
    try {
      const base = path.join(this.#rawDir, `${timestamp}_${kind}`);
      fs.writeFileSync(`${base}.bin`, frame.frame);
      fs.writeFileSync(`${base}.hex`, hex(frame.frame));
    } catch (error) {
      this.#logger.log('[serial] no se pudo guardar la trama:', error.message);
    }

    if (kind === 'INFO') {
      const parts = text.split('\t');
      const device = {
        model: parts[0],
        version: parts[1],
        date: parts[2],
        time: parts[3],
        raw: text,
        serial: this.#status.state.device?.serial,
      };
      this.#status.state.device = device;
      this.#store.device = device;
      this.#store.save();
      this.#logger.log('[serial] equipo:', JSON.stringify(device));
      this.#bus.emit('equipo', device);
      this.#emitStatus();
      return;
    }

    if (kind === 'REPORT') {
      const rec = parseReport(text);
      const device = this.#status.state.device;
      if (device && rec.header?.['Serial No.']) {
        device.serial = rec.header['Serial No.'];
        this.#store.device = device;
        this.#emitStatus();
      }
      const result = {
        id: `${timestamp}-${rec.header.RecNo || 's/n'}`,
        received: new Date().toISOString(),
        prefix: frame.prefixText,
        device,
        ...rec,
      };
      this.#store.add(result);
      this.#logger.log(`[store] resultado ${result.id} (${rec.header['Patient Name'] || 'sin nombre'}) guardado`);
      this.#bus.emit('resultado', result);
      this.#emitStatus();
      return;
    }

    this.#logger.log('[serial] trama desconocida ignorada');
  }
}
