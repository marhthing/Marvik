function normalizeBinary(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.from(value);
  if (value?.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
  if (typeof value === 'string') {
    try {
      return Buffer.from(value, 'base64');
    } catch {
      return null;
    }
  }
  return null;
}

export function extractStickerSha256(stickerMessage = null, raw = null) {
  return normalizeBinary(
    stickerMessage?.fileSha256 ||
    raw?.message?.stickerMessage?.fileSha256 ||
    raw?.stickerMessage?.fileSha256 ||
    null
  );
}

export function getStickerId(stickerMessage = null, raw = null) {
  const fileSha256 = extractStickerSha256(stickerMessage, raw);
  if (!fileSha256 || fileSha256.length === 0) return null;
  return Buffer.from(fileSha256).toString('base64');
}
