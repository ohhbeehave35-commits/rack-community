// Rasterize desktop/build/icon.svg into the PNG + multi-size ICO that
// electron-builder and the window use. Run by `npm run desktop:icon`.
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(dir, "build", "icon.svg"));

// 512px so it satisfies mac/linux icon requirements too (electron-builder wants
// >=512 for the mac icns; Windows uses icon.ico below).
const png512 = await sharp(svg).resize(512, 512).png().toBuffer();
writeFileSync(join(dir, "build", "icon.png"), png512);

const sizes = [16, 24, 32, 48, 64, 128, 256];
const buffers = await Promise.all(sizes.map((s) => sharp(svg).resize(s, s).png().toBuffer()));
const ico = await pngToIco(buffers);
writeFileSync(join(dir, "build", "icon.ico"), ico);

console.log("[make-icon] wrote build/icon.png (512) and build/icon.ico", sizes.join(","));
