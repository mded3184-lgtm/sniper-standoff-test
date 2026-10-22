// Перевірка Telegram: npm run tg-test (потрібні TELEGRAM_BOT_TOKEN і TELEGRAM_CHAT_ID)
import { sendMessage, telegramConfigured } from './telegram.mjs';

if (!telegramConfigured()) {
  console.error('Задайте $env:TELEGRAM_BOT_TOKEN і $env:TELEGRAM_CHAT_ID');
  process.exit(1);
}
await sendMessage('✅ Бот статистики CrazyGames підключено');
console.log('Надіслано — перевірте Telegram.');
