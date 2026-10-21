// Одноразовий вхід: відкриває ваш звичайний Chrome/Edge (не керований Playwright,
// бо Google блокує вхід у такий браузер), ви логінитесь у кабінет CrazyGames,
// а скрипт підключається до браузера, зберігає сесію в auth.json
// і друкує base64-рядок для секрету CG_STORAGE_STATE.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));
const url = process.env.CG_STATS_URL || config.statsUrl;

function findBrowser() {
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    process.env.BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return candidates.find((p) => p && existsSync(p));
}

// Порт налагодження читаємо з DevToolsActivePort у профілі бота — так підключаємось
// саме до нашого вікна, а не до іншого Chrome, який теж може слухати якийсь порт.
const profile = path.join(os.homedir(), '.crazygames-stats-bot-profile');
const portFile = path.join(profile, 'DevToolsActivePort');

async function cdpPort() {
  try {
    const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (res.ok) return port;
  } catch {}
  return null;
}

async function waitForCdp() {
  for (let i = 0; i < 75; i++) {
    const port = await cdpPort();
    if (port) return port;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Не вдалось підключитись до вікна браузера бота — закрийте всі його вікна й спробуйте ще раз');
}

const exe = findBrowser();
if (!exe) {
  console.error('Не знайдено Chrome або Edge. Вкажіть шлях: $env:BROWSER_PATH="C:\\...\\chrome.exe"; npm run login');
  process.exit(1);
}

// окремий профіль: не чіпає ваш основний браузер і запам'ятовує вхід для наступних разів
if (!(await cdpPort())) rmSync(portFile, { force: true }); // залишок від минулого запуску
const child = spawn(exe, ['--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', url], {
  stdio: 'ignore',
  detached: true,
});
child.unref();
console.log(`Відкрито ${path.basename(exe)}.`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question('Увійдіть у кабінет розробника CrazyGames, відкрийте сторінку статистики гри й натисніть тут Enter… ');

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${await waitForCdp()}`, { timeout: 90_000 });
const context = browser.contexts()[0];
// вкладки кабінету, крім сторінки входу; найглибша адреса — найімовірніше статистика гри
const tabs = context
  .pages()
  .map((p) => p.url())
  .filter((u) => u.includes('crazygames') && !/\/login|signin/i.test(u));
tabs.sort((a, b) => b.length - a.length);

let statsUrl = tabs[0] ?? '';
if (tabs.length > 1) {
  console.log('\nВідкриті вкладки CrazyGames:');
  tabs.forEach((u, i) => console.log(`  ${i + 1}) ${u}`));
  const answer = (await rl.question('Номер вкладки зі статистикою гри (Enter = 1) або вставте URL: ')).trim();
  if (/^https?:\/\//.test(answer)) statsUrl = answer;
  else if (tabs[Number(answer) - 1]) statsUrl = tabs[Number(answer) - 1];
}
rl.close();

console.log(`\nURL сторінки статистики: ${statsUrl || '(не знайдено — скопіюйте з адресного рядка браузера)'}`);
console.log('Його потрібно вписати в змінну CG_STATS_URL (або в config.json → statsUrl).\n');

// indexedDB: Firebase-подібні входи тримають токен там, а не в cookies
const state = await context.storageState({ indexedDB: true });
await writeFile(path.join(ROOT, 'auth.json'), JSON.stringify(state));
const cgCookies = state.cookies.filter((c) => c.domain.includes('crazygames')).length;
const cgOrigins = state.origins.filter((o) => o.origin.includes('crazygames'));
console.log(`CrazyGames: cookies ${cgCookies}, localStorage ${cgOrigins.reduce((n, o) => n + o.localStorage.length, 0)}, IndexedDB ${cgOrigins.reduce((n, o) => n + (o.indexedDB?.length ?? 0), 0)}`);
await browser.close().catch(() => {});

if (!cgCookies && !cgOrigins.length) {
  console.log('⚠️  Не знайдено даних входу CrazyGames — схоже, вхід не завершено. Спробуйте ще раз.');
  process.exit(1);
}
console.log('Сесію збережено в stats-bot/auth.json. Не комітьте цей файл.');
console.log('Щоб скопіювати значення секрету CG_STORAGE_STATE у буфер обміну (PowerShell):');
console.log('  [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path auth.json))) | Set-Clipboard');
