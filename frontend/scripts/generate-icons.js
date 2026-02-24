/**
 * Generates PWA icons (192x192 and 512x512) from icon.svg using sharp.
 * Run: node scripts/generate-icons.js
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const src = path.join(__dirname, '../public/icons/icon.svg');
const outDir = path.join(__dirname, '../public/icons');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const sizes = [192, 512];

Promise.all(
  sizes.map((size) =>
    sharp(src)
      .resize(size, size)
      .png()
      .toFile(path.join(outDir, `icon-${size}.png`))
      .then(() => console.log(`Generated icon-${size}.png`))
  )
).catch((err) => {
  console.error('Icon generation failed:', err.message);
  console.error('Run: npm install sharp --save-dev');
  process.exit(1);
});
