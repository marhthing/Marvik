export default {
  name: 'gif',
  description: 'Send a random GIF or search for GIFs',
  version: '1.0.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'gif',
      aliases: [],
      description: 'Send a random GIF or search for a GIF by keyword',
      usage: '.gif [search]',
      category: 'fun',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 5,
      async execute(ctx) {
        const search = ctx.args.join(' ');
        // Use free public API keys for Giphy and Tenor
        const giphyApiKey = 'GlVGYHkr3WSBnllca54iNt0yFbjz7L65';
        const tenorApiKey = 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ';
        let url = 'https://media.giphy.com/media/ICOgUNjpvO0PC/giphy.gif';
        let found = false;
        let isMp4 = false;
        if (search) {
          // Try Giphy first
          try {
            const res = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${giphyApiKey}&q=${encodeURIComponent(search)}&limit=1`);
            const data = await res.json();
            if (data.data && data.data.length > 0) {
              // Prefer MP4 for WhatsApp
              url = data.data[0].images.original.mp4 || data.data[0].images.original.url;
              isMp4 = !!data.data[0].images.original.mp4;
              found = true;
            }
          } catch (e) {}
          // If not found, try Tenor
          if (!found) {
            try {
              const res = await fetch(`https://tenor.googleapis.com/v2/search?key=${tenorApiKey}&q=${encodeURIComponent(search)}&limit=1&media_filter=gif`);
              const data = await res.json();
              if (data.results && data.results.length > 0) {
                // Prefer MP4 for WhatsApp
                url = data.results[0].media_formats.mp4?.url || data.results[0].media_formats.gif?.url || url;
                isMp4 = !!data.results[0].media_formats.mp4?.url;
                found = true;
              }
            } catch (e) {}
          }
          if (!found) return await ctx.reply('❌ No GIF found for that search.');
        }
        // Download the GIF/MP4 and send as video with gifPlayback
        try {
          const response = await fetch(url);
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          if (isMp4) {
            await ctx._adapter.sendMedia(ctx.chatId, buffer, { type: 'video', mimetype: 'video/mp4', gifPlayback: true });
          } else {
            await ctx._adapter.sendMedia(ctx.chatId, buffer, { type: 'image', mimetype: 'image/gif' });
          }
        } catch (e) {
          await ctx.reply(url); // fallback to link if download fails
        }
      }
    }
  ]
};

