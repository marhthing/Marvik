import { buildForwardPayload, getOwnerJid } from '../utils/messageUtils.js';
import { getStorageSection, patchStorageSection } from '../utils/storageStore.js';
import { applyDestinationCommand, normalizeDestinationConfig, resolveDestinationJid } from '../utils/destinationRouter.js';

function getSaveConfig() {
  return normalizeDestinationConfig(getStorageSection('save', { dest: 'owner', jid: null }));
}

function setSaveConfig(newConfig) {
  return patchStorageSection('save', newConfig, { dest: 'owner', jid: null });
}

/**
 * Save Plugin
 * Forwards any quoted message or current message to the owner or custom JID
 */
const SavePlugin = {
  name: 'save',
  description: 'Forward messages to owner or custom JID',
  category: 'utility',

  commands: [
    {
      name: 'save',
      description: 'Forward message to owner or custom JID',
      usage: '.save (reply to a message) | .save <jid|g|p>',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        try {
          const arg = ctx.args[0]?.toLowerCase();
          if (arg && !ctx.quoted) {
            const response = applyDestinationCommand(arg, setSaveConfig, {
              group: 'Save will now forward to the same chat.',
              owner: 'Save will now forward to the owner.',
              custom: 'Save will now forward to JID: %s'
            });
            if (response) {
              await ctx.reply(response);
              return;
            }
            await ctx.reply('Invalid argument. Usage: .save <jid|g|p> or reply to a message.');
            return;
          }

          const conf = getSaveConfig();
          const destJid = resolveDestinationJid(ctx, conf, getOwnerJid(ctx));

          await ctx.platformAdapter.client.sendMessage(destJid, {
            forward: buildForwardPayload(ctx)
          });
        } catch (error) {
          console.error(`Error in .save command: ${error.message}`);
        }
      }
    }
  ]
};

export default SavePlugin;
