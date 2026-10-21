// Демо-таблиця на випадкових даних: node src/demo.mjs -> out/demo.html
import { mkdir, writeFile } from 'node:fs/promises';
import { renderHtml, renderSummary } from './table.mjs';

const config = {
  neutralThresholdPct: 1,
  tableDays: 14,
  lowerIsBetter: [],
  metrics: {
    gameplays: { label: 'Ігрові сесії' },
    newUsers: { label: 'Нові гравці' },
    avgPlaytime: { label: 'Сер. час гри, хв' },
    retentionD1: { label: 'Retention D1, %' },
    revenue: { label: 'Дохід, $' },
  },
};
const history = {};
const d = new Date('2026-10-07T00:00:00Z');
let base = 1000;
for (let i = 0; i < 14; i++, d.setUTCDate(d.getUTCDate() + 1)) {
  base *= 0.9 + Math.random() * 0.25;
  history[d.toISOString().slice(0, 10)] = {
    gameplays: Math.round(base * 3),
    newUsers: Math.round(base),
    avgPlaytime: +(8 + Math.random() * 4).toFixed(1),
    retentionD1: +(15 + Math.random() * 5).toFixed(1),
    revenue: +(base * 0.012).toFixed(2),
  };
}
await mkdir(new URL('../out/', import.meta.url), { recursive: true });
await writeFile(new URL('../out/demo.html', import.meta.url), renderHtml(history, config));
console.log(renderSummary(history, Object.keys(history).at(-1), config));
