// Restore a private SQLite backup into isolated D1 and exercise the built website.
// Does not use cloud credentials; all outbound requests are blocked.
import { Miniflare } from 'miniflare';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const [sourcePath, reportPath] = process.argv.slice(2);
if (!sourcePath || !reportPath) throw Error('Usage: verify-migration-restore.mjs <private SQLite backup> <report.json>');
const source = new DatabaseSync(sourcePath, { readOnly: true });
// Standard D1 has a 2,000,000-byte row/string limit. Fail without dropping data.
const oversize = [];
for (const { name } of source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()) {
  const escaped = '"' + name.replaceAll('"', '""') + '"';
  for (const row of source.prepare(`SELECT * FROM ${escaped}`).all()) {
    const bytes = Object.values(row).reduce((n, value) => n + (typeof value === 'string' ? Buffer.byteLength(value) : value == null ? 0 : 8), 0);
    if (bytes >= 2_000_000) oversize.push({ table: name, key: name === 'settings' ? row.key : '(omitted)', bytes, limit: 2_000_000 });
  }
}
if (oversize.length) {
  const report = { checkedAt: new Date().toISOString(), sourcePath, success: false, stage: 'D1 size preflight', oversizedRows: oversize, sourceChanged: false, messagesSent: 0, cloudChanges: false };
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 }); source.close();
  console.error(JSON.stringify(report)); process.exit(2);
}
const root = path.resolve('dist/server');
const files = (await readdir(root, { recursive: true })).filter(x => /\.m?js$/.test(x)).sort((a, b) => a === 'index.js' ? -1 : b === 'index.js' ? 1 : a.localeCompare(b));
const modules = await Promise.all(files.map(async file => ({ type: 'ESModule', path: path.join(root, file), contents: await readFile(path.join(root, file), 'utf8') })));
let outbound = 0;
const mf = new Miniflare({ compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], modulesRoot: root, modules, d1Databases: ['DB'], bindings: { ADMIN_TOKEN: 'a'.repeat(64), SCHEDULER_TOKEN: 'b'.repeat(64), REMINDER_ENCRYPTION_KEY: 'c'.repeat(64) }, outboundService: () => { outbound++; return new Response('Blocked in restore rehearsal', { status: 503 }); } });
const quote = x => '"' + x.replaceAll('"', '""') + '"';
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
try {
  const db = await mf.getD1Database('DB');
  const schema = source.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type DESC,name").all();
  for (const s of schema.filter(x => x.type === 'table')) await db.prepare(s.sql).run();
  const verified = {};
  for (const { name } of schema.filter(x => x.type === 'table')) {
    const columns = source.prepare(`PRAGMA table_info(${quote(name)})`).all();
    const keys = columns.filter(x => x.pk).sort((a, b) => a.pk - b.pk).map(x => quote(x.name));
    assert.ok(keys.length, 'Primary key required');
    const select = `SELECT * FROM ${quote(name)} ORDER BY ${keys.join(',')}`;
    const rows = source.prepare(select).all();
    const sql = `INSERT INTO ${quote(name)} (${columns.map(x => quote(x.name)).join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
    let batch = [], bytes = 0;
    for (const row of rows) {
      const params = columns.map(x => row[x.name]);
      batch.push(db.prepare(sql).bind(...params)); bytes += Buffer.byteLength(JSON.stringify(params));
      if (batch.length >= 100 || bytes >= 512 * 1024) { await db.batch(batch); batch = []; bytes = 0; }
    }
    if (batch.length) await db.batch(batch);
    const restored = (await db.prepare(select).all()).results;
    assert.equal(digest(restored), digest(rows), 'D1 restore hash mismatch: ' + name);
    verified[name] = { rows: rows.length, sha256: digest(rows) };
    console.log(JSON.stringify({ verifiedTable: name, rows: rows.length }));
  }
  for (const s of schema.filter(x => x.type !== 'table')) await db.prepare(s.sql).run();
  for (const seq of source.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all()) {
    await db.batch([db.prepare('DELETE FROM sqlite_sequence WHERE name=?').bind(seq.name), db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').bind(seq.name, seq.seq)]);
  }
  assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
  const state = await mf.dispatchFetch('https://isolated.example/api/state');
  assert.equal(state.status, 200); const publicState = await state.json(); assert.equal(publicState.databaseReady, true);
  const home = await mf.dispatchFetch('https://isolated.example/'); assert.equal(home.status, 200); assert.match(await home.text(), /DayDay AI/);
  const unauth = await mf.dispatchFetch('https://isolated.example/api/scheduler'); assert.equal(unauth.status, 401);
  assert.equal(outbound, 0);
  const report = { checkedAt: new Date().toISOString(), sourcePath, localD1: true, productionSnapshot: true, allTableHashesMatched: true, tables: verified, homeStatus: home.status, publicStateStatus: state.status, unauthorizedSchedulerStatus: unauth.status, foreignKeyViolations: 0, outboundRequests: outbound, messagesSent: 0, liveSiteChanged: false };
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ success: true, reportPath, tables: Object.keys(verified).length, outboundRequests: outbound }));
} finally { source.close(); await mf.dispose(); }
