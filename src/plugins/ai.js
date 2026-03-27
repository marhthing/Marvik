import ai from '../utils/ai.js';
import { shouldReact } from '../utils/pendingActions.js';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { extractMessageText, getQuotedMessageObject } from '../utils/messageUtils.js';
import { readJson, writeJson } from '../utils/storageStore.js';

const AIMODE_FILE = path.join(process.cwd(), 'storage', 'ai_mode.json');

// Keywords that indicate user wants to generate an image
const IMAGE_GEN_KEYWORDS = [
  'generate an image', 'create an image', 'make an image', 'draw', 'create a picture',
  'generate a picture', 'make a picture', 'design an image', 'create a design',
  'generate image', 'create image', 'make image', 'generate picture', 'create picture'
];
function loadAIMode() {
  return readJson(AIMODE_FILE, {});
}
function saveAIMode(data) {
  writeJson(AIMODE_FILE, data);
}

export default {
  name: 'ai',
  description: 'AI-powered assistant using Groq',
  version: '1.0.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'ai',
      aliases: ['gpt', 'chat'],
      description: 'Ask the AI anything',
      usage: '.ai <your question>',
      category: 'ai',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 5,
      async execute(ctx) {
        try {
          let question = ctx.args.join(' ');
          let quotedMsg = getQuotedMessageObject(ctx);
          if (!question) {
            if (quotedMsg) {
              question = extractMessageText(quotedMsg);
            }
          }
          // If both question and quotedMsg, combine for AI context
          if (question && quotedMsg) {
            let quotedText = extractMessageText(quotedMsg);
            question = `User asked: "${question}"
Quoted message: "${quotedText}"`;
          }
          if (!question || !question.trim()) {
            return await ctx.reply('Please ask me something!\n\nUsage: .ai What is the meaning of life?');
          }
          
          if (shouldReact()) await ctx.react('🤔');
          
          const response = await ai.askAI(question);
          
          if (response) {
            await ctx.reply(`🤖 *AI Response*\n\n${response}`);
            if (shouldReact()) await ctx.react('✅');
          } else {
            await ctx.reply('Sorry, I couldn\'t generate a response. Please try again.');
            if (shouldReact()) await ctx.react('❌');
          }
          
        } catch (error) {
          console.error('AI command error:', error);
          
          if (error.message?.includes('GROQ_API_KEY')) {
            await ctx.reply('AI is not configured. Please set up the GROQ_API_KEY.');
          } else {
            await ctx.reply('An error occurred while processing your request. Please try again later.');
          }
          if (shouldReact()) await ctx.react('❌');
        }
      }
    },
    {
      name: 'aistatus',
      aliases: ['aicache'],
      description: 'Check AI cache status',
      usage: '.aistatus',
      category: 'ai',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 10,
      async execute(ctx) {
        try {
          const cache = ai.loadCache();
          
          let status = '🤖 *AI Cache Status*\n\n';
          status += `📝 Would You Rather: ${cache.wouldYouRather?.length || 0} items\n`;
          status += `❓ Trivia: ${cache.trivia?.length || 0} items\n`;
          status += `🤔 Truth: ${cache.truth?.length || 0} items\n`;
          status += `😈 Dare: ${cache.dare?.length || 0} items\n`;
          status += `🧩 Riddles: ${cache.riddles?.length || 0} items\n`;
          
          const lastUpdated = cache.lastUpdated || {};
          if (Object.keys(lastUpdated).length > 0) {
            status += '\n*Last Updated:*\n';
            for (const [type, time] of Object.entries(lastUpdated)) {
              const date = new Date(time).toLocaleString();
              status += `• ${type}: ${date}\n`;
            }
          }
          
          await ctx.reply(status);
          
        } catch (error) {
          console.error('AI status error:', error);
          await ctx.reply('Error checking AI status.');
        }
      }
    },
    {
      name: 'airefill',
      aliases: ['airefresh'],
      description: 'Refill AI cache with fresh content',
      usage: '.airefill <type>',
      category: 'ai',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 60,
      async execute(ctx) {
        try {
          const type = ctx.args[0]?.toLowerCase();
          const validTypes = ['wouldyourather', 'trivia', 'truth', 'dare', 'riddles'];
          
          if (!type || !validTypes.includes(type)) {
            return await ctx.reply(`Please specify a type to refill:\n\n• wouldyourather\n• trivia\n• truth\n• dare\n• riddles\n\nUsage: .airefill trivia`);
          }
          
          const typeMap = {
            'wouldyourather': 'wouldYouRather',
            'trivia': 'trivia',
            'truth': 'truth',
            'dare': 'dare',
            'riddles': 'riddles'
          };
          
          await ctx.reply(`🔄 Generating new ${type} content... This may take a moment.`);
          await ctx.react('⏳');
          
          const items = await ai.generateBulkContent(typeMap[type], 50);
          
          if (items.length > 0) {
            await ctx.reply(`✅ Generated ${items.length} new ${type} items!`);
            await ctx.react('✅');
          } else {
            await ctx.reply(`❌ Failed to generate ${type} content. Check the API key and try again.`);
            await ctx.react('❌');
          }
          
        } catch (error) {
          console.error('AI refill error:', error);
          await ctx.reply('Error refilling cache.');
          await ctx.react('❌');
        }
      }
    },
    {
      name: 'aimode',
      description: 'Enable continuous AI chat in this chat',
      usage: '.aimode | .aimode stop | .aimode clear',
      category: 'ai',
      cooldown: 3,
      async execute(ctx) {
        const arg = ctx.args[0]?.toLowerCase();
        const chatId = ctx.chatId;
        let state = loadAIMode();
        
        if (arg === 'stop') {
          if (state[chatId]?.active) {
            state[chatId].active = false;
            saveAIMode(state);
            await ctx.reply('🛑 AI mode stopped for this chat. Your conversation history is saved.');
          } else {
            await ctx.reply('AI mode is not active in this chat.');
          }
          return;
        }
        
        if (arg === 'clear') {
          if (state[chatId]) {
            state[chatId].history = [];
            saveAIMode(state);
            await ctx.reply('🗑️ AI conversation history cleared for this chat.');
          } else {
            await ctx.reply('No AI history to clear in this chat.');
          }
          return;
        }
        
        if (!state[chatId]) {
          state[chatId] = { active: true, history: [] };
          saveAIMode(state);
          await ctx.reply('🤖 AI mode activated! All your messages will be sent to AI until you send .aimode stop.');
        } else if (!state[chatId].active) {
          state[chatId].active = true;
          saveAIMode(state);
          const historyCount = state[chatId].history?.length || 0;
          await ctx.reply(`🤖 AI mode activated! Continuing from your previous conversation (${historyCount} messages saved).`);
        } else {
          await ctx.reply('AI mode is already active in this chat. Send .aimode stop to exit.');
        }
      }
    }
  ],
  async onMessage(ctx) {
    if (ctx.text?.startsWith('.')) return;
    const chatId = ctx.chatId;
    let state = loadAIMode();
    if (!state[chatId]?.active) return;
    
    state[chatId].history = state[chatId].history || [];
    const userText = ctx.text || '';
    const lowerText = userText.toLowerCase();
    
    // Check if user sent or quoted an image
    const quotedMsg = ctx.quoted || ctx;
    const mimetype = quotedMsg?.mimetype || quotedMsg?.msg?.mimetype || 
                     quotedMsg?.message?.imageMessage?.mimetype ||
                     ctx.raw?.message?.imageMessage?.mimetype;
    const isImage = mimetype?.includes('image');
    
    // Check if user wants to generate an image
    const wantsImageGen = IMAGE_GEN_KEYWORDS.some(kw => lowerText.includes(kw));
    
    try {
      // CASE 1: User sent/quoted an image - analyze it with vision
      if (isImage && userText) {
        state[chatId].history.push({ role: 'user', content: `[Sent an image] ${userText}` });
        if (shouldReact()) await ctx.react('👁️');
        
        try {
          const buffer = await ctx._adapter.downloadMedia({ raw: quotedMsg.raw || quotedMsg });
          const groq = (await import('groq-sdk')).default;
          const client = new groq({ apiKey: process.env.GROQ_API_KEY });
          const base64Image = buffer.toString('base64');
          
          // Build conversation context for vision
          const recentHistory = state[chatId].history.slice(-10).map(m => 
            `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`
          ).join('\n');
          
          const completion = await client.chat.completions.create({
            messages: [
              {
                role: 'system',
                content: `You are a helpful AI assistant in a continuous conversation. Here's the recent conversation context:\n${recentHistory}\n\nNow the user is showing you an image and asking about it.`
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: userText || 'What do you see in this image?' },
                  {
                    type: 'image_url',
                    image_url: { url: `data:${mimetype};base64,${base64Image}` }
                  }
                ]
              }
            ],
            model: 'meta-llama/llama-4-scout-17b-16e-instruct',
            temperature: 0.7,
            max_tokens: 1024
          });
          
          const aiReply = completion.choices[0]?.message?.content || '❌ Could not analyze image.';
          state[chatId].history.push({ role: 'ai', content: aiReply });
          saveAIMode(state);
          await ctx.reply(`👁️ ${aiReply}`);
          if (shouldReact()) await ctx.react('✅');
        } catch (e) {
          console.error('Vision error in aimode:', e);
          await ctx.reply('❌ Failed to analyze the image.');
          if (shouldReact()) await ctx.react('❌');
        }
        return;
      }
      
      // CASE 2: User wants to generate an image
      if (wantsImageGen && userText) {
        state[chatId].history.push({ role: 'user', content: userText });
        if (shouldReact()) await ctx.react('🎨');
        
        try {
          // Build conversation context for prompt generation
          const conversationContext = state[chatId].history.slice(-20).map(m => 
            `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`
          ).join('\n');
          
          // Ask AI to generate a perfect image prompt based on conversation
          const promptGeneration = await ai.askAI(
            `Based on this conversation, the user wants to generate an image. Create a detailed, descriptive prompt for an AI image generator. Focus on visual details, style, colors, and composition. Only output the image prompt, nothing else.\n\nConversation:\n${conversationContext}\n\nUser's request: ${userText}\n\nImage prompt:`
          );
          
          const imagePrompt = promptGeneration.trim();
          
          // Generate the image using Pollinations
          const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error('Failed to generate image');
          const arrayBuffer = await res.arrayBuffer();
          const imgBuffer = Buffer.from(arrayBuffer);
          
          await ctx._adapter.sendMedia(ctx.chatId, imgBuffer, {
            type: 'image',
            mimetype: 'image/png',
            caption: `🎨 *Generated Image*\n\nPrompt: ${imagePrompt}`
          });
          
          state[chatId].history.push({ role: 'ai', content: `[Generated an image with prompt: ${imagePrompt}]` });
          saveAIMode(state);
          if (shouldReact()) await ctx.react('✅');
        } catch (e) {
          console.error('Image generation error in aimode:', e);
          await ctx.reply('❌ Failed to generate the image. Please try again.');
          if (shouldReact()) await ctx.react('❌');
        }
        return;
      }
      
      // CASE 3: Normal text conversation
      if (userText) {
        state[chatId].history.push({ role: 'user', content: userText });
        const conversation = state[chatId].history.map(m => 
          `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`
        ).join('\n');
        
        if (shouldReact()) await ctx.react('🤔');
        
        let aiReply = '';
        try {
          aiReply = await ai.askAI(conversation);
        } catch (e) {
          aiReply = '❌ AI error.';
        }
        
        state[chatId].history.push({ role: 'ai', content: aiReply });
        saveAIMode(state);
        await ctx.reply(aiReply);
        if (shouldReact()) await ctx.react('✅');
      }
    } catch (e) {
      console.error('AI mode error:', e);
      await ctx.reply('❌ An error occurred.');
      if (shouldReact()) await ctx.react('❌');
    }
  }
};
