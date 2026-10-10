// Builds assets/icon.png and a multi-size assets/icon.ico from the logo in the project root.
// Run with:  npx electron scripts/make-icon.js   (uses Electron's nativeImage for resizing)
const { app, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

app.whenReady().then(() => {
  const src = nativeImage.createFromPath(path.join(root, "Cat Yandex_DS.png"));
  if (src.isEmpty()) throw new Error("Cat Yandex_DS.png not found or unreadable");
  const pngs = SIZES.map((n) => src.resize({ width: n, height: n, quality: "best" }).toPNG());

  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(SIZES.length, 4);
  let offset = 6 + 16 * SIZES.length;
  const entries = SIZES.map((n, i) => {
    const e = Buffer.alloc(16);
    e[0] = n === 256 ? 0 : n;
    e[1] = n === 256 ? 0 : n;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return e;
  });

  const dir = path.join(root, "assets");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "icon.png"), src.resize({ width: 512, height: 512, quality: "best" }).toPNG());
  fs.writeFileSync(path.join(dir, "icon.ico"), Buffer.concat([head, ...entries, ...pngs]));
  console.log("icons written to", dir);
  app.quit();
});
