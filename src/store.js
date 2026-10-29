/** Almacén de resultados en JSON (con importación de capturas previas). */
'use strict';

import fs from 'node:fs';
import path from 'node:path';

export class ResultStore {
  #file;
  #seedDir;
  #log;

  results = [];
  device = null;

  /**
   * @param {{file: string, seedDir?: string|null, log?: (...args: any[]) => void}} options
   */
  constructor({ file, seedDir = null, log = () => {} }) {
    this.#file = file;
    this.#seedDir = seedDir;
    this.#log = log;
  }

  get total() {
    return this.results.length;
  }

  find(id) {
    return this.results.find((result) => result.id === id);
  }

  search(query) {
    const q = String(query || '').toLowerCase();
    if (!q) return this.results;
    return this.results.filter((result) => JSON.stringify({ header: result.header, params: result.params }).toLowerCase().includes(q));
  }

  load() {
    try {
      if (fs.existsSync(this.#file)) {
        const data = JSON.parse(fs.readFileSync(this.#file, 'utf8'));
        this.results = Array.isArray(data.results) ? data.results : [];
        this.device = data.device || null;
        this.#log(`[store] ${this.results.length} resultados cargados`);
        return;
      }
    } catch (error) {
      this.#log('[store] error cargando:', error.message);
    }
    this.#seedFromExisting();
  }

  /** Importa los JSON capturados por el receptor Python en ../resultados. */
  #seedFromExisting() {
    if (!this.#seedDir) return;
    try {
      if (!fs.existsSync(this.#seedDir)) return;
      const files = fs.readdirSync(this.#seedDir).filter((file) => /^resultado_.*\.json$/.test(file));
      for (const file of files) {
        try {
          const rec = JSON.parse(fs.readFileSync(path.join(this.#seedDir, file), 'utf8'));
          const meta = rec._meta || {};
          this.results.push({
            id: `seed-${file.replace(/\.json$/, '')}`,
            received: meta.received || new Date().toISOString(),
            header: rec.header || {},
            params: rec.params || {},
            flags: rec.flags || [],
            graphs: rec.graphs || {},
            raw_text: rec.raw_text || '',
            device: this.device,
            prefix: meta.prefix || null,
          });
        } catch (error) {
          this.#log(`[store] no se pudo importar ${file}:`, error.message);
        }
      }
      if (this.results.length) {
        this.#log(`[store] importados ${this.results.length} resultados existentes`);
        this.save();
      }
    } catch (error) {
      this.#log('[store] seed error:', error.message);
    }
  }

  save() {
    try {
      fs.writeFileSync(this.#file, JSON.stringify({ device: this.device, results: this.results }, null, 2));
    } catch (error) {
      this.#log('[store] error guardando:', error.message);
    }
  }

  add(result) {
    this.results.unshift(result);
    this.save();
    return result;
  }

  remove(id) {
    const index = this.results.findIndex((result) => result.id === id);
    if (index < 0) return false;
    this.results.splice(index, 1);
    this.save();
    return true;
  }
}
