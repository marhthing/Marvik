import ai from '../utils/ai.js';
import { shouldReact } from '../utils/pendingActions.js';
import fs from 'fs';
import path from 'path';

export default {
  name: 'audio',
  description: 'Speech-to-Text and Text-to-Speech features',
  version: '1.0.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'tts',
      description: 'Convert text to speech',
      usage: 'Reply to a message with .tts or use .tts <text>. Use .tts voice to see available voices. Use .tts <voice> <text> to specify a voice.',
      category: 'audio',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        try {
          const availableVoices = ['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy'];
          let voice = 'hannah'; // Default voice
          let text = ctx.args.join(' ');
          
          if (ctx.args[0] === 'voice') {
            return await ctx.reply(`🎙️ *Available TTS Voices:*\n\n${availableVoices.map(v => `- ${v}`).join('\n')}\n\nUsage: .tts <voice> <text>`);
          }

          // Check if first arg is a voice name
          if (ctx.args.length > 0 && availableVoices.includes(ctx.args[0].toLowerCase())) {
            voice = ctx.args[0].toLowerCase();
            text = ctx.args.slice(1).join(' ');
          }
          
          if (!text && ctx.quoted) {
            text = ctx.quoted.text || ctx.quoted.caption;
          }
          
          // Ensure text is a string
          if (typeof text !== 'string') text = String(text ?? '');
          
          if (!text.trim()) {
            return await ctx.reply('Please provide text or reply to a message.\n\nUsage: .tts Hello world\nOr: .tts austin Hello world');
          }
          
          if (shouldReact()) await ctx.react('🗣️');
          
          const audioBuffer = await ai.textToSpeech(text, voice);

          let oggBuffer = audioBuffer;
          let converted = false;
          let duration = undefined;
          try {
            // Try to convert to OGG/Opus for WhatsApp PTT
            const ffmpegPath = (await import('@ffmpeg-installer/ffmpeg')).path;
            const ffmpeg = (await import('fluent-ffmpeg')).default;
            const tmp = await import('tmp');
            const fs = await import('fs');
            const { promisify } = await import('util');
            const writeFile = promisify(fs.writeFile);
            const readFile = promisify(fs.readFile);
            const unlink = promisify(fs.unlink);
            const tmpIn = tmp.tmpNameSync({ postfix: '.mp3' });
            const tmpOut = tmp.tmpNameSync({ postfix: '.ogg' });
            await writeFile(tmpIn, audioBuffer);
            // Get duration using ffprobe
            duration = await new Promise((resolve) => {
              ffmpeg.ffprobe(tmpIn, (err, data) => {
                if (err || !data || !data.format || !data.format.duration) return resolve(undefined);
                resolve(Math.round(data.format.duration));
              });
            });
            await new Promise((resolve, reject) => {
              ffmpeg(tmpIn)
                .setFfmpegPath(ffmpegPath)
                .audioCodec('libopus')
                .format('ogg')
                .audioBitrate('32k')
                .audioChannels(1)
                .audioFrequency(16000)
                .outputOptions([
                  '-vn',
                  '-compression_level 10',
                  '-frame_duration 60',
                  '-application voip'
                ])
                .save(tmpOut)
                .on('end', resolve)
                .on('error', reject);
            });
            oggBuffer = await readFile(tmpOut);
            converted = true;
            try { await unlink(tmpIn); } catch {}
            try { await unlink(tmpOut); } catch {}
          } catch (e) {
            // If conversion fails, fallback to original buffer
            converted = false;
          }
          await ctx._adapter.sendMedia(ctx.chatId, oggBuffer, {
            type: 'audio',
            mimetype: 'audio/ogg; codecs=opus',
            ptt: true,
            fileName: 'voice.ogg',
            seconds: duration,
            quoted: ctx.messageId
          });
          
          if (shouldReact()) await ctx.react('✅');
        } catch (error) {
          console.error('TTS error:', error);
          await ctx.reply('Failed to convert text to speech. ' + (error.message || ''));
          if (shouldReact()) await ctx.react('❌');
        }
      }
    },
    {
      name: 'stt',
      aliases: ['transcribe'],
      description: 'Convert audio to text',
      usage: 'Reply to an audio/voice note with .stt',
      category: 'audio',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        try {
          const message = ctx.quoted || ctx;
          const mimetype = message.mimetype || message.msg?.mimetype || message.message?.audioMessage?.mimetype;
          const isAudio = mimetype?.includes('audio');
          
          if (!isAudio) {
            return await ctx.reply('Please reply to an audio message or voice note with .stt');
          }
          
          if (shouldReact()) await ctx.react('✍️');
          
          const buffer = await ctx._adapter.downloadMedia({ raw: message.raw || message });
          const transcription = await ai.speechToText(buffer, 'audio.mp3');
          
          if (transcription) {
            await ctx.reply(`📝 *Transcription:*\n\n${transcription}`);
            if (shouldReact()) await ctx.react('✅');
          } else {
            await ctx.reply('Could not transcribe audio.');
            if (shouldReact()) await ctx.react('❌');
          }
        } catch (error) {
          console.error('STT error:', error);
          await ctx.reply('Failed to transcribe audio. ' + (error.message || ''));
          if (shouldReact()) await ctx.react('❌');
        }
      }
    },
    {
      name: 'ask',
      aliases: ['describe', 'explain'],
      description: 'Ask questions about images or describe them using Groq Vision',
      usage: 'Send an image with .ask <question> as caption or reply to an image with .ask <question>',
      category: 'audio',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        try {
          let question = ctx.args.join(' ').trim();
          const message = ctx.quoted || ctx;
          
          // Check for image
          const mimetype = message.mimetype || message.msg?.mimetype || message.message?.imageMessage?.mimetype;
          const isImage = mimetype?.includes('image');
          
          if (!isImage) {
            return await ctx.reply('❌ Please send an image with .ask <question> as caption or reply to an image with .ask <question>');
          }

          if (!question) {
            question = 'What do you see in this image? Please describe it in detail.';
          }

          if (shouldReact()) await ctx.react('👁️');
          
          const buffer = await ctx._adapter.downloadMedia({ raw: message.raw || message });
          
          // Create completion with vision
          const groq = (await import('groq-sdk')).default;
          const client = new groq({ apiKey: process.env.GROQ_API_KEY });
          
          const base64Image = buffer.toString('base64');
          
          const completion = await client.chat.completions.create({
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: question },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${mimetype};base64,${base64Image}`
                    }
                  }
                ]
              }
            ],
            model: 'meta-llama/llama-4-scout-17b-16e-instruct',
            temperature: 0.7,
            max_tokens: 1024
          });

          const response = completion.choices[0]?.message?.content;
          
          if (response) {
            await ctx.reply(`👁️ *Vision Analysis:*\n\n${response}`);
            if (shouldReact()) await ctx.react('✅');
          } else {
            await ctx.reply('❌ Failed to analyze image.');
            if (shouldReact()) await ctx.react('❌');
          }
        } catch (error) {
          console.error('Vision error:', error);
          await ctx.reply('❌ Error processing vision request: ' + (error.message || ''));
          if (shouldReact()) await ctx.react('❌');
        }
      }
    }
  ]
};
