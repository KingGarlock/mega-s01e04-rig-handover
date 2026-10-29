import type { NightDigest } from '../digest/types.js';

export function DigestPage({ digest }: { digest: NightDigest }) {
  return (
    <>
      <h1>digest {digest.night}</h1>
      <p class="mute">bad lines: {digest.badLines}</p>
      {digest.rows.length === 0 ? <p>nothing ran</p> : null}
      <table>
        <thead>
          <tr>
            <th>job</th>
            <th>owner</th>
            <th>runs</th>
            <th>retries</th>
            <th>last status</th>
            <th>last error</th>
            <th>first / last time</th>
          </tr>
        </thead>
        <tbody>
          {digest.rows.map((row) => {
            const needsAttention = row.retries >= 3 || row.failures > 0;
            return (
              <tr class={needsAttention ? 'warn' : undefined}>
                <td>{row.job}</td>
                <td>{row.owner ?? '—'}</td>
                <td>{row.runs}</td>
                <td>{row.retries}</td>
                <td>
                  {row.lastStatus}
                  {needsAttention ? <span> · needs attention</span> : null}
                </td>
                <td>{row.lastError ?? '—'}</td>
                <td>{row.firstAt} / {row.lastAt}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
