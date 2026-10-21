// Таблиця метрик по днях: зелене — стало краще за попередній день, червоне — гірше.

export function metricLabel(name, config) {
  return config.metrics?.[name]?.label ?? name;
}

export function lowerIsBetter(name, config) {
  const m = config.metrics?.[name];
  if (m && 'lowerIsBetter' in m) return !!m.lowerIsBetter;
  return (config.lowerIsBetter ?? []).includes(name);
}

/** 'good' | 'bad' | 'flat' | null (немає з чим порівняти) */
export function trend(cur, prev, name, config) {
  if (cur == null || prev == null) return null;
  const pct = prev === 0 ? (cur === 0 ? 0 : 100) : ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < (config.neutralThresholdPct ?? 1)) return { kind: 'flat', pct };
  const up = pct > 0;
  return { kind: up !== lowerIsBetter(name, config) ? 'good' : 'bad', pct };
}

export function fmt(v) {
  if (v == null) return '—';
  if (Number.isInteger(v)) return v.toLocaleString('uk-UA');
  return v.toLocaleString('uk-UA', { maximumFractionDigits: 2 });
}

const fmtPct = (p) => `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;

export function metricNames(history, config) {
  const fromConfig = Object.keys(config.metrics ?? {});
  if (fromConfig.length) return fromConfig;
  const set = new Set();
  for (const row of Object.values(history)) Object.keys(row).forEach((k) => set.add(k));
  return [...set].sort();
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function renderHtml(history, config, { generatedAt = new Date() } = {}) {
  const days = Object.keys(history).sort().reverse().slice(0, config.tableDays ?? 30);
  const metrics = metricNames(history, config);
  const allDays = Object.keys(history).sort();
  const prevOf = (d) => allDays[allDays.indexOf(d) - 1];

  const head = metrics.map((m) => `<th>${esc(metricLabel(m, config))}</th>`).join('');
  const rows = days
    .map((d) => {
      const prev = history[prevOf(d)] ?? {};
      const cells = metrics
        .map((m) => {
          const cur = history[d][m];
          const t = trend(cur, prev[m], m, config);
          const cls = t ? t.kind : '';
          const delta = t ? `<small>${fmtPct(t.pct)}</small>` : '';
          return `<td class="${cls}">${fmt(cur)}${delta}</td>`;
        })
        .join('');
      return `<tr><th scope="row">${d}</th>${cells}</tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Метрики CrazyGames</title>
<style>
:root{--bg:#fff;--fg:#1d2330;--muted:#6b7280;--line:#e5e7eb;--good:#e6f6ec;--good-fg:#11793b;--bad:#fde8e8;--bad-fg:#b42318;--head:#f6f7f9}
@media (prefers-color-scheme:dark){:root{--bg:#14161b;--fg:#e8eaee;--muted:#9aa3b2;--line:#2a2e37;--good:#123524;--good-fg:#6ee7a0;--bad:#3d1717;--bad-fg:#ff8a80;--head:#1b1e25}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
h1{font-size:20px;margin:0 0 4px}p{color:var(--muted);margin:0 0 16px}
.wrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
thead th{background:var(--head);position:sticky;top:0}
th[scope=row]{text-align:left;background:var(--head)}
td small{display:block;font-size:11px;opacity:.85}
td.good{background:var(--good);color:var(--good-fg)}
td.bad{background:var(--bad);color:var(--bad-fg)}
td.flat small{color:var(--muted)}
.legend span{display:inline-block;padding:2px 8px;border-radius:4px;margin-right:6px}
</style>
</head>
<body>
<h1>Метрики CrazyGames по днях</h1>
<p class="legend">Порівняння з попереднім днем:
<span style="background:var(--good);color:var(--good-fg)">краще</span>
<span style="background:var(--bad);color:var(--bad-fg)">гірше</span>
зміни менше ${config.neutralThresholdPct ?? 1}% не підсвічуються. Оновлено ${esc(generatedAt.toISOString().slice(0, 16).replace('T', ' '))} UTC.</p>
<div class="wrap"><table>
<thead><tr><th>Дата</th>${head}</tr></thead>
<tbody>
${rows}
</tbody>
</table></div>
</body>
</html>
`;
}

/** Текст повідомлення в Telegram (parse_mode=HTML). */
export function renderSummary(history, day, config) {
  const allDays = Object.keys(history).sort();
  const prev = history[allDays[allDays.indexOf(day) - 1]] ?? {};
  const row = history[day] ?? {};
  const lines = metricNames(history, config)
    .filter((m) => m in row)
    .map((m) => {
      const t = trend(row[m], prev[m], m, config);
      const icon = !t ? '⚪' : t.kind === 'good' ? '🟢' : t.kind === 'bad' ? '🔴' : '⚪';
      const delta = t ? ` (${fmtPct(t.pct)})` : '';
      return `${icon} ${esc(metricLabel(m, config))}: <b>${fmt(row[m])}</b>${delta}`;
    });
  return [`📊 <b>Статистика CrazyGames оновилась</b> — ${day}`, '', ...lines].join('\n');
}
