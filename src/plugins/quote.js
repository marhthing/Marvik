import sharp from 'sharp';

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text = '', lineLength = 34, maxLines = 8) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= lineLength) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  if (words.length && lines.join(' ').length < text.trim().length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(0, lineLength - 3))}...`;
  }
  return lines;
}

export default {
  name: 'quote',
  description: 'Turn text into a quote card image',
  commands: [
    {
      name: 'quote',
      aliases: [],
      description: 'Generate a quote image from replied text or inline text',
      usage: '.quote <text> or reply to a text with .quote',
      category: 'fun',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        const sourceText = ctx.quoted?.text || ctx.args.join(' ').trim();
        if (!sourceText) {
          await ctx.reply('Reply to a text message or pass text after .quote');
          return;
        }

        const author = ctx.quoted?.senderId
          ? `@${ctx.quoted.senderId.split('@')[0]}`
          : (ctx.senderName || 'Unknown');
        const lines = wrapText(sourceText);
        const quoteLines = lines
          .map((line, index) => `<text x="540" y="${170 + (index * 58)}" font-size="36" fill="#f7f2e8" font-family="Georgia, serif" text-anchor="middle">${escapeXml(line)}</text>`)
          .join('');

        const svg = `
          <svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#1e293b"/>
                <stop offset="100%" stop-color="#0f172a"/>
              </linearGradient>
            </defs>
            <rect width="1080" height="1080" fill="url(#bg)"/>
            <circle cx="150" cy="150" r="58" fill="#f59e0b" opacity="0.95"/>
            <text x="128" y="177" font-size="120" fill="#0f172a" font-family="Georgia, serif">"</text>
            ${quoteLines}
            <text x="540" y="950" font-size="30" fill="#f59e0b" font-family="Arial, sans-serif" letter-spacing="3" text-anchor="middle">${escapeXml(author.toUpperCase())}</text>
          </svg>
        `;

        const png = await sharp(Buffer.from(svg)).png().toBuffer();
        await ctx.sendMedia(png, {
          type: 'image',
          caption: 'Quote created.'
        });
      }
    }
  ]
};
