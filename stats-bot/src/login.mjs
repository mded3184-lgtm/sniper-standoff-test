// Одноразовий вхід: відкриває ваш звичайний Chrome/Edge (не керований Playwright,
// бо Google блокує вхід у такий браузер), ви логінитесь у кабінет CrazyGames,
// а скрипт підключається до браузера, зберігає сесію в auth.json
// і друкує base64-рядок для секрету CG_STORAGE_STATE.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));
const url = process.env.CG_STATS_URL || config.statsUrl;
const PORT = 9333;

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

async function waitForCdp() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Браузер не відкрив порт налагодження — закрийте всі його вікна й спробуйте ще раз');
}

const exe = findBrowser();
if (!exe) {
  console.error('Не знайдено Chrome або Edge. Вкажіть шлях: $env:BROWSER_PATH="C:\\...\\chrome.exe"; npm run login');
  process.exit(1);
}

// окремий профіль: не чіпає ваш основний браузер і запам'ятовує вхід для наступних разів
const profile = path.join(os.homedir(), '.crazygames-stats-bot-profile');
const child = spawn(exe, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', url], {
  stdio: 'ignore',
  detached: true,
});
child.unref();
console.log(`Відкрито ${path.basename(exe)}.`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question('Увійдіть у кабінет розробника CrazyGames, відкрийте сторінку статистики гри й натисніть тут Enter… ');
rl.close();

await waitForCdp();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const context = browser.contexts()[0];
const pages = context.pages();
const statsPage = pages.find((p) => p.url().includes('crazygames')) ?? pages[0];

console.log(`\nURL сторінки статистики: ${statsPage?.url()}`);
console.log('Його потрібно вписати в змінну CG_STATS_URL (або в config.json → statsUrl).\n');

const state = await context.storageState();
await writeFile(path.join(ROOT, 'auth.json'), JSON.stringify(state));
const cgCookies = state.cookies.filter((c) => c.domain.includes('crazygames')).length;
await browser.close().catch(() => {});

if (!cgCookies) {
  console.log('⚠️  Не знайдено cookies CrazyGames — схоже, вхід не завершено. Спробуйте ще раз.');
  process.exit(1);
}
console.log(`Сесію збережено в stats-bot/auth.json (cookies CrazyGames: ${cgCookies}). Не комітьте цей файл.`);
console.log('Щоб скопіювати значення секрету CG_STORAGE_STATE у буфер обміну (PowerShell):');
console.log('  [Convert]::ToBase64String([IO.File]::ReadAllBytes("auth.json")) | Set-Clipboard');
