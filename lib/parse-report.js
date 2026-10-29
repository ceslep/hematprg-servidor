/**
 * Parser del informe de texto del Diatron Aquarius 3.
 * Compartido por el servidor y las herramientas de recuperación.
 */
'use strict';

function parseReport(text) {
  const rec = { header: {}, params: {}, flags: [], graphs: {}, raw_text: text };
  const lines = text.split('\r\n');
  let i = 0;

  while (i < lines.length) {
    const ln = lines[i];
    if (ln.startsWith('Param\tFlags')) { i++; break; }
    if (ln.includes(':\t')) {
      const idx = ln.indexOf(':\t');
      const k = ln.slice(0, idx);
      const v = ln.slice(idx + 2);
      if (k === 'Age') {
        const parts = v.split('\t');
        rec.header[k] = parts[0].trim();
        if (parts.length > 1) rec.header[k + '_unit'] = parts[1].trim();
      } else {
        rec.header[k] = v.trim();
      }
    }
    i++;
  }

  while (i < lines.length && !lines[i].startsWith('Flags:')) {
    const parts = lines[i].split('\t');
    if (parts.length >= 3 && parts[0].trim()) {
      const name = parts[0].trim();
      rec.params[name] = {
        flags: (parts[1] || '').trim(),
        value: (parts[2] || '').trim(),
        unit: (parts[3] || '').trim(),
        range: (parts[4] || '').trim(),
      };
    }
    i++;
  }

  if (i < lines.length && lines[i].startsWith('Flags:')) {
    const tail = lines[i].slice(6).trim();
    if (tail) rec.flags.push(tail);
    i++;
  }

  while (i < lines.length) {
    const ln = lines[i];
    if (ln.endsWith(' graph')) {
      const g = { name: ln.slice(0, -6).trim() };
      i++;
      while (i < lines.length && !lines[i].endsWith(' graph')) {
        const line = lines[i];
        if (line.includes(':\t')) {
          const idx = line.indexOf(':\t');
          const k = line.slice(0, idx);
          const v = line.slice(idx + 2);
          if (k === 'Points') {
            g.points = v.split('\t').filter((x) => x.trim() !== '' && /^\d+$/.test(x.trim())).map(Number);
          } else {
            const n = Number(v);
            g[k] = Number.isFinite(n) ? n : v;
          }
        } else if (line.includes('\t')) {
          const idx = line.indexOf('\t');
          const k = line.slice(0, idx);
          const raw = line.slice(idx + 1);
          const n = Number(raw);
          g[k] = Number.isFinite(n) && raw.trim() !== '' ? n : raw;
        }
        i++;
      }
      rec.graphs[g.name] = g;
      continue;
    }
    i++;
  }
  return rec;
}

module.exports = { parseReport };
