/** Utilidades comunes. */
'use strict';

/** Marca de tiempo `YYYYMMDD_HHMMSS` en hora local. */
export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Buffer a hexadecimal separado por espacios (minúsculas). */
export const hex = (buf) => Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join(' ');

/** Espera asíncrona. */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
