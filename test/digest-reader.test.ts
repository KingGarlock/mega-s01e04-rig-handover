import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const directories: string[] = [];

function runsDir(contents?: string) {
  const directory = mkdtempSync(join(tmpdir(), 'digest-reader-'));
  directories.push(directory);
  if (contents !== undefined) writeFileSync(join(directory, `${night}.jsonl`), contents);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('readNight', () => {
  it('aggregates the real fixture without dropping a null owner', () => {
    const digest = readNight('runs', night);
    expect(digest).toMatchObject({ night, badLines: 1, counts: { ok: 10, retry: 4, fail: 1 } });
    expect(digest?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows[0]).toMatchObject({ owner: null, runs: 1, lastError: null });
    expect(digest?.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, failures: 0,
      lastStatus: 'ok', lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(digest?.rows[2]).toMatchObject({ runs: 8, retries: 1, failures: 0, lastError: 'lock held' });
    expect(digest?.rows[3]).toMatchObject({ failures: 1, lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('orders events by instant, preserves offsets, and uses the latest owner and supplied error', () => {
    const directory = runsDir([
      { at: '2026-10-28T10:30:00Z', job: 'z', owner: null, status: 'ok' },
      { at: '2026-10-28T12:00:00+02:00', job: 'z', owner: 'second', status: 'fail', error: 'latest error' },
      { at: '2026-10-28T09:00:00Z', job: 'z', owner: 'first', status: 'retry', error: 'old error' },
      { at: '2026-10-28T08:00:00-04:00', job: 'a', owner: 'a', status: 'ok' },
    ].map(event => JSON.stringify(event)).join('\n'));
    expect(readNight(directory, night)).toEqual({
      night, badLines: 0, counts: { ok: 2, retry: 1, fail: 1 },
      rows: [
        { job: 'a', owner: 'a', runs: 1, retries: 0, failures: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T08:00:00-04:00', lastAt: '2026-10-28T08:00:00-04:00' },
        { job: 'z', owner: null, runs: 3, retries: 1, failures: 1, lastStatus: 'ok', lastError: 'latest error',
          firstAt: '2026-10-28T09:00:00Z', lastAt: '2026-10-28T10:30:00Z' },
      ],
    });
  });

  it('counts malformed JSON and invalid schemas, while ignoring blank lines', () => {
    const valid = { at: '2026-10-28T23:00:00+01:00', job: 'job', owner: null, status: 'ok' };
    const invalid: unknown[] = [
      null, [], 42, 'event', {},
      { ...valid, at: 'invalid' }, { ...valid, at: 42 },
      { ...valid, job: '' }, { ...valid, job: null },
      { ...valid, status: 'unknown' }, { ...valid, owner: 42 },
      { at: valid.at, job: valid.job, status: valid.status },
      { ...valid, error: null }, { ...valid, error: 42 },
    ];
    const directory = runsDir(['  ', ...invalid.map(value => JSON.stringify(value)), '{broken', '', JSON.stringify(valid), '\t'].join('\r\n'));
    const digest = readNight(directory, night);
    expect(digest).toMatchObject({ badLines: invalid.length + 1, counts: { ok: 1, retry: 0, fail: 0 } });
    expect(digest?.rows).toHaveLength(1);
  });

  it('allows an empty supplied error to replace an earlier error', () => {
    const directory = runsDir([
      { at: '2026-10-28T10:00:00Z', job: 'job', owner: 'old', status: 'fail', error: 'old' },
      { at: '2026-10-28T10:00:00Z', job: 'job', owner: 'new', status: 'ok', error: '' },
    ].map(event => JSON.stringify(event)).join('\n'));
    expect(readNight(directory, night)?.rows[0]).toMatchObject({ lastError: '', owner: 'new', lastStatus: 'ok' });
  });

  it('returns an empty digest for an existing empty file', () => {
    expect(readNight(runsDir(''), night)).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('returns null for a missing file', () => {
    expect(readNight(runsDir(), night)).toBeNull();
  });

  it.each(['../2026-10-28', '2026-10-28/..', '/2026-10-28', '2026-1-28', '2026-02-29', '2026-13-01', '2026-00-01', '2026-10-32', '2026-10-28\n'])('rejects invalid night %j', value => {
    expect(readNight(runsDir(''), value)).toBeNull();
  });

  it('accepts a valid leap day', () => {
    const directory = runsDir();
    writeFileSync(join(directory, '2024-02-29.jsonl'), '');
    expect(readNight(directory, '2024-02-29')?.night).toBe('2024-02-29');
  });

  it('propagates filesystem errors other than a missing file', () => {
    const directory = runsDir();
    mkdirSync(join(directory, `${night}.jsonl`));
    expect(() => readNight(directory, night)).toThrow();
  });
});
