import { login } from './activation-page.mjs';

const ttl = 30 * 24 * 60 * 60;
const sessionCookie = 'grade_slips_session';
const protectedPaths = new Set(['/', '/index.html', '/app.js', '/xlsx.js', '/template.xlsx']);
const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const hash = async (value) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const reply = (status, body = null, extra = {}) => new Response(body, { status, headers: { ...headers, ...extra } });

async function attempt(db, request) {
  const now = Date.now();
  const ip = await hash(request.headers.get('CF-Connecting-IP') ?? 'local');
  const until = now + 600_000;
  const row = await db.prepare(`
    INSERT INTO attempts (ip, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(ip) DO UPDATE SET
      count = CASE WHEN expires_at <= ? THEN 1 ELSE min(count + 1, 21) END,
      expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    RETURNING count
  `).bind(ip, until, now, now).first();
  return row.count <= 20;
}

async function activate(request, db) {
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return reply(403);
  if (!(await attempt(db, request))) return reply(303, null, { Location: '/?notice=limited' });
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/x-www-form-urlencoded') return reply(415);
  const reader = request.body?.getReader();
  if (!reader) return reply(400);
  const bytes = new Uint8Array(1024);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.length > bytes.length) {
      await reader.cancel();
      return reply(413);
    }
    bytes.set(value, length);
    length += value.length;
  }
  const raw = new URLSearchParams(new TextDecoder().decode(bytes.subarray(0, length))).get('code') ?? '';
  const code = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!/^[2-9A-HJ-NP-Z]{15}$/.test(code)) return reply(303, null, { Location: '/?notice=invalid' });
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const saved = await db.prepare(`
    INSERT INTO sessions (hash, code_hash, expires_at)
    SELECT ?, hash, ? FROM codes WHERE hash = ? AND disabled_at IS NULL
  `).bind(await hash(token), Date.now() + ttl * 1000, await hash(code)).run();
  if (!saved.meta.changes) return reply(303, null, { Location: '/?notice=invalid' });
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return reply(303, null, {
    Location: '/',
    'Set-Cookie': `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttl}${secure}`
  });
}

async function authorized(request, db) {
  const token = request.headers.get('Cookie')?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(sessionCookie + '='))?.slice(sessionCookie.length + 1);
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) return false;
  return Boolean(await db.prepare(`
    SELECT 1 FROM sessions JOIN codes ON codes.hash = sessions.code_hash
    WHERE sessions.hash = ? AND sessions.expires_at > ? AND codes.disabled_at IS NULL
  `).bind(await hash(token), Date.now()).first());
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/activate' && request.method === 'POST') return await activate(request, env.ACTIVATION);
      if (request.method !== 'GET' || (path !== '/style.css' && !protectedPaths.has(path))) return reply(404);
      if (path !== '/style.css' && !(await authorized(request, env.ACTIVATION))) {
        if (path !== '/') return reply(403);
        return reply(200, login(url.searchParams.get('notice')), { 'Content-Type': 'text/html; charset=utf-8' });
      }
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      return response;
    } catch (error) {
      console.error('Activation request failed', error.name);
      return reply(500, '服务暂时无法使用，请稍后重试。', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
  },
  async scheduled(_event, env) {
    const now = Date.now();
    await env.ACTIVATION.batch([
      env.ACTIVATION.prepare('DELETE FROM attempts WHERE expires_at <= ?').bind(now),
      env.ACTIVATION.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now)
    ]);
  }
};
