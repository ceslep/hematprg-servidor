/** Formateo y escape para el panel. */
'use strict';

/** Fecha `YYYYMMDD` + hora `HHMMSS` → `DD/MM/YYYY HH:MM`. */
export function fmtFecha(ymd, hm) {
  if (!ymd) return '—';
  const value = String(ymd);
  let out = value;
  if (/^\d{8}$/.test(value)) out = `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
  if (hm && /^\d{6}$/.test(String(hm))) {
    const time = String(hm);
    out += ` ${time.slice(0, 2)}:${time.slice(2, 4)}`;
  }
  return out;
}

/** ISO → fecha/hora local legible. */
export function fmtRecibido(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' });
}

/** Escapa texto para insertarlo como HTML. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}
