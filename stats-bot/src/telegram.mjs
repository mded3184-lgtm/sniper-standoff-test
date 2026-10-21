const token = () => process.env.TELEGRAM_BOT_TOKEN;
const chatId = () => process.env.TELEGRAM_CHAT_ID;

export const telegramConfigured = () => !!(token() && chatId());

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Telegram ${method}: ${res.status} ${json.description ?? ''}`);
  return json;
}

export async function sendMessage(html) {
  const form = new FormData();
  form.set('chat_id', chatId());
  form.set('text', html);
  form.set('parse_mode', 'HTML');
  form.set('disable_web_page_preview', 'true');
  return call('sendMessage', form);
}

export async function sendDocument(filename, content, caption = '') {
  const form = new FormData();
  form.set('chat_id', chatId());
  form.set('document', new Blob([content], { type: 'text/html' }), filename);
  if (caption) form.set('caption', caption);
  return call('sendDocument', form);
}
