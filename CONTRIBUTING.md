# Contributing

This bot is maintainable because the architecture is enforced. New contributions should preserve that.

## Ownership Policy

This repository is source-available and protected by the rights notice in:

- [LICENSE](./LICENSE)
- [NOTICE.md](./NOTICE.md)

Contributions are welcome through GitHub forks and pull requests.

By contributing, you agree that:

- the original project ownership and branding remain with the author
- your contribution is submitted for inclusion in this project
- you will not remove or rewrite ownership notices in the course of contribution

## Before You Change Code

Read these first:

- [README.md](./README.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/RUNTIME_REFERENCE.md](./docs/RUNTIME_REFERENCE.md)
- [docs/PLUGIN_GUIDE.md](./docs/PLUGIN_GUIDE.md)

## Ground Rules

- keep plugins thin
- keep saved state in `src/state`
- keep WhatsApp-specific behavior in `src/domains/whatsapp`
- keep generic helpers in `src/utils`
- do not add raw plugin-owned JSON files for app state
- do not duplicate existing helpers when one already exists

## Good Contribution Flow

1. identify the correct layer
2. check whether the helper/state/domain already exists
3. implement the smallest coherent change
4. validate syntax and affected behavior
5. update docs if the public surface changed

## If You Add A Plugin

You usually need:

1. plugin file in `src/plugins`
2. state file in `src/state` if the feature saves data
3. WhatsApp domain helper in `src/domains/whatsapp` if the behavior is WhatsApp-specific

See:

- [docs/PLUGIN_GUIDE.md](./docs/PLUGIN_GUIDE.md)

## If You Add Saved State

Do not:

- write a new `storage/*.json` file for normal state
- patch `storage.json` directly from plugin code

Do:

- create `src/state/<domain>.js`
- normalize and migrate data there
- use `src/utils/storageStore.js`

## Validation

At minimum, run syntax checks for files you changed:

```bash
node --check src/path/to/file.js
```

If you touch multiple files:

```bash
node --check src/file1.js
node --check src/file2.js
```

## Logging

Use:

- `src/utils/logger.js` for runtime logging
- `src/utils/bootstrapLogger.js` for bootstrap/manager logging

Do not scatter raw `console.*` in runtime code.

## Reactions

Use shared helpers from:

- `src/utils/pendingActions.js`

Do not repeat ad hoc reaction gating in each plugin.

## Storage Rule

There is one main bot state system:

- `storage/storage.json`

The only major intentional exception is:

- `storage/messages/`

That is a message archive, not normal app state.

## Docs

If you change:

- config variables
- public commands
- plugin development flow
- runtime extension points

update the relevant docs under `docs/`.

If you add or change commands, regenerate the command reference:

```bash
npm run docs:commands
```
