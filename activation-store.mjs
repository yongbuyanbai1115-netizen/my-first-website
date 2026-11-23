import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const storage = process.env.GRADE_SLIPS_ACTIVATION_DB ||
  fileURLToPath(new URL('./private/activation.sqlite', import.meta.url));
mkdirSync(dirname(storage), { recursive: true });
const db = new DatabaseSync(storage);
db.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS codes (
    hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    disabled_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    hash TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL REFERENCES codes(hash),
    expires_at INTEGER NOT NULL
  );
`);

const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const normalize = (code) => code.trim().toUpperCase().replace(/[\s-]/g, '');
const codeHash = (code) => {
  const value = normalize(code);
  return /^[2-9A-HJ-NP-Z]{15}$/.test(value) ? hash(value) : null;
};
export const sessionSeconds = 30 * 24 * 60 * 60;

export function createCodes(count) {
  const insert = db.prepare('INSERT OR IGNORE INTO codes (hash, created_at) VALUES (?, ?)');
  const result = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    while (result.length < count) {
      const code = Array.from(randomBytes(15), (byte) => alphabet[byte & 31]).join('');
      if (insert.run(hash(code), Date.now()).changes) result.push(code.match(/.{5}/g).join('-'));
    }
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function disableCode(code) {
  return Boolean(db.prepare('UPDATE codes SET disabled_at = ? WHERE hash = ? AND disabled_at IS NULL')
    .run(Date.now(), codeHash(code)).changes);
}

export function activate(code) {
  const key = codeHash(code);
  if (!key) return null;
  const now = Date.now();
  const token = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  const saved = db.prepare(`
    INSERT INTO sessions (hash, code_hash, expires_at)
    SELECT ?, hash, ? FROM codes WHERE hash = ? AND disabled_at IS NULL
  `).run(hash(token), now + sessionSeconds * 1000, key);
  return saved.changes ? token : null;
}

export function isActive(token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token ?? '')) return false;
  return Boolean(db.prepare(`
    SELECT 1 FROM sessions JOIN codes ON codes.hash = sessions.code_hash
    WHERE sessions.hash = ? AND sessions.expires_at > ? AND codes.disabled_at IS NULL
  `).get(hash(token), Date.now()));
}
