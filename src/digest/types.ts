export type RunStatus = 'ok' | 'retry' | 'fail';

/** One job's valid log events, aggregated in chronological order. */
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  failures: number;
  lastStatus: RunStatus;
  /** Most recent supplied error, retained even if a later event succeeds. */
  lastError: string | null;
  /** Original log timestamps, including their offsets. */
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  /** One row per job, sorted by job. A present but empty file has no rows. */
  rows: DigestRow[];
  badLines: number;
  /** Counts of valid log events, rather than each job's final status. */
  counts: Record<RunStatus, number>;
};

/** Returns null for a missing file or invalid night; malformed lines are counted. */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
