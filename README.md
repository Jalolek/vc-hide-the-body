# HideTheBody

A Vencord userplugin that adds Discord style confirmation gates in front of
channels, servers, guild folders, voice channels, calls and messages, so
sensitive content stays hidden until you explicitly confirm you want to see or
send it.

The gates mimic the native "Age Restricted Content" experience: a solid
opaque screen with a `View` and a `Cancel` button. Nothing behind the gate is
visible and nothing can slip through while it is up.

## Features

- View gate: an opaque overlay blocks a channel before it opens. Clicking a
  gated channel in the sidebar is stopped up front, so the channel is never
  navigated to, and no content flashes behind the gate.
- Whole server gate: gate an entire server. The overlay covers the channel
  list, chat, member list and the message composer until you confirm.
- Guild folder gate: gate every server inside a Discord guild folder at once.
- Send gate: sending in a gated channel requires confirmation. A channel
  gated for viewing is also gated for sending.
- Voice and call gates: confirm before joining a voice channel or starting a
  call.
- DM gate: optionally confirm before opening or sending in direct messages.
- Composer lock: while a gate overlay is up the message composer is covered,
  blurred, cannot be focused, Enter is swallowed, and any send is cancelled.
- Context menus and channel settings keep working. Right-clicking a gated
  channel no longer selects or reveals it, but the context menu still opens
  so you can reach `Edit Channel` and other settings.
- Gated channels are marked with a red warning icon in the channel list.

## How gating works

- Sidebar clicks on gated channels are intercepted before Discord handles
  them, so the channel never opens.
- If a gated channel is reached another way (keyboard, notification, link),
  the gate appears and you are returned to the last channel you were in that
  was not gated.
- Cancelling a gate never leaves you in a gated channel.
- View confirmations are one-shot. They apply to the current visit and expire
  after a short window, so returning later asks again.

## Settings

All settings live under `Settings > Plugins > HideTheBody`.

| Setting | Description |
| --- | --- |
| Enable all gates | Master switch for every gate. |
| Confirm before viewing gated channels | Master switch for the view gate. |
| `viewChannels` / `viewGuilds` / `viewFolders` | Channel IDs, server IDs and guild folder IDs that require confirmation to view. |
| Confirm before sending in gated channels | Master switch for the send gate. |
| `sendChannels` / `sendGuilds` / `sendFolders` | Channel IDs, server IDs and guild folder IDs that require confirmation to send. |
| Confirm before opening or sending in ALL DMs | Gate every direct message. Individual DMs can still be gated by channel ID. |
| Confirm before joining a voice channel | Gate voice channels. |
| Confirm before starting calls | Gate calls. |
| Quick controls | Buttons to gate the current channel, server or folder and to remove gates without copying IDs. |

The ID lists accept values separated by commas, spaces or newlines.

## Installation

### As a Vencord userplugin

1. Clone or download this repository.
2. Copy the plugin folder into your Vencord checkout under
   `src/userplugins/vc-hide-the-body`, so that `index.tsx` sits directly in
   that folder.
3. Build and inject Vencord:

```bash
pnpm build
pnpm inject
```

4. Fully quit Discord (including the tray icon) and relaunch it.

The plugin then appears under `Settings > Plugins > HideTheBody`.

## Building from source

The plugin is plain TypeScript and CSS that runs inside Vencord, so it builds
as part of Vencord itself. There is no separate bundler or package to install
for this repository.

```bash
pnpm build
pnpm inject
```

## Files

| File | Purpose |
| --- | --- |
| `index.tsx` | Plugin entry point, gate overlays, click and selection blocking, send, voice and call gates. |
| `gates.ts` | Gating logic: channel, server, folder and DM checks. |
| `settings.tsx` | Settings definition and the quick controls panel. |
| `styles.css` | Styling for the settings panel and gate overlay. |

## Notes

- This is an unofficial plugin and is not affiliated with or endorsed by
  Discord or the Vencord project.
- The plugin only changes what is displayed and confirmed inside your own
  Discord client. It does not send, store or transmit any data anywhere.
- Gating is a client side guard, not access control. It keeps the UI honest
  and avoids accidental exposure; it is not a substitute for Discord's own
  permission model.

## License

Licensed under the GNU General Public License v3.0 or later
(`GPL-3.0-or-later`). See the SPDX headers in the source files.
