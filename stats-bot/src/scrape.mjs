import { chromium } from 'playwright';

const LOGIN_RE = /login|signin|sign-in|auth/i;

// виконується в браузері
function readEmbeddedData() {
  const out = {};
  const next = document.getElementById('__NEXT_DATA__');
  if (next) {
    try {
      out.nextData = JSON.parse(next.textContent);
    } catch {}
  }
  const toIso = (s) => {
    const t = s.trim();
    if (!t || /^[\d\s.,%$€-]+$/.test(t)) return null;
    const ms = Date.parse(/\d{4}/.test(t) ? t : `${t} ${new Date().getFullYear()}`);
    return Number.isNaN(ms) ? null : new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const toNum = (s) => {
    const t = s.replace(/[\s,$€%]/g, '');
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  };
  out.tables = [...document.querySelectorAll('table')].map((table) => {
    const head = [...table.querySelectorAll('thead th, tr:first-child th')].map((th) => th.textContent.trim());
    return [...table.querySelectorAll('tbody tr, tr')]
      .map((tr) => [...tr.querySelectorAll('td, th')].map((c) => c.textContent))
      .filter((cells) => cells.length > 1 && toIso(cells[0]))
      .map((cells) => {
        const row = { date: toIso(cells[0]) };
        cells.slice(1).forEach((c, i) => {
          const n = toNum(c);
          if (n != null) row[head[i + 1] || `col${i + 1}`] = n;
        });
        return row;
      });
  }).filter((rows) => rows.length);
  return out.nextData || out.tables.length ? out : null;
}

/**
 * Відкриває сторінку статистики з збереженою сесією й збирає всі JSON-відповіді,
 * які завантажує дашборд.
 */
export async function captureResponses({ statsUrl, storageState, headless = true }) {
  const browser = await chromium.launch({
    headless,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  try {
    const context = await browser.newContext({ storageState, locale: 'en-US', timezoneId: 'UTC' });
    const page = await context.newPage();
    const responses = [];

    page.on('response', async (res) => {
      const type = res.headers()['content-type'] ?? '';
      if (!type.includes('json') || res.status() >= 400) return;
      try {
        responses.push({ url: res.url(), status: res.status(), body: await res.json() });
      } catch {
        /* тіло вже недоступне — пропускаємо */
      }
    });

    await page.goto(statsUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    // графіки довантажуються після першого рендеру; дашборд може ніколи не «затихнути»,
    // тому чекаємо тиші в мережі не довше 30 с і ще трохи на рендер
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(8_000);

    // дані, вбудовані прямо в HTML (Next.js) і звичайні HTML-таблиці з датами
    for (const frame of page.frames()) {
      const embedded = await frame.evaluate(readEmbeddedData).catch(() => null);
      if (embedded) responses.push({ url: `${frame.url()}#dom`, status: 200, body: embedded });
    }

    const finalUrl = page.url();
    const loggedOut = LOGIN_RE.test(new URL(finalUrl).pathname);
    const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
    return { responses, finalUrl, loggedOut, screenshot };
  } finally {
    await browser.close();
  }
}
