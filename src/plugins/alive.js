// alive.js - .alive plugin for uptime reporting
import os from 'os';

let botStartTime = Date.now();

// This will be set by the bot manager or main entry point
if (global.__BOT_START_TIME) {
  botStartTime = global.__BOT_START_TIME;
}

export default {
  name: 'alive',
  description: 'Show how long the bot has been running',
  version: '1.0.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'alive',
      aliases: ['uptime', 'awake'],
      description: 'Show bot uptime',
      usage: '.alive',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 2,
      async execute(ctx) {
        const now = Date.now();
        const ms = now - botStartTime;
        const days = Math.floor(ms / (24 * 60 * 60 * 1000));
        const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
        const seconds = Math.floor((ms % (60 * 1000)) / 1000);
        let uptime = '';
        if (days > 0) uptime += `${days}d `;
        if (hours > 0 || uptime) uptime += `${hours}h `;
        if (minutes > 0 || uptime) uptime += `${minutes}m `;
        uptime += `${seconds}s`;
        await ctx.reply(`🤖 Bot is alive!

Uptime: ${uptime.trim()}`);
      }
    }
  ],
  // Set the start time when the plugin is loaded
  onLoad(bot) {
    // Use global start time if available, else set now
    if (global.__BOT_START_TIME) {
      botStartTime = global.__BOT_START_TIME;
    } else {
      botStartTime = Date.now();
      global.__BOT_START_TIME = botStartTime;
    }
  }
};

