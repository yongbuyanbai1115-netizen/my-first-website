import { login } from './activation-page.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { activate, isActive, sessionSeconds } from './activation-store.mjs';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/xlsx.js', ['xlsx.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/template.xlsx', ['template.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]
]);
const cookie = 'grade_slips_session';
const attempts = new Map();
const windowMs = 10 * 60 * 1000;
const timer = setInterval(() => {
  for (const [ip, entry] of attempts) if (entry.until <= Date.now()) attempts.delete(ip);
}, windowMs);
timer.unref();

function allowed(ip) {
  const now = Date.now();
  const previous = attempts.get(ip);
  const entry = previous?.until > now ? previous : { count: 0, until: now + windowMs };
  attempts.set(ip, entry);
  return ++entry.count <= 20;
}



function redirect(response, location, token) {
  response.setHeader('Location', location);
  if (token) response.setHeader('Set-Cookie', `${cookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionSeconds}`);
  response.writeHead(303).end();
}

async function readCode(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return '';
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1024) return '';
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('code') ?? '';
}

export async function handleRequest(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const url = new URL(request.url, 'http://localhost');
    const path = url.pathname;
    if (path === '/activate' && request.method === 'POST') {
      if (request.headers['sec-fetch-site'] === 'cross-site') return response.writeHead(403).end();
      if (!allowed(request.socket.remoteAddress)) return redirect(response, '/?notice=limited');
      const token = activate(await readCode(request));
      return token ? redirect(response, '/', token) : redirect(response, '/?notice=invalid');
    }
    const asset = files.get(path);
    if (!asset || request.method !== 'GET') return response.writeHead(404).end();
    const token = request.headers.cookie?.split(';').map((part) => part.trim())
      .find((part) => part.startsWith(cookie + '='))?.slice(cookie.length + 1);
    if (path !== '/style.css' && !isActive(token)) {
      if (path !== '/') return response.writeHead(403).end();
      return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(login(url.searchParams.get('notice')));
    }
    const [name, type] = asset;
    const data = await readFile(new URL('./dist/' + name, import.meta.url));
    response.writeHead(200, { 'Content-Type': type }).end(data);
  } catch (error) {
    console.error(error.message);
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const openBrowser = process.argv.includes('--open') && process.platform === 'win32';
  const server = createServer(handleRequest);
  let port = Number(process.env.GRADE_SLIPS_PORT ?? 8765);
  server.on('error', (error) => {
    if (openBrowser && error.code === 'EADDRINUSE' && port !== 0) {
      console.log('默认端口已占用，正在换一个本地端口。');
      port = 0;
      server.listen(port, '127.0.0.1');
      return;
    }
    console.error(`启动失败：${error.message}`);
    process.exitCode = 1;
  });
  server.once('listening', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.log(`成绩条工作台已启动：${url}`);
    console.log('请保持此窗口开启。');
    if (openBrowser) {
      const browser = spawn('explorer.exe', [url], { stdio: 'ignore' });
      browser.on('error', () => console.log(`请在浏览器手动打开：${url}`));
      browser.unref();
    }
  });
  server.listen(port, '127.0.0.1');
}

