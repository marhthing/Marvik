import QRCode from 'qrcode';
import fs from 'fs-extra';
import path from 'path';
import { reactIfEnabled } from '../utils/pendingActions.js';

export default {
  name: 'qrcode',
  description: 'QR Code Generator',
  version: '1.1.0',
  author: 'Are Martins',

  commands: [
    {
      name: 'qr',
      aliases: ['qrcode'],
      description: 'Generate a QR code from text',
      usage: '.qr <text>',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        try {
          if (!ctx.args.length) {
            return await ctx.reply('Please provide text to generate QR code.\n\nUsage: .qr <text or URL>');
          }
          
          const text = ctx.args.join(' ');

          await reactIfEnabled(ctx, '⏳');

          // Generate QR code as buffer in memory (no file save)
          const qrBuffer = await QRCode.toBuffer(text, {
            color: { dark: '#000000', light: '#ffffff' },
            width: 500,
            margin: 2
          });

          await ctx._adapter.sendMedia(ctx.chatId, qrBuffer, {
            type: 'image',
            mimetype: 'image/png',
            caption: `QR Code for: ${text.length > 100 ? text.substring(0, 100) + '...' : text}`
          });

          await reactIfEnabled(ctx, '✅');
          
        } catch (error) {
          // console.error('QR Error:', error);
          await reactIfEnabled(ctx, '❌');
          await ctx.reply('Failed to generate QR code. Please try again.');
        }
      }
    }
  ]
};

