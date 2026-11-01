// A stand-in for the `claude` CLI, used only by assistantBridge.test.ts (set as CLAUDE_BIN).
// Behaviour comes from FAKE_MODE; FAKE_LOG, when set, receives what the bridge handed this process.
import { writeFileSync } from 'node:fs';

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => {
  const mode = process.env.FAKE_MODE || 'ok';
  if (process.env.FAKE_LOG) {
    writeFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), envKeys: Object.keys(process.env), stdin }));
  }
  const envelope = (so) => JSON.stringify({ type: 'result', is_error: false, total_cost_usd: 0.01, structured_output: so });
  if (mode === 'ok') process.stdout.write(envelope({ v: 1, say: 'hi', ops: [] }));
  else if (mode === 'bad_json') process.stdout.write('this is not json');
  else if (mode === 'no_structured') process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: 'text only' }));
  else if (mode === 'error_envelope') process.stdout.write(JSON.stringify({ type: 'result', is_error: true, structured_output: { v: 1 } }));
  else if (mode === 'huge') process.stdout.write('x'.repeat(200 * 1024));
  else if (mode === 'crash') { process.stderr.write('secret stderr text'); process.exit(3); }
  else if (mode === 'slow') setTimeout(() => process.stdout.write(envelope({ v: 1, say: 'late', ops: [] })), 30000);
  else if (mode === 'medium') setTimeout(() => process.stdout.write(envelope({ v: 1, say: 'hi', ops: [] })), 600);
});
