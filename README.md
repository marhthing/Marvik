# MATDEV WhatsApp Bot

WhatsApp bot built on Baileys with a modular plugin system.

![MATBOT Logo](./assets/matbot-logo.png)

## Features

- WhatsApp-first command and plugin architecture
- Hot-reload for `.env` and plugin files
- Modular command registry
- Built-in rate limiting, permissions, and media helpers
- Session persistence for Baileys multi-file auth

## Requirements

- Node.js 18+
- A WhatsApp account for pairing

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your env file:

```bash
cp .env.example .env
```

3. Configure `.env`:

```env
BOT_NAME=MATDEV
PREFIX=.
OWNER_NUMBER=1234567890
ENABLE_WHATSAPP=true
LOG_LEVEL=info
```

4. Start the bot:

```bash
npm start
```

## WhatsApp Pairing

On first start, the bot will ask whether to pair with:

- QR code
- 8-digit pairing code

Session data is stored in `session/whatsapp/`.

## Plugin Basics

Plugins live in `src/plugins/` and export an object:

```js
export default {
  name: 'my-plugin',
  commands: [
    {
      name: 'hello',
      async execute(ctx) {
        await ctx.reply('Hello');
      }
    }
  ]
};
```

## Message Context

Plugins receive `ctx` with fields such as:

- `ctx.platform`
- `ctx.text`
- `ctx.command`
- `ctx.args`
- `ctx.senderId`
- `ctx.senderName`
- `ctx.chatId`
- `ctx.isGroup`
- `ctx.isOwner`
- `ctx.isAdmin`
- `ctx.media`
- `ctx.quoted`
- `ctx.mentions`

Common helpers:

- `await ctx.reply(text, options)`
- `await ctx.send(text, options)`
- `await ctx.react(emoji)`
- `await ctx.delete()`
- `await ctx.sendMedia(buffer, { type: 'image' })`
- `await ctx.downloadMedia()`
- `await ctx.presence('composing')`
- `await ctx.read()`

## Structure

```text
src/
  adapters/
    BaseAdapter.js
    WhatsAppAdapter.js
  core/
    Bot.js
    CommandRegistry.js
    MessageContext.js
    PluginLoader.js
  plugins/
  utils/
```

## Troubleshooting

- If commands do not run, confirm `OWNER_NUMBER`, `PREFIX`, and plugin load logs.
- If pairing fails repeatedly, clear `session/whatsapp/` and pair again.
- If media commands fail, verify the quoted/original media is still available from WhatsApp.
