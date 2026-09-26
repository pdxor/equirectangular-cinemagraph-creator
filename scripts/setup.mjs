import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  await fs.copyFile(path.join(root, '.env.example'), path.join(root, '.env'), 1);
  console.log('Created .env with empty API keys. Add your keys in the local studio’s API settings.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Existing .env preserved.');
}
await fs.mkdir(path.join(root, 'data'), { recursive: true });
console.log('Ready. Run docker compose up --build -d, then open http://localhost:4317.');
