import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../site/public/demo-panorama.svg', import.meta.url));
const target = fileURLToPath(new URL('../site/public/demo-panorama.png', import.meta.url));
await sharp(source).png().toFile(target);
console.log('Prepared the original sample panorama (no API calls).');
