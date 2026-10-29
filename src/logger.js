/** Logger con rotación de archivo (2 MB por defecto). */
'use strict';

import fs from 'node:fs';

/**
 * @param {string} filePath Ruta del archivo de log.
 * @param {number} [maxBytes] Tamaño máximo antes de rotar a `.1`.
 */
export function createLogger(filePath, maxBytes = 2 * 1024 * 1024) {
  let bytes = null;

  function log(...args) {
    const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
    console.log(line);
    try {
      if (bytes === null) bytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
      if (bytes > maxBytes) {
        try { fs.renameSync(filePath, `${filePath}.1`); } catch { /* ignore */ }
        bytes = 0;
      }
      fs.appendFileSync(filePath, `${line}\n`);
      bytes += Buffer.byteLength(line) + 1;
    } catch { /* ignore */ }
  }

  return { log, filePath };
}
