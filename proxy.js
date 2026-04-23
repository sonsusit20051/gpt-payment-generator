const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

loadEnvFile(path.resolve(__dirname, '.env'));

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const BASE_URL = 'https://chatgpt.com/backend-api';
const WEB_ROOT = __dirname;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const BOT_USERNAME_FROM_ENV = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
const LOGIN_CODE_TTL_MS = 5 * 60 * 1000;
const AUTH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESEND_GAP_MS = 30 * 1000;

const knownTelegramUsersById = new Map();
const knownTelegramUsersByUsername = new Map();
const pendingLoginCodes = new Map();
const authSessions = new Map();
let telegramPollOffset = 0;
let botProfile = {
  botUsername: BOT_USERNAME_FROM_ENV
};
const botRuntime = {
  configured: Boolean(BOT_TOKEN),
  connected: false,
  polling: false,
  lastStartedAt: null,
  lastError: '',
  lastConflictAt: null
};

app.use(cors());
app.use(express.json());
app.use('/css', express.static(path.join(WEB_ROOT, 'css')));
app.use('/js', express.static(path.join(WEB_ROOT, 'js')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(WEB_ROOT, 'index.html'));
});

app.get('/auth/telegram/meta', (_req, res) => {
  res.json({
    configured: Boolean(BOT_TOKEN),
    botUsername: botProfile.botUsername || '',
    botLink: buildBotLink()
  });
});

app.get('/auth/telegram/status', (_req, res) => {
  res.json({
    configured: botRuntime.configured,
    connected: botRuntime.connected,
    polling: botRuntime.polling,
    botUsername: botProfile.botUsername || '',
    botLink: buildBotLink(),
    lastStartedAt: botRuntime.lastStartedAt,
    lastConflictAt: botRuntime.lastConflictAt,
    lastError: botRuntime.lastError
  });
});

app.get('/auth/telegram/session', (req, res) => {
  const session = validateAuthToken(req.headers['x-community-auth']);
  if (!session) {
    res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
    return;
  }

  res.json({
    authenticated: true,
    session: sanitizeSession(session)
  });
});

app.post('/auth/telegram/request-code', async (req, res) => {
  if (!BOT_TOKEN) {
    res.status(503).json({ error: 'Bot Telegram chưa được cấu hình trên server.' });
    return;
  }

  const identifier = String(req.body?.identifier || '').trim();
  console.log(`🔐 Login code requested for: ${identifier || '(empty)'}`);
  if (!identifier) {
    res.status(400).json({ error: 'Thiếu Telegram ID hoặc username.' });
    return;
  }

  const telegramUser = findTelegramUser(identifier);
  if (!telegramUser) {
    console.warn(`⚠️ Telegram user not found for identifier: ${identifier}`);
    res.status(404).json({
      error: 'Bot chưa thấy tài khoản này. Hãy mở bot, nhắn /start hoặc /get trước rồi thử lại.'
    });
    return;
  }

  const currentRecord = pendingLoginCodes.get(telegramUser.telegramId);
  if (currentRecord && Date.now() - currentRecord.lastSentAt < RESEND_GAP_MS) {
    res.status(429).json({ error: 'Bạn vừa xin mã. Vui lòng chờ khoảng 30 giây rồi thử lại.' });
    return;
  }

  const code = generateLoginCode();
  pendingLoginCodes.set(telegramUser.telegramId, {
    code,
    expiresAt: Date.now() + LOGIN_CODE_TTL_MS,
    lastSentAt: Date.now()
  });

  try {
    await sendTelegramMessage(
      telegramUser.chatId,
      [
        'Mã đăng nhập của bạn là',
        `<b>${escapeTelegramHtml(code)}</b>`
      ].join('\n'),
      {
        parse_mode: 'HTML'
      }
    );
    console.log(`✅ Login code sent to ${formatTelegramHandle(telegramUser)} (${telegramUser.chatId})`);

    res.json({
      ok: true,
      message: `Bot đã gửi mã đăng nhập tới ${formatTelegramHandle(telegramUser)}.`
    });
  } catch (error) {
    console.error(`❌ Failed to send login code to ${formatTelegramHandle(telegramUser)}: ${error.message}`);
    res.status(502).json({ error: `Không thể gửi mã qua bot: ${error.message}` });
  }
});

app.post('/auth/telegram/verify-code', async (req, res) => {
  const identifier = String(req.body?.identifier || '').trim();
  const code = String(req.body?.code || '').trim();

  if (!identifier || !code) {
    res.status(400).json({ error: 'Thiếu thông tin xác thực.' });
    return;
  }

  const telegramUser = findTelegramUser(identifier);
  if (!telegramUser) {
    res.status(404).json({ error: 'Không tìm thấy tài khoản Telegram đã từng chat với bot.' });
    return;
  }

  const record = pendingLoginCodes.get(telegramUser.telegramId);
  if (!record) {
    res.status(400).json({ error: 'Chưa có mã đăng nhập nào được tạo cho tài khoản này.' });
    return;
  }

  if (Date.now() > record.expiresAt) {
    pendingLoginCodes.delete(telegramUser.telegramId);
    res.status(400).json({ error: 'Mã đăng nhập đã hết hạn. Vui lòng xin mã mới.' });
    return;
  }

  if (record.code !== code) {
    res.status(400).json({ error: 'Mã đăng nhập không đúng.' });
    return;
  }

  pendingLoginCodes.delete(telegramUser.telegramId);

  const authToken = crypto.randomBytes(24).toString('hex');
  const session = {
    authToken,
    telegramId: telegramUser.telegramId,
    chatId: telegramUser.chatId,
    username: telegramUser.username || '',
    displayName: telegramUser.displayName || telegramUser.username || `ID ${telegramUser.telegramId}`,
    verifiedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + AUTH_SESSION_TTL_MS).toISOString()
  };

  authSessions.set(authToken, session);

  try {
    await sendTelegramMessage(
      telegramUser.chatId,
      'Đăng nhập thành công, sếp cần gì thì hú @sonmoi2409 nhé'
    );
  } catch (error) {
    console.warn('Telegram success notice failed:', error.message);
  }

  res.json({
    ok: true,
    authToken,
    session: sanitizeSession(session)
  });
});

app.post('/auth/telegram/logout', (req, res) => {
  const token = String(req.headers['x-community-auth'] || '').trim();
  if (token) {
    authSessions.delete(token);
  }

  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  const session = validateAuthToken(req.headers['x-community-auth']);
  if (!session) {
    res.status(401).json({ error: 'Bạn cần đăng nhập Telegram trước khi dùng Team Manager.' });
    return;
  }

  req.authSession = session;
  next();
});

app.use('/api', async (req, res) => {
  const targetUrl = BASE_URL + req.originalUrl.replace(/^\/api/, '');

  console.log(`\n📤 [${req.method}] ${targetUrl}`);

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        Authorization: req.headers.authorization,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        Origin: 'https://chatgpt.com',
        Referer: 'https://chatgpt.com/',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Dest': 'empty',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache'
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
    });

    const data = await response.text();

    console.log(`📥 Status: ${response.status}`);
    if (response.status >= 400) {
      console.log(`❌ LỖI ${response.status}:`, data.substring(0, 500) + '...');
    }

    res.status(response.status).send(data);
  } catch (error) {
    console.error('🚨 Proxy Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Proxy ChatGPT đang chạy tại http://localhost:${PORT}`);
  console.log(`🌐 Web UI: http://localhost:${PORT}`);
  console.log(`🩺 Telegram status: http://localhost:${PORT}/auth/telegram/status`);
  if (BOT_TOKEN) {
    startTelegramBot().catch((error) => {
      botRuntime.connected = false;
      botRuntime.polling = false;
      botRuntime.lastError = error.message;
      console.error('Telegram bot failed to start:', error.message);
    });
  } else {
    console.warn('⚠️ Chưa có TELEGRAM_BOT_TOKEN, login Telegram hiện đang tắt.');
  }
});

function buildBotLink() {
  return botProfile.botUsername ? `https://t.me/${botProfile.botUsername}` : '';
}

function normalizeIdentifier(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function findTelegramUser(identifier) {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) return null;

  if (/^\d+$/.test(normalized)) {
    return knownTelegramUsersById.get(normalized) || null;
  }

  return knownTelegramUsersByUsername.get(normalized) || null;
}

function upsertTelegramUser(message) {
  const chatId = String(message.chat?.id || '');
  const telegramId = String(message.from?.id || '');
  if (!chatId || !telegramId) return null;

  const username = normalizeIdentifier(message.from?.username || '');
  const firstName = String(message.from?.first_name || '').trim();
  const lastName = String(message.from?.last_name || '').trim();
  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() || username || `ID ${telegramId}`;

  const user = {
    chatId,
    telegramId,
    username,
    displayName,
    lastSeenAt: new Date().toISOString()
  };

  knownTelegramUsersById.set(telegramId, user);
  knownTelegramUsersById.set(chatId, user);
  if (username) {
    knownTelegramUsersByUsername.set(username, user);
  }

  return user;
}

function generateLoginCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sanitizeSession(session) {
  return {
    telegramId: session.telegramId,
    username: session.username,
    displayName: session.displayName,
    verifiedAt: session.verifiedAt,
    expiresAt: session.expiresAt
  };
}

function validateAuthToken(tokenValue) {
  const token = String(tokenValue || '').trim();
  if (!token) return null;

  const session = authSessions.get(token);
  if (!session) return null;

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    authSessions.delete(token);
    return null;
  }

  return session;
}

function formatTelegramHandle(user) {
  if (user.username) {
    return `@${user.username}`;
  }
  return `ID ${user.telegramId}`;
}

function escapeTelegramHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTelegramGreeting(user) {
  if (user.username) {
    return `@${user.username}`;
  }

  return user.displayName || `ID ${user.telegramId}`;
}

async function startTelegramBot() {
  console.log('🤖 Telegram bot đang khởi động...');
  await clearTelegramWebhook();
  await hydrateBotProfile();

  botRuntime.connected = true;
  botRuntime.polling = true;
  botRuntime.lastStartedAt = new Date().toISOString();
  botRuntime.lastError = '';

  console.log(`✅ Telegram bot đã kết nối${botProfile.botUsername ? `: @${botProfile.botUsername}` : ''}`);
  console.log('📡 Telegram long polling đã bật.');

  startTelegramPolling().catch((error) => {
    botRuntime.polling = false;
    botRuntime.lastError = error.message;
    console.error('Telegram polling stopped:', error.message);
  });
}

async function hydrateBotProfile() {
  if (!BOT_TOKEN) return;

  const data = await callTelegramApi('getMe');
  if (data?.username) {
    botProfile.botUsername = String(data.username).replace(/^@/, '');
  }
}

async function clearTelegramWebhook() {
  if (!BOT_TOKEN) return;

  const result = await callTelegramApi('deleteWebhook', {
    drop_pending_updates: false
  });

  console.log(`🧹 Telegram webhook cleared: ${result ? 'ok' : 'no-op'}`);
}

async function sendTelegramMessage(chatId, text, extraPayload = {}) {
  await callTelegramApi('sendMessage', {
    chat_id: chatId,
    text,
    ...extraPayload
  });
}

async function callTelegramApi(method, payload = undefined) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: payload ? 'POST' : 'GET',
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram API ${method} failed`);
  }

  return data.result;
}

async function startTelegramPolling() {
  while (true) {
    try {
      const updates = await callTelegramApi('getUpdates', {
        offset: telegramPollOffset,
        timeout: 25,
        allowed_updates: ['message']
      });

      botRuntime.connected = true;
      botRuntime.polling = true;
      botRuntime.lastError = '';

      for (const update of updates) {
        telegramPollOffset = update.update_id + 1;
        await handleTelegramUpdate(update);
      }
    } catch (error) {
      botRuntime.connected = false;
      botRuntime.polling = false;
      botRuntime.lastError = error.message;

      if (String(error.message || '').includes('Conflict: terminated by other getUpdates request')) {
        botRuntime.lastConflictAt = new Date().toISOString();
        console.error('Telegram polling conflict: bot token đang bị dùng ở một nơi khác.');
        console.error('Hãy tắt instance bot khác hoặc revoke token ở @BotFather rồi cập nhật .env.');
      } else {
        console.error('Telegram polling error:', error.message);
      }

      await sleep(3000);
      botRuntime.polling = true;
    }
  }
}

async function handleTelegramUpdate(update) {
  const message = update?.message;
  if (!message?.chat) return;

  const user = upsertTelegramUser(message);
  if (!user) return;

  const text = String(message.text || '').trim();
  if (!text) return;

  if (text === '/get') {
    const messageLines = [
      'Telegram ID của bạn:',
      `<code>${escapeTelegramHtml(user.telegramId)}</code>`,
      'Username:',
      user.username ? `<code>@${escapeTelegramHtml(user.username)}</code>` : '<code>Chưa đặt username</code>'
    ];

    await sendTelegramMessage(
      user.chatId,
      messageLines.join('\n'),
      {
        parse_mode: 'HTML'
      }
    );
    return;
  }

  if (text === '/start' || text === '/login') {
    await sendTelegramMessage(
      user.chatId,
      [
        `Chào mừng ${escapeTelegramHtml(formatTelegramGreeting(user))} đến với M MOI COMMUNITY`,
        'Hãy nhấn /get để lấy Telegram ID',
        'Sau đó quay lại trang web để đăng nhập'
      ].join('\n'),
      {
        parse_mode: 'HTML'
      }
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
