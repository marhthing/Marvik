import axios from 'axios';
import logger from '../utils/logger.js';

const pluginLogger = logger.child({ component: 'translate' });

export default {
  name: 'translate',
  description: 'Translate text between different languages',
  version: '1.0.1',
  author: 'Are Martins',
  
  // Helper method to get language code
  getLanguageCode(input) {
    const lower = input.toLowerCase();
    const languages = {
      'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German', 'it': 'Italian',
      'pt': 'Portuguese', 'ru': 'Russian', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
      'ar': 'Arabic', 'hi': 'Hindi', 'tr': 'Turkish', 'pl': 'Polish', 'nl': 'Dutch',
      'sv': 'Swedish', 'da': 'Danish', 'no': 'Norwegian', 'fi': 'Finnish', 'cs': 'Czech',
      'hu': 'Hungarian', 'ro': 'Romanian', 'bg': 'Bulgarian', 'hr': 'Croatian', 'sk': 'Slovak',
      'sl': 'Slovenian', 'et': 'Estonian', 'lv': 'Latvian', 'lt': 'Lithuanian', 'mt': 'Maltese'
    };
    
    if (languages[lower]) return lower;
    for (const [code, name] of Object.entries(languages)) {
      if (name.toLowerCase() === lower) return code;
    }
    return null;
  },

  // Helper method to translate text
  async translateText(text, toLang) {
    try {
      const response = await axios.post(
        'https://translate.googleapis.com/translate_a/single',
        null,
        {
          params: { client: 'gtx', sl: 'auto', tl: toLang, dt: 't', q: text },
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        }
      );
      if (response.data && response.data[0] && response.data[0][0]) {
        return { success: true, text: response.data[0][0][0], fromLang: response.data[2] || 'auto' };
      }
      return { success: false, error: 'Translation failed' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  commands: [
    {
      name: 'translate',
      aliases: ['tr', 'trans'],
      description: 'Translate text to another language',
      usage: '.translate <to_language> <text> OR .translate languages',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      
      async execute(ctx) {
        try {
          const args = ctx.args;
          // Find the plugin object in the bot's plugin loader if available
          const plugin = ctx.plugin || (ctx.client?.commandRegistry?.commands?.get('translate')?.plugin);
          
          // Self-contained helper if plugin context is missing
          const getLanguageCode = (input) => {
            const lower = input.toLowerCase();
            const languages = {
              'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German', 'it': 'Italian',
              'pt': 'Portuguese', 'ru': 'Russian', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
              'ar': 'Arabic', 'hi': 'Hindi', 'tr': 'Turkish', 'pl': 'Polish', 'nl': 'Dutch',
              'sv': 'Swedish', 'da': 'Danish', 'no': 'Norwegian', 'fi': 'Finnish', 'cs': 'Czech',
              'hu': 'Hungarian', 'ro': 'Romanian', 'bg': 'Bulgarian', 'hr': 'Croatian', 'sk': 'Slovak',
              'sl': 'Slovenian', 'et': 'Estonian', 'lv': 'Latvian', 'lt': 'Lithuanian', 'mt': 'Maltese'
            };
            if (languages[lower]) return lower;
            for (const [code, name] of Object.entries(languages)) {
              if (name.toLowerCase() === lower) return code;
            }
            return null;
          };

          const translateText = async (text, toLang) => {
            try {
              const response = await axios.post(
                'https://translate.googleapis.com/translate_a/single',
                null,
                {
                  params: { client: 'gtx', sl: 'auto', tl: toLang, dt: 't', q: text },
                  timeout: 10000,
                  headers: { 'User-Agent': 'Mozilla/5.0' }
                }
              );
              if (response.data && response.data[0] && response.data[0][0]) {
                return { success: true, text: response.data[0][0][0], fromLang: response.data[2] || 'auto' };
              }
              return { success: false, error: 'Translation failed' };
            } catch (e) { return { success: false, error: e.message }; }
          };

          if (args.length < 1) {
            return await ctx.reply('🌐 *Usage:* .translate <to_language> <text>\nExample: .translate fr Good morning');
          }

          if (args[0].toLowerCase() === 'languages' || args[0].toLowerCase() === 'lg') {
            return await ctx.reply('🌐 *Available:* en, es, fr, de, it, pt, ru, ja, ko, zh, ar, hi, tr, pl, nl, sv, da, no, fi, cs, hu, ro, bg, hr, sk, sl, et, lv, lt, mt');
          }

          if (args.length < 2) return await ctx.reply('❌ Missing text to translate.');

          const toLang = args[0].toLowerCase();
          const text = args.slice(1).join(' ');

          const toLangCode = getLanguageCode(toLang);
          if (!toLangCode) return await ctx.reply(`❌ Language "${toLang}" not supported.`);

          await ctx.reply('🔄 Translating...');
          const result = await translateText(text, toLangCode);
          
          if (result.success) {
            return await ctx.reply(`🌐 *Translation*\n*To:* ${toLangCode}\n\n*Result:*\n${result.text}`);
          } else {
            return await ctx.reply(`❌ ${result.error}`);
          }
        } catch (error) {
          pluginLogger.error({ error }, 'Translate command failed');
          return await ctx.reply('❌ Translation error occurred.');
        }
      }
    }
  ]
};

