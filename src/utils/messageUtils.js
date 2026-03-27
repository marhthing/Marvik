export function getMessageContextInfo(message = {}) {
  return message?.extendedTextMessage?.contextInfo ||
         message?.imageMessage?.contextInfo ||
         message?.videoMessage?.contextInfo ||
         message?.audioMessage?.contextInfo ||
         message?.documentMessage?.contextInfo ||
         message?.stickerMessage?.contextInfo ||
         null;
}

export function extractMessageText(message = {}) {
  return message?.conversation ||
         message?.extendedTextMessage?.text ||
         message?.imageMessage?.caption ||
         message?.videoMessage?.caption ||
         message?.documentMessage?.caption ||
         message?.buttonsMessage?.contentText ||
         message?.listMessage?.description ||
         message?.buttonsResponseMessage?.selectedDisplayText ||
         message?.listResponseMessage?.title ||
         '';
}

export function getQuotedContextInfo(ctx) {
  return getMessageContextInfo(ctx?.raw?.message);
}

export function getQuotedMessageObject(ctx) {
  return getQuotedContextInfo(ctx)?.quotedMessage || null;
}

export function getQuotedText(ctx, fallback = '') {
  if (ctx?.quoted?.text) return ctx.quoted.text;
  const quotedMessage = getQuotedMessageObject(ctx);
  return quotedMessage ? extractMessageText(quotedMessage) : fallback;
}

export function getQuotedImageMessage(ctx) {
  return ctx?.quoted?.message?.imageMessage ||
         getQuotedMessageObject(ctx)?.imageMessage ||
         null;
}

export function getOwnerJid(ctx) {
  const ownerNumber = ctx?.platformAdapter?.config?.ownerNumber ||
    ctx?.bot?.config?.ownerNumber ||
    process.env.OWNER_NUMBER ||
    '';
  return ownerNumber ? `${ownerNumber}@s.whatsapp.net` : null;
}

export function buildForwardPayload(ctx) {
  const contextInfo = getQuotedContextInfo(ctx);
  const quotedMessage = contextInfo?.quotedMessage;

  if (quotedMessage) {
    return {
      key: {
        id: contextInfo?.stanzaId,
        remoteJid: contextInfo?.remoteJid || ctx.raw?.key?.remoteJid,
        participant: contextInfo?.participant,
        fromMe: false
      },
      message: quotedMessage
    };
  }

  return {
    key: ctx.raw?.key,
    message: ctx.raw?.message
  };
}
