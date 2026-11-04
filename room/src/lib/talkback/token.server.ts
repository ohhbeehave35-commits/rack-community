import { createHash, randomBytes } from "node:crypto";

export function mintToken() {
  const token = `tb_${randomBytes(24).toString("base64url")}`;
  return {
    token,
    hash: hashToken(token),
    prefix: token.slice(0, 12),
  };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
