import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ override: true });

// Auto-fill missing .env variables with defaults (template)
const envPath = path.resolve(process.cwd(), '.env');
const requiredVars = {
  BOT_NAME: 'MATDEV',
  PREFIX: '.',
  OWNER_NUMBER: '',
  ENABLE_WHATSAPP: 'true',
  LOG_LEVEL: 'info',
  MAX_COMMAND_COOLDOWN: '3000',
  STICKER_PACK: 'MATDEV Bot',
  STICKER_AUTHOR: 'Bot',
  WEBAPP_URL: 'http://localhost:3001/webapp',
  // Auto features defaults
  AUTO_TYPING: 'false',
  ALWAYS_ONLINE: 'false',
  AUTO_READ: 'false',
  AUTO_REACT: 'false',
  AUTO_STATUS_REACT: 'false',
};
// Ensure .env exists and is populated with all required variables
let envContent = '';
if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf-8');
} else {
  envContent = '';
}

let changed = false;
for (const [key, def] of Object.entries(requiredVars)) {
  const regex = new RegExp(`^${key}=`, 'm');
  if (!regex.test(envContent)) {
    envContent += (envContent.length > 0 && !envContent.endsWith('\n') ? '\n' : '') + `${key}=${def}`;
    changed = true;
  }
}

if (changed || !fs.existsSync(envPath)) {
  fs.writeFileSync(envPath, envContent.trim() + '\n');
}

// Always reload env variables from .env, overriding any system env
dotenv.config({ override: true });

export default {
  // Bot settings
  botName: process.env.BOT_NAME || 'MATDEV',
  prefix: process.env.PREFIX || '.',

  // Owner settings
  ownerNumber: process.env.OWNER_NUMBER || '',

  // Platform toggles
  platforms: {
    whatsapp: (typeof process.env.ENABLE_WHATSAPP !== 'undefined' ? process.env.ENABLE_WHATSAPP : requiredVars.ENABLE_WHATSAPP) === 'true'
  },

  // Sticker defaults
  stickerPack: process.env.STICKER_PACK || 'MATDEV Bot',
  stickerAuthor: process.env.STICKER_AUTHOR || 'Bot',

  // Rate limiting
  rateLimiting: {
    enabled: true,
    maxCommands: 5,
    windowMs: 10000 // 10 seconds
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },

  // Paths
  paths: {
    session: './session',
    storage: './storage',
    tmp: './tmp',
    plugins: './src/plugins'
  },

  // Webapp URL
  webappUrl: process.env.WEBAPP_URL || 'http://localhost:3001/webapp'
};
