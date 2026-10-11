# OpenChamber Providers

> A focused provider manager for OpenCode, built as an OpenChamber extension.

[![OpenChamber](https://img.shields.io/badge/OpenChamber-extension-66800b)](https://openchamber.dev)
[![OpenCode](https://img.shields.io/badge/OpenCode-provider%20manager-555)](https://opencode.ai)
[![License](https://img.shields.io/github/license/leoporoluo/openchamber-providers)](LICENSE)

An [OpenChamber](https://openchamber.dev) extension that manages custom
OpenAI-compatible providers for OpenCode from a panel on the right-hand rail.

OpenChamber Providers writes the `providers` block of `~/.config/opencode/opencode.jsonc`
(or `opencode.json`) directly, so OpenCode reloads it on its own and the
provider shows up in **Settings → Providers** — including its models, context
length and reasoning levels. It edits only that block: comments, formatting and
every unrelated setting in the file stay exactly as they were.

## Why OpenChamber Providers?

OpenCode supports many providers, gateways and local runtimes, but maintaining
custom provider definitions by hand can be error-prone. OpenChamber Providers provides a small,
focused UI for managing those definitions without taking over the rest of your
OpenCode configuration.

## Features

- Add, edit and delete custom providers (第三方中转站 / gateways / local runtimes)
- Provider name, provider ID, protocol, base URL and API key
- Models with display name, context length, max output and reasoning levels
- Reasoning levels as clickable cards — `low`, `medium`, `high`, `xhigh`, `max`,
  all off for a model that does not reason; new models start with
  `low, medium, high` on
- Per-model capabilities: image input (vision) and tool calling, written to `capabilities`
- Refresh button re-reads the config without reopening the panel
- Saving merges with the block already on disk, so provider headers, `env`
  entries and per-model fields OpenChamber Providers does not edit are preserved
- Writes plain provider config — no OAuth, no background service, no network calls
- Panel follows the OpenChamber theme and can also open full-screen

## Install

In OpenChamber: **Settings → Extensions → Folder, ZIP or URL**, paste:

```
https://github.com/leoporoluo/openchamber-providers.git
```

then choose **Add** and approve the filesystem permission (it may read and
write `~/.config/opencode/opencode.json`). The OpenChamber Providers icon appears on the rail.

Install from a local clone instead:

```
git clone https://github.com/leoporoluo/openchamber-providers.git
```

and paste the absolute path of the cloned folder into the same field.

## Usage

1. Open the OpenChamber Providers panel on the rail (or **Extension pages → OpenChamber Providers** for full screen).
2. Choose **Add provider**.
3. Fill in the provider ID (e.g. `zero`), display name, protocol, base URL and API key.
4. Add at least one model: ID, display name, context length, max output,
   reasoning levels and whether it accepts images and calls tools.
   Context length and max output can be left blank: the placeholder shows the
   default (`272000` / `128000`) and that value is written to the config.
   Reasoning levels are cards — click to switch a level on, click again to
   switch it off. A new model starts with **low, medium, high** on; leaving
   every card off means the model declares no reasoning levels.
5. Choose **Save**. The provider is written to `opencode.json` and appears under
   **Settings → Providers** in OpenChamber.

Editing and deleting work the same way; deleting removes the block from the
config file and disconnects the provider. **Refresh** re-reads the file when
something changed outside the panel.

The API key is written to `settings.apiKey` as plain text. To keep the secret
out of the file, set the key in an environment variable and enter
`{env:VAR_NAME}` instead.

## Security and permissions

OpenChamber Providers does not make network requests, start a background service, or send
prompts to an agent. It only reads and updates the OpenCode configuration files
listed in its OpenChamber permission request. Unrelated configuration,
comments and formatting are preserved.

For credentials, prefer an environment reference such as
`{env:OPENAI_API_KEY}` instead of storing an API key directly in the config.

## Compatibility

- OpenChamber 2.0.0 or newer
- OpenCode 2.x configuration format
- Web and Desktop OpenChamber clients

## For OpenChamber users

OpenChamber Providers can be installed directly from:

```text
https://github.com/leoporoluo/openchamber-providers.git
```

The extension is also available for consideration in the
[OpenChamber Extensions directory](https://openchamber.dev/extensions/).

## Development

```bash
npm install
npm run build      # bundle panel/main.ts -> panel/main.js (IIFE)
npm run build:dev  # same, unminified
npm run typecheck
```

OpenChamber never builds an extension on install, so commit the built
`panel/main.js` together with the sources. To ship an update, bump `version` in
`package.json`, rebuild, commit and push; the Extensions page then offers
**Update**.

## Layout

```
package.json       extension manifest (openchamber block) + build scripts
icon.svg           rail icon, masked in the current text color
panel/index.html   panel page + reasoning-card styles
panel/main.ts      panel UI, host wiring and file i/o
panel/jsonc.ts     JSONC parse + comment-preserving top-level edits
panel/providers.ts provider drafts <-> opencode.json blocks (pure, testable)
panel/levels.ts    reasoning-level cards (click to enable, click to disable)
panel/main.js      built panel (committed)
```

## License

MIT
