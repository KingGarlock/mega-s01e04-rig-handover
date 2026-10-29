import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
const firstAt = '2026-10-28T23:00:00+01:00';
const lastAt = '2026-10-29T00:00:00+01:00';
let runsDir: string;

function event(job: string, status: 'ok' | 'retry' | 'fail', owner: string | null = 'rook', at = firstAt, error?: string) {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

function writeNight(lines: string[]) {
  writeFileSync(join(runsDir, `${night}.jsonl`), lines.join('\n'));
}

function app() {
  return createApp({ adapter: 'test', installed: firstAt, beatEverySeconds: 60, runsDir });
}

beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-')); });
afterEach(() => { rmSync(runsDir, { recursive: true, force: true }); });

describe('digest HTML and JSON routes', () => {
  it('returns the same job order and values from HTML and JSON', async () => {
    writeNight([event('z-last', 'ok'), event('a-first', 'retry', null, firstAt, 'upstream 503'), event('a-first', 'ok', null, lastAt)]);
    const instance = app();
    const htmlResponse = await instance.request(`/digest/${night}`);
    const jsonResponse = await instance.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    const html = await htmlResponse.text();
    const digest = await jsonResponse.json() as NightDigest;
    expect(digest.rows.map(row => row.job)).toEqual(['a-first', 'z-last']);
    expect(html.indexOf('a-first')).toBeLessThan(html.indexOf('z-last'));
    expect(digest.rows[0]).toMatchObject({ owner: null, runs: 2, retries: 1, lastStatus: 'ok', lastError: 'upstream 503', firstAt, lastAt });
    expect(html).toContain('—');
    expect(html).toContain('upstream 503');
    expect(html).toContain(firstAt);
    expect(html).toContain(lastAt);
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<script\b/i);
  });

  it('returns 404 from both routes when the night is missing', async () => {
    const instance = app();
    expect((await instance.request(`/digest/${night}`)).status).toBe(404);
    expect((await instance.request(`/api/digest/${night}`)).status).toBe(404);
  });

  it('renders an empty night and returns no JSON rows', async () => {
    writeNight([]);
    const instance = app();
    const page = await instance.request(`/digest/${night}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('nothing ran');
    const response = await instance.request(`/api/digest/${night}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('keeps valid jobs when JSON or event schemas are malformed', async () => {
    writeNight([event('kept-job', 'ok'), '{broken', JSON.stringify({ at: firstAt, job: 'wrong-status', status: 'unknown', owner: null }), 'null']);
    const instance = app();
    const page = await instance.request(`/digest/${night}`);
    const response = await instance.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(response.status).toBe(200);
    expect(await page.text()).toContain('kept-job');
    expect(await response.json()).toMatchObject({ rows: [{ job: 'kept-job' }], badLines: 3 });
  });

  it('marks three retries and any failure even after recovery', async () => {
    writeNight([
      event('retry-job', 'retry'), event('retry-job', 'retry'), event('retry-job', 'retry'), event('retry-job', 'ok', 'rook', lastAt),
      event('recovered-job', 'fail', 'rook', firstAt, 'quota exceeded'), event('recovered-job', 'ok', 'rook', lastAt), event('ordinary-job', 'ok'),
    ]);
    const html = await (await app().request(`/digest/${night}`)).text();
    const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? [];
    expect(rows.find(row => row.includes('retry-job'))).toMatch(/class="[^"]*warn/);
    expect(rows.find(row => row.includes('recovered-job'))).toMatch(/class="[^"]*warn/);
    expect(rows.find(row => row.includes('ordinary-job'))).not.toMatch(/class="[^"]*warn/);
  });

  it('escapes log content in HTML while preserving JSON strings', async () => {
    const unsafe = '<script>alert("log")</script>';
    writeNight([event('escaped-job', 'fail', null, firstAt, unsafe)]);
    const instance = app();
    const html = await (await instance.request(`/digest/${night}`)).text();
    const digest = await (await instance.request(`/api/digest/${night}`)).json() as NightDigest;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(digest.rows[0].lastError).toBe(unsafe);
  });

  it('rejects invalid night values instead of reading other files', async () => {
    const instance = app();
    for (const invalid of ['not-a-night', '2026-02-30']) {
      expect((await instance.request(`/digest/${invalid}`)).status).toBe(404);
      expect((await instance.request(`/api/digest/${invalid}`)).status).toBe(404);
    }
  });
});
