# Architecture

This bot is organized by responsibility, not by feature sprawl.

## Layer Map

### `src/core`

Runtime and orchestration.

Use this for:

- command registration and execution
- plugin loading
- message context construction
- bot lifecycle

Do not put feature state or WhatsApp business logic here.

### `src/plugins`

User-facing command surfaces.

Use this for:

- command definitions
- command argument parsing
- replies shown to users
- plugin hooks like `onLoad`, `onUnload`, `onMessage`

Plugins should stay thin. They should call into `state`, `domains`, and `utils` instead of owning everything themselves.

### `src/state`

Persistent domain state.

Use this for:

- reading/writing bot data from storage
- state normalization
- migrations from older storage shapes
- domain-specific getters/setters

Examples:

- moderation data
- permissions
- group settings
- stats
- pins
- stateful stores like memory, scheduler, and view-once backups

Rule:

- if the file owns saved bot data, it belongs in `state`

### `src/domains`

Business/domain behavior for a specific surface.

Current main domain:

- `src/domains/whatsapp`

Use this for:

- group operations
- participant resolution
- channel/newsletter logic
- WhatsApp-specific behavior that is too specific for `utils`

Rule:

- if the file encodes how WhatsApp works, it belongs in `domains/whatsapp`

### `src/utils`

Generic reusable helpers.

Use this for:

- storage engine primitives
- JID helpers
- media helpers
- message parsing helpers
- pending action helpers
- validators/loggers and truly generic helpers

Rule:

- if the helper is generic and not domain-owned, it belongs in `utils`

## Design Principles

1. Keep plugins thin.
2. Keep persistence in `state`.
3. Keep WhatsApp behavior in `domains/whatsapp`.
4. Keep generic helpers in `utils`.
5. Avoid top-level ad hoc storage keys from plugins.
6. Reuse existing domain helpers before adding new ones.

## Practical Examples

- store warnings
  - `src/state/moderation.js`

- kick a group participant
  - `src/domains/whatsapp/groupActions.js`

- resolve a replied user or mentioned user
  - `src/domains/whatsapp/groupContext.js`

- normalize a WhatsApp JID
  - `src/utils/whatsappJid.js`

- expose `.warn` or `.ephemeral`
  - plugin file in `src/plugins`

## Data Model Rules

Normal app state goes to:

- `storage/storage.json`

Examples:

- AI mode
- AI cache
- moderation state
- permissions
- stats
- pins
- AFK state

Per-message archive stays separate:

- `storage/messages/`

That archive is intentionally not merged into `storage.json` because it is used for:

- antidelete
- memory recovery
- restart-safe quoted message lookups

## Extension Order

Before touching low-level code, try layers in this order:

1. `ctx` helpers from `MessageContext`
2. `state/*`
3. `domains/whatsapp/*`
4. `utils/*`
5. raw adapter or raw Baileys client only if truly needed

## Legacy Note

Older scattered storage access patterns have been removed.

New code should prefer:

- `src/state/*` for domain state
- `src/utils/storageStore.js` only as the raw storage primitive
