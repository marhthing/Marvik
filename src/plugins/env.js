import { readEnvObject, setEnvValue, removeEnvValue } from '../utils/envStore.js';
const EXCLUDED_KEYS = ['BOT_NAME', 'LOG_LEVEL', 'OWNER_NUMBER'];

export default {
  name: 'env',
  description: 'View or update .env variables',
  version: '1.0.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'env',
      description: 'Manage .env variables',
      usage: '.env add VAR=VALUE | .env del VAR | .env list',
      category: 'owner',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        const [subcmd, ...rest] = ctx.args;
        let envObj = readEnvObject();
        
        // .env list
        if (!subcmd || subcmd === 'list') {
          let msg = '*Current .env variables:*\n';
          for (const [k, v] of Object.entries(envObj)) {
            if (EXCLUDED_KEYS.includes(k)) continue;
            msg += `• ${k} = ${v}\n`;
          }
          await ctx.reply(msg.trim());
          return;
        }
        
        // .env add VAR=VALUE
        if (subcmd === 'add') {
          // Get the raw text after ".env add " to preserve spaces
          const rawText = ctx.text || '';
          const prefix = ctx.prefix || '.';
          
          // Extract everything after ".env add "
          const addPattern = new RegExp(`^${prefix}env\\s+add\\s+`, 'i');
          const argText = rawText.replace(addPattern, '');
          
          // Find the first '=' to split key and value
          const eqIndex = argText.indexOf('=');
          
          if (eqIndex === -1) {
            await ctx.reply('Usage: .env add VAR=VALUE');
            return;
          }
          
          const key = argText.substring(0, eqIndex).trim();
          
          // Get value after '=' and trim ONLY leading spaces (not trailing)
          let value = argText.substring(eqIndex + 1);
          
          // Remove only leading spaces/whitespace at the start
          value = value.replace(/^\s+/, '');
          
          if (!key) {
            await ctx.reply('❌ Variable name cannot be empty');
            return;
          }
          
          if (EXCLUDED_KEYS.includes(key)) {
            await ctx.reply(`❌ You cannot update or add ${key} via this command.`);
            return;
          }
          
          setEnvValue(key, value);
          await ctx.reply(`✅ Updated .env: ${key}=${value}`);
          return;
        }
        
        // .env del VAR
        if (subcmd === 'del') {
          const key = rest.join(' ').trim();
          if (!key || EXCLUDED_KEYS.includes(key)) {
            await ctx.reply('Usage: .env del VAR (cannot delete protected keys)');
            return;
          }
          if (envObj[key] !== undefined) {
            removeEnvValue(key);
            await ctx.reply(`✅ Deleted .env variable: ${key}`);
          } else {
            await ctx.reply(`❌ Variable ${key} not found in .env.`);
          }
          return;
        }
        
        await ctx.reply('Usage: .env add VAR=VALUE | .env del VAR | .env list');
      }
    }
  ]
};
