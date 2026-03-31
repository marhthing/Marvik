import { readEnvObject, setEnvValue, removeEnvValue } from '../utils/envStore.js';

const EXCLUDED_KEYS = ['BOT_NAME', 'LOG_LEVEL', 'OWNER_NUMBER'];
const HIDDEN_KEYS = ['YOUTUBE_COOKIES'];

function normalizeEnvValueForStorage(key, value) {
  if (key !== 'YOUTUBE_COOKIES') return value;
  return String(value)
    .replace(/\r/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function formatEnvValueForDisplay(key, value) {
  if (HIDDEN_KEYS.includes(key)) return '[hidden]';
  return value;
}

export default {
  name: 'env',
  description: 'View or update .env variables',
  version: '1.1.0',
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
        const envObj = readEnvObject();

        if (!subcmd || subcmd === 'list') {
          let msg = '*Current .env variables:*\n';
          for (const [k, v] of Object.entries(envObj)) {
            if (EXCLUDED_KEYS.includes(k)) continue;
            msg += `• ${k} = ${formatEnvValueForDisplay(k, v)}\n`;
          }
          await ctx.reply(msg.trim());
          return;
        }

        if (subcmd === 'add') {
          const rawText = ctx.text || '';
          const prefix = ctx.prefix || '.';
          const addPattern = new RegExp(`^${prefix}env\\s+add\\s+`, 'i');
          const argText = rawText.replace(addPattern, '');
          const eqIndex = argText.indexOf('=');

          if (eqIndex === -1) {
            await ctx.reply('Usage: .env add VAR=VALUE');
            return;
          }

          const key = argText.substring(0, eqIndex).trim();
          let value = argText.substring(eqIndex + 1);
          value = value.replace(/^\s+/, '');

          if (!key) {
            await ctx.reply('❌ Variable name cannot be empty');
            return;
          }

          if (EXCLUDED_KEYS.includes(key)) {
            await ctx.reply(`❌ You cannot update or add ${key} via this command.`);
            return;
          }

          const storedValue = normalizeEnvValueForStorage(key, value);
          setEnvValue(key, storedValue);
          await ctx.reply(`✅ Updated .env: ${key}=${formatEnvValueForDisplay(key, storedValue)}`);
          return;
        }

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
