export async function downloadMediaBuffer(ctx, media) {
  if (!media) {
    throw new Error('No media provided');
  }

  let buffer;
  let rawMessage = media.raw;
  if (!rawMessage || !rawMessage.message) {
    rawMessage = ctx.quoted?.raw && ctx.quoted.raw.message ? ctx.quoted.raw : ctx.raw;
  }

  if (rawMessage) {
    buffer = await ctx._adapter.downloadMedia({ raw: rawMessage });
  } else if (media.media) {
    buffer = await ctx.platformAdapter.downloadMedia(media.media);
  } else {
    throw new Error('No media source available');
  }

  if (!buffer || buffer.length === 0) {
    throw new Error('Empty buffer');
  }
  if (!Buffer.isBuffer(buffer)) {
    buffer = Buffer.from(buffer);
  }

  return buffer;
}

export function hasValidMediaHeader(buffer) {
  if (!buffer || buffer.length < 12) return false;
  const sig = buffer.slice(0, 12);
  const isJpeg = sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff;
  const isPng = sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47;
  const isGif = sig[0] === 0x47 && sig[1] === 0x49 && sig[2] === 0x46;
  const isWebp = sig.slice(0, 4).toString('ascii') === 'RIFF' && sig.slice(8, 12).toString('ascii') === 'WEBP';
  return isJpeg || isPng || isGif || isWebp;
}
