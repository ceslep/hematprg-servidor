/**
 * Protocolo Diatron observado en el Aquarius 3:
 *
 *   SOH(0x01) + prefijo(2 ASCII) + STX(0x02) + texto + ETX(0x03)
 *   + checksum(2 hex ASCII) + EOT(0x04)
 *
 * prefijo: 1.er byte = secuencia, 2.º byte = tipo (`I` identificación, `N` informe).
 * checksum = suma de los bytes desde el prefijo (incl.) hasta ETX (incl.), `& 0xFF`.
 */
'use strict';

export const SOH = 0x01;
export const STX = 0x02;
export const ETX = 0x03;
export const EOT = 0x04;
export const ENQ = 0x05;
export const ACK = 0x06;
export const NAK = 0x15;

/**
 * Extrae una trama completa de un buffer (para recuperación/auditoría).
 * @param {Buffer} buf
 * @returns {null | {prefix: string, payload: Buffer, checksumOk: boolean, calc: number, given: number, csText: string, frame: Buffer}}
 */
export function parseFrame(buf) {
  const stx = buf.indexOf(STX);
  const etx = buf.lastIndexOf(ETX);
  if (stx < 2 || etx < 0 || etx <= stx) return null;

  const prefix = buf.subarray(stx - 2, stx).toString('latin1');
  const payload = buf.subarray(stx + 1, etx);
  const csText = buf.subarray(etx + 1, etx + 3).toString('ascii');
  const calc = buf.subarray(stx - 2, etx + 1).reduce((sum, byte) => sum + byte, 0) & 0xff;
  const given = Number.parseInt(csText, 16);

  let end = etx + 3;
  if (buf.length > end && buf[end] === EOT) end += 1;

  return {
    prefix,
    payload,
    checksumOk: calc === given,
    calc,
    given,
    csText,
    frame: Buffer.from(buf.subarray(0, end)),
  };
}

/** Parser incremental de tramas sobre el stream serie. */
export class FrameParser {
  #buf = Buffer.alloc(0);
  #onFrame;
  #onEvent;

  /**
   * @param {{onFrame: (frame: object) => void, onEvent?: (event: object) => void}} options
   */
  constructor({ onFrame, onEvent = () => {} }) {
    this.#onFrame = onFrame;
    this.#onEvent = onEvent;
  }

  /** Alimenta bytes nuevos y emite las tramas completas. */
  push(chunk) {
    this.#buf = Buffer.concat([this.#buf, chunk]);
    let progressed = true;

    while (progressed) {
      progressed = false;
      if (this.#buf.length === 0) break;

      if (this.#buf[0] === ENQ) {
        this.#onEvent({ type: 'enq' });
        this.#buf = this.#buf.subarray(1);
        progressed = true;
        continue;
      }

      if (this.#buf[0] === SOH) {
        // SOH + 2 de prefijo + STX
        if (this.#buf.length < 4) break;
        if (this.#buf[3] !== STX) {
          this.#onEvent({ type: 'ruido', byte: this.#buf[0] });
          this.#buf = this.#buf.subarray(1);
          progressed = true;
          continue;
        }

        const etx = this.#buf.indexOf(ETX, 4);
        if (etx < 0) break;
        if (this.#buf.length < etx + 3) break;

        const prefix = this.#buf.subarray(1, 3);
        const payload = this.#buf.subarray(4, etx);
        const csText = this.#buf.subarray(etx + 1, etx + 3).toString('ascii');
        const calc = this.#buf.subarray(1, etx + 1).reduce((sum, byte) => sum + byte, 0) & 0xff;
        const given = Number.parseInt(csText, 16);

        let end = etx + 3;
        if (this.#buf.length > end && this.#buf[end] === EOT) end += 1;
        const frame = Buffer.from(this.#buf.subarray(0, end));
        this.#buf = this.#buf.subarray(end);

        this.#onFrame({
          prefix,
          prefixText: prefix.toString('latin1'),
          payload,
          checksumOk: calc === given,
          calc,
          given,
          csText,
          frame,
        });
        progressed = true;
        continue;
      }

      this.#onEvent({ type: 'ruido', byte: this.#buf[0] });
      this.#buf = this.#buf.subarray(1);
      progressed = true;
    }
  }

  /** Descarta datos pendientes (al abrir el puerto). */
  reset() {
    this.#buf = Buffer.alloc(0);
  }
}
