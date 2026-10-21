// Витягує денні метрики з довільних JSON-відповідей дашборду.
// Публічного API у CrazyGames немає, тому шукаємо в JSON часові ряди:
//   [{ date: "2026-10-20", plays: 123, ... }, ...]
//   { "2026-10-20": { plays: 123 }, ... }
//   { data: [{ x: 1729382400000, y: 123 }] }  -> метрика бере назву батьківського ключа

const DATE_KEYS = ['date', 'day', 'dt', 'time', 'timestamp', 'period', 'x', 'ds'];
const VALUE_KEYS = new Set(['value', 'count', 'total', 'y', 'amount', 'val']);
const GENERIC_SEGMENTS = new Set(['data', 'items', 'series', 'rows', 'result', 'results', 'values', 'points', 'stats', 'daily']);

export function toDay(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    // секунди або мілісекунди в розумному діапазоні (2015–2100)
    const ms = v < 1e11 ? v * 1000 : v;
    if (ms < 1.42e12 || ms > 4.1e12) return null;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    if (/^\d{10,13}$/.test(v)) return toDay(Number(v));
  }
  return null;
}

function toNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
}

function nameFromPath(path) {
  for (let i = path.length - 1; i >= 0; i--) {
    const seg = path[i];
    if (typeof seg === 'string' && !GENERIC_SEGMENTS.has(seg.toLowerCase())) return seg;
  }
  return 'value';
}

function addRow(out, day, metric, value) {
  (out[day] ??= {})[metric] = value;
}

function fromRecord(out, rec, dateKey, path, exclude) {
  const day = toDay(rec[dateKey]);
  if (!day) return false;
  let found = false;
  for (const [k, raw] of Object.entries(rec)) {
    if (k === dateKey || exclude.has(k)) continue;
    const num = toNumber(raw);
    if (num == null) continue;
    addRow(out, day, VALUE_KEYS.has(k.toLowerCase()) ? nameFromPath(path) : k, num);
    found = true;
  }
  return found;
}

function walk(node, path, out, exclude, depth) {
  if (depth > 12 || node == null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    const first = node.find((x) => x && typeof x === 'object' && !Array.isArray(x));
    const dateKey = first && DATE_KEYS.find((k) => k in first && toDay(first[k]));
    if (dateKey) {
      for (const rec of node) if (rec && typeof rec === 'object') fromRecord(out, rec, dateKey, path, exclude);
      return;
    }
    node.forEach((child, i) => walk(child, [...path, i], out, exclude, depth + 1));
    return;
  }

  // об'єкт, ключі якого — дати
  const keys = Object.keys(node);
  const dateKeys = keys.filter((k) => /^\d{4}-\d{2}-\d{2}/.test(k));
  if (dateKeys.length >= 2 && dateKeys.length >= keys.length / 2) {
    for (const k of dateKeys) {
      const v = node[k];
      const num = toNumber(v);
      if (num != null) addRow(out, toDay(k), nameFromPath(path), num);
      else if (v && typeof v === 'object') fromRecord(out, { ...v, __d: k }, '__d', path, exclude);
    }
    return;
  }

  for (const k of keys) walk(node[k], [...path, k], out, exclude, depth + 1);
}

/**
 * @param {Array<{url: string, body: any}>} responses
 * @returns {Record<string, Record<string, number>>} { "2026-10-20": { plays: 1, ... } }
 */
export function extractDaily(responses, { exclude = [] } = {}) {
  const ex = new Set(exclude);
  const out = {};
  for (const r of responses) walk(r.body, [], out, ex, 0);
  return out;
}

/** Залишає лише потрібні метрики (якщо whitelist у config.metrics не порожній). */
export function filterMetrics(daily, metricsConfig = {}) {
  const wanted = Object.keys(metricsConfig);
  if (!wanted.length) return daily;
  const out = {};
  for (const [day, row] of Object.entries(daily)) {
    for (const m of wanted) if (m in row) (out[day] ??= {})[m] = row[m];
  }
  return out;
}
