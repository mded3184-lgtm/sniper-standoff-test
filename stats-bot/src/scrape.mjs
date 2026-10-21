import { chromium } from 'playwright';

const LOGIN_RE = /login|signin|sign-in|auth/i;

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

    await page.goto(statsUrl, { waitUntil: 'networkidle', timeout: 90_000 });
    // графіки часто довантажуються після першого рендеру
    await page.waitForTimeout(5_000);
    await page.waitForLoadState('networkidle').catch(() => {});

    const finalUrl = page.url();
    const loggedOut = LOGIN_RE.test(new URL(finalUrl).pathname);
    const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
    return { responses, finalUrl, loggedOut, screenshot };
  } finally {
    await browser.close();
  }
}
