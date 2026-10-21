// Одноразовий вхід: відкриває браузер, ви логінитесь у кабінет CrazyGames
// (у тому числі через Google), а скрипт зберігає сесію в auth.json
// і друкує base64-рядок для секрету CG_STORAGE_STATE.
import { chromium } from 'playwright';
import { writeFile, readFile } from 'node:fs/promises';
import readline from 'node:readline/promises';

const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
const url = process.env.CG_STATS_URL || config.statsUrl;

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(url);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question('Увійдіть у кабінет розробника, відкрийте сторінку статистики гри й натисніть Enter… ');
rl.close();

console.log(`\nURL сторінки статистики: ${page.url()}`);
console.log('Поставте його в config.json → statsUrl (або змінну CG_STATS_URL).\n');

const state = await context.storageState();
await writeFile(new URL('../auth.json', import.meta.url), JSON.stringify(state));
await browser.close();

console.log('Сесію збережено в stats-bot/auth.json (файл у .gitignore, не комітьте його).');
console.log('Значення для секрету CG_STORAGE_STATE:\n');
console.log(Buffer.from(JSON.stringify(state)).toString('base64'));
