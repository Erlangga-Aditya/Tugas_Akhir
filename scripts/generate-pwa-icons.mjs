// Generate PWA icons from the client's supplied logo without changing its artwork.
// The logo is centered and padded so Android's maskable safe zone cannot cut it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'logo-asli-klien.jpeg');
const outDir = path.join(root, 'public', 'icons');
const brandBackground = { r: 238, g: 77, b: 45, alpha: 1 };

const targets = [
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  { file: 'apple-touch-icon.png', size: 180, scale: 1 },
  { file: 'icon-maskable-192.png', size: 192, scale: 0.72 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.72 },
  { file: 'favicon-32.png', size: 32, scale: 1 },
  { file: 'favicon-16.png', size: 16, scale: 1 },
];

await fs.mkdir(outDir, { recursive: true });
const source = await fs.readFile(sourcePath);

for (const target of targets) {
  const inner = Math.max(1, Math.round(target.size * target.scale));
  const offset = Math.floor((target.size - inner) / 2);
  const logo = await sharp(source)
    .resize({ width: inner, height: inner, fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  const output = await sharp({
    create: { width: target.size, height: target.size, channels: 4, background: brandBackground },
  })
    .composite([{ input: logo, top: offset, left: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  await fs.writeFile(path.join(outDir, target.file), output);
  console.log(`${target.file} (${target.size}x${target.size})`);
}
