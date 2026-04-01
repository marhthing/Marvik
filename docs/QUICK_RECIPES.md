# Quick Recipes

This file gives practical examples for common tasks.

## Start The Bot

```bash
npm start
```

## Add A New Simple Command

Create `src/plugins/hello.js`:

```js
export default {
  name: 'hello',
  commands: [
    {
      name: 'hello',
      description: 'Say hello',
      usage: '.hello',
      category: 'utility',
      async execute(ctx) {
        await ctx.reply('Hello');
      }
    }
  ]
};
```

The plugin loader will pick it up from `src/plugins/`.

## Add A Command With Saved State

Create state file:

```js
// src/state/notes.js
import { getStorageSection, setStorageSection } from '../utils/storageStore.js';

const SECTION = 'notes';

export function getNotesState() {
  return getStorageSection(SECTION, { byChat: {} });
}

export function saveNotesState(state) {
  return setStorageSection(SECTION, state);
}
```

Create plugin:

```js
// src/plugins/notes.js
import { getNotesState, saveNotesState } from '../state/notes.js';

export default {
  name: 'notes',
  commands: [
    {
      name: 'note',
      usage: '.note <text>',
      category: 'utility',
      async execute(ctx) {
        const text = ctx.args.join(' ').trim();
        if (!text) return ctx.reply('Usage: .note <text>');

        const state = getNotesState();
        state.byChat[ctx.chatId] = text;
        saveNotesState(state);

        await ctx.reply('Saved.');
      }
    }
  ]
};
```

## Add A Group Command

If the command is WhatsApp group-specific:

1. put the command in `src/plugins`
2. use existing group helpers from:
   - `src/domains/whatsapp/groupContext.js`
   - `src/domains/whatsapp/groupActions.js`

Do not hardcode group operation strings if helpers already exist.

## Send A Mention

```js
await ctx.reply('Hello @2347000000000', {
  mentions: ['2347000000000@s.whatsapp.net']
});
```

## Use Shared Reactions

```js
import { reactIfEnabled } from '../utils/pendingActions.js';

await reactIfEnabled(ctx, '⏳');
await reactIfEnabled(ctx, '✅');
await reactIfEnabled(ctx, '❌');
```

## Add A Passive Message Hook

```js
export default {
  name: 'watcher',
  async onMessage(ctx) {
    if (!ctx.text) return;
    if (ctx.text.toLowerCase().includes('hello')) {
      await ctx.reply('Hi');
    }
  }
};
```

Keep `onMessage` hooks fast. They run on every message.

## Access The Raw WhatsApp Client

Prefer higher-level helpers first.

If you really need Baileys:

```js
const client = ctx.platformAdapter?.client;
```

Or from `onLoad(bot)`:

```js
const wa = bot.getAdapter('whatsapp');
const client = wa?.client;
```

## Register A Command-Executed Hook

```js
export default {
  name: 'tracker',
  async onLoad(bot) {
    const unregister = bot.getCommandRegistry().registerCommandExecutedHandler(async ({ messageContext, command }) => {
      // do something
    });

    return () => unregister();
  }
};
```

## Change Config At Runtime

Edit `.env`.

The bot hot-reloads:

- `.env`
- plugin files

If the change affects deep startup-only behavior, restart the bot.
