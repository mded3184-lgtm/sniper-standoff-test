// Ранкова перевірка: чи з'явилась статистика за вчора, сповіщення і таблиця.
//   node src/main.mjs              — звичайний запуск (cron)
//   --force                        — перевірити, навіть якщо за вчора вже сповіщали
//   --discover                     — зберегти всі сирі JSON-відповіді в out/ для налаштування
//   --no-notify                    — нічого не слати в Telegram
//   --precheck                     — лише сказати (GITHUB_OUTPUT skip=…), чи треба перевіряти
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDaily, filterMetrics, shapeOf } from './extract.mjs';
import { renderHtml, renderSummary } from './table.mjs';
import * as tg from './telegram.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const OUT_DIR = path.join(ROOT, 'out');
const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const DISCOVER = args.has('--discover');
const NOTIFY = !args.has('--no-notify') && tg.telegramConfigured();

const readJson = async (file, fallback) => (existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : fallback);
const writeJson = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n');

export function localParts(timeZone, now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export function prevDay(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function loadStorageState() {
  const raw = process.env.CG_STORAGE_STATE?.trim();
  if (raw) return JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  const file = path.join(ROOT, 'auth.json');
  if (existsSync(file)) return file;
  throw new Error('Немає сесії: запустіть `npm run login` і додайте секрет CG_STORAGE_STATE');
}

async function notify(text) {
  console.log(text.replace(/<[^>]+>/g, ''));
  if (NOTIFY) await tg.sendMessage(text);
}

async function main() {
  const config = await readJson(path.join(ROOT, 'config.json'), {});
  const statsUrl = process.env.CG_STATS_URL || config.statsUrl;
  const tz = config.timezone || 'UTC';
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  const stateFile = path.join(DATA_DIR, 'state.json');
  const historyFile = path.join(DATA_DIR, 'metrics.json');
  const state = await readJson(stateFile, {});
  const history = await readJson(historyFile, {});

  const { date: today, hour } = localParts(tz);
  const target = prevDay(today);

  const done = !FORCE && state.lastNotified === target;
  if (args.has('--precheck')) {
    // дешевий крок у CI: не ставимо браузер, якщо за вчора вже все надіслано
    if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `skip=${done}\n`, { flag: 'a' });
    console.log(done ? `За ${target} вже сповіщено.` : `Перевіряю дані за ${target}.`);
    return;
  }
  if (done) {
    console.log(`За ${target} вже сповіщено — пропускаю.`);
    return;
  }

  const { captureResponses } = await import('./scrape.mjs');
  const { responses, finalUrl, loggedOut, screenshot } = await captureResponses({
    statsUrl,
    storageState: loadStorageState(),
  });
  console.log(`Відкрито ${finalUrl}, JSON-відповідей: ${responses.length}`);

  const daily = filterMetrics(extractDaily(responses, { exclude: config.exclude }), config.metrics);
  const found = Object.keys(daily).length;

  if (DISCOVER || !found || loggedOut) {
    await writeJson(path.join(OUT_DIR, 'responses.json'), responses);
    await writeJson(path.join(OUT_DIR, 'extracted.json'), daily);
    // структура без значень — її безпечно надсилати для налаштування парсера
    const shape = responses.map((r) => ({ url: r.url.split('?')[0], shape: shapeOf(r.body) }));
    await writeJson(path.join(OUT_DIR, 'shape.json'), shape);
    if (screenshot) await writeFile(path.join(OUT_DIR, 'page.png'), screenshot);
    console.log(`\nСторінка: ${finalUrl}${loggedOut ? '  ⚠️ схоже на сторінку входу' : ''}`);
    console.log(`JSON-відповідей: ${responses.length}, днів з метриками: ${found}`);
    for (const r of shape) console.log(`  ${r.url}`);
    console.log(`\nСирі дані збережено в ${OUT_DIR}`);
  }

  if (loggedOut || !found) {
    const msg = loggedOut
      ? '⚠️ <b>Сесія CrazyGames закінчилась.</b> Запустіть <code>npm run login</code> і оновіть секрет CG_STORAGE_STATE.'
      : `⚠️ <b>Не вдалось знайти денні метрики</b> на сторінці ${statsUrl}. Перевірте statsUrl у config.json або запустіть <code>npm run discover</code>.`;
    if (state.lastErrorAlert !== today) {
      await notify(msg);
      state.lastErrorAlert = today;
      await writeJson(stateFile, state);
    }
    process.exitCode = 1;
    return;
  }

  // свіжі значення з дашборду мають пріоритет (CrazyGames може доуточнювати минулі дні)
  for (const [day, row] of Object.entries(daily)) history[day] = { ...history[day], ...row };
  const sorted = Object.fromEntries(Object.entries(history).sort(([a], [b]) => a.localeCompare(b)));
  await writeJson(historyFile, sorted);

  const html = renderHtml(sorted, config);
  await writeFile(path.join(DATA_DIR, 'stats.html'), html);
  console.log(`Таблиця: ${path.join(DATA_DIR, 'stats.html')} (днів: ${Object.keys(sorted).length})`);

  const ready = daily[target] && Object.values(daily[target]).some((v) => v !== 0);
  if (ready) {
    await notify(renderSummary(sorted, target, config));
    if (NOTIFY) await tg.sendDocument(`crazygames-stats-${target}.html`, html, 'Таблиця метрик по днях');
    state.lastNotified = target;
  } else if (hour >= (config.giveUpHour ?? 13) && state.lastLateAlert !== today) {
    await notify(`⏳ Статистика CrazyGames за ${target} досі не оновилась (станом на ${hour}:00).`);
    state.lastLateAlert = today;
  } else {
    console.log(`Даних за ${target} ще немає — перевірю пізніше.`);
  }
  await writeJson(stateFile, state);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(async (err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
