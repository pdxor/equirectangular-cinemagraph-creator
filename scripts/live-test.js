import fs from 'node:fs/promises';
import { readConfig } from '../server/config.js';
const config = await readConfig();
const checks = [];
for (const [name, url, key] of [
  ['OpenAI authentication', 'https://api.openai.com/v1/models', config.OPENAI_API_KEY],
  ['Grok authentication', 'https://api.x.ai/v1/models', config.XAI_API_KEY],
]) {
  if (!key) { checks.push({ name, result: 'SKIP', reason: 'No configured key' }); continue; }
  try {
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(20000) });
    checks.push({ name, result: response.ok ? 'PASS' : 'FAIL', http: response.status });
  } catch { checks.push({ name, result: 'FAIL', reason: 'Connection failed' }); }
}
const response = await fetch('http://localhost:' + config.PORT + '/api/health').catch(() => null);
checks.push({ name: 'Local server', result: response?.ok ? 'PASS' : 'FAIL' });
const health = await response?.json();
checks.push({ name: 'FFmpeg', result: health?.ffmpeg ? 'PASS' : 'FAIL' });
await fs.mkdir('test-results', { recursive: true });
await fs.writeFile('test-results/live-auth.json', JSON.stringify({ testedAt: new Date().toISOString(), checks }, null, 2));
console.log(JSON.stringify(checks, null, 2));
if (checks.some(c => c.result === 'FAIL')) process.exitCode = 1;
