/** Parser del informe de texto que envía el Diatron Aquarius 3. */
'use strict';

/**
 * Convierte el informe de texto en un objeto estructurado.
 * @param {string} text Texto entre STX y ETX.
 */
export function parseReport(text) {
  const rec = { header: {}, params: {}, flags: [], graphs: {}, raw_text: text };
  const lines = text.split('\r\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('Param\tFlags')) { i += 1; break; }
    if (line.includes(':\t')) {
      const index = line.indexOf(':\t');
      const key = line.slice(0, index);
      const value = line.slice(index + 2);
      if (key === 'Age') {
        const parts = value.split('\t');
        rec.header[key] = parts[0].trim();
        if (parts.length > 1) rec.header[`${key}_unit`] = parts[1].trim();
      } else {
        rec.header[key] = value.trim();
      }
    }
    i += 1;
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
    i += 1;
  }

  if (i < lines.length && lines[i].startsWith('Flags:')) {
    const tail = lines[i].slice(6).trim();
    if (tail) rec.flags.push(tail);
    i += 1;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.endsWith(' graph')) {
      const graph = { name: line.slice(0, -6).trim() };
      i += 1;
      while (i < lines.length && !lines[i].endsWith(' graph')) {
        const row = lines[i];
        if (row.includes(':\t')) {
          const index = row.indexOf(':\t');
          const key = row.slice(0, index);
          const value = row.slice(index + 2);
          if (key === 'Points') {
            graph.points = value.split('\t').filter((x) => x.trim() !== '' && /^\d+$/.test(x.trim())).map(Number);
          } else {
            const parsed = Number(value);
            graph[key] = Number.isFinite(parsed) ? parsed : value;
          }
        } else if (row.includes('\t')) {
          const index = row.indexOf('\t');
          const key = row.slice(0, index);
          const raw = row.slice(index + 1);
          const parsed = Number(raw);
          graph[key] = Number.isFinite(parsed) && raw.trim() !== '' ? parsed : raw;
        }
        i += 1;
      }
      rec.graphs[graph.name] = graph;
      continue;
    }
    i += 1;
  }

  return rec;
}
