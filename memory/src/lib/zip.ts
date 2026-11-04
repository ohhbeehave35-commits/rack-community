const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}
function u32(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function cat(parts: Uint8Array[]) {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function safeZipPath(path: string) {
  const cleaned = path
    .replaceAll("\0", "")
    .replaceAll("\\", "/")
    .replace(/^[a-zA-Z]:/, "")
    .split("/")
    .filter((p) => p && p !== "." && p !== ".." && p !== ":")
    .join("/")
    .replace(/^\/+/, "")
    .slice(0, 180);
  return cleaned || "file.txt";
}

/** Unix mode stored in ZIP external attributes so Mac unzip keeps +x on .command/.sh/.py. */
export function zipUnixMode(path: string) {
  const p = path.replaceAll("\\", "/");
  const exec =
    /\.(sh|command|py)$/i.test(p) ||
    /(^|\/)(install-watch|somnus-watch)(\.|$)/i.test(p);
  return exec ? 0o100755 : 0o100644;
}

export function zipStore(files: { path: string; body: string }[]): Blob {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(safeZipPath(file.path));
    const data = enc.encode(file.body);
    const crc = crc32(data);
    const local = cat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    // version made by = Unix (3) << 8 | 20, so Finder keeps the exec bit
    const central = cat([
      u32(0x02014b50),
      u16((3 << 8) | 20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32((zipUnixMode(file.path) << 16) >>> 0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralBlob = cat(centrals);
  const eocd = cat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBlob.length),
    u32(offset),
    u16(0),
  ]);
  return new Blob([cat([...locals, centralBlob, eocd])], {
    type: "application/zip",
  });
}

export function downloadZip(filename: string, files: { path: string; body: string }[]) {
  if (typeof document === "undefined") return;
  const blob = zipStore(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
