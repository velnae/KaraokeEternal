# Karaoke Eternal

Host awesome karaoke parties where everyone can easily find and queue songs from their phone's browser. The player is also fully browser-based with support for MP3+G, MP4 videos and WebGL visualizations. The server is self-hosted and runs on nearly everything.

[![Karaoke Eternal](/docs/assets/images/README.jpg?raw=true)](/docs/assets/images/README.jpg?raw=true)

<p align="center">
  <i>App in mobile browser (top) controlling player in desktop browser (bottom)</i>
</p>

## Features

- Plays:
  - MP3+G (MP3 with CDG lyrics; including zipped)
  - MP4 videos
  - Music-synced visualizations (with automatic lyrics background removal)
- Fast, modern mobile browser app designed for "karaoke conditions"
- Easy joining with QR codes and guest accounts
- Fixed table QR codes with optional or strict singer admission ([operator guide](docs/TABLE-QR.md))
- Multiple simultaneous rooms/queues (optionally password-protected)
- Dynamic queues keep parties fair, fun and no-fuss
- Fully self-hosted
- No ads or telemetry

Microphones are *not* required since the player itself only outputs music - this allows your audio setup to be as simple or complex as you like. See the [F.A.Q.](https://www.karaoke-eternal.com/faq/#recommended-audio-microphone-setup) for more information.

## Getting Started

 Karaoke Eternal basically has 3 parts. See [Getting Started](https://www.karaoke-eternal.com/docs/getting-started/) to get up and running step-by-step, or jump to the documentation for each part below:
 
- **[Server:](https://www.karaoke-eternal.com/docs/karaoke-eternal-server/)** Runs on pretty much anything to serve the web app and your media files, including a Windows PC, Mac, or a dedicated server like a Raspberry Pi or Synology NAS.
- **[App:](https://www.karaoke-eternal.com/docs/karaoke-eternal-app/)** Fast, modern mobile web app designed for "karaoke conditions".
- **[Player:](https://www.karaoke-eternal.com/docs/karaoke-eternal-app/#player)** Just another part of the app, but meant to run fullscreen on the system handling audio/video for a [room](https://www.karaoke-eternal.com/docs/karaoke-eternal-app/#rooms-admin-only)

## Installation

There are several [installation methods](https://www.karaoke-eternal.com/docs/karaoke-eternal-server/#installation) available for Karaoke Eternal Server.

## Client branding

Each installation can display one client's identity on the login and guest entry
screen. **About** displays only the software identity, version, credits, and
licenses. Initial setup retains Karaoke Eternal branding.

1. Sign in as an administrator and open **Account → Preferences → Client branding**
   (in the Spanish UI: **Cuenta → Preferencias → Marca del cliente**).
   The **Marca del cliente** administration shortcut links directly to
   `/account#admin-branding`; the editor is always visible.
2. Enter the client name, choose an optional PNG/JPEG logo (up to 5 MB), and enter
   an optional HTTPS support URL. Check the preview.
3. Select **Guardar cambios**. Changes are persisted in the existing preferences
   database and sent to connected clients; no rebuild or restart is needed.

The browser converts logos to PNG, preserving transparency and aspect ratio,
with a maximum size of 640 × 640 pixels and 256 KB. The stored image is included
in the branding preference, so the normal database backup includes it.

The login always displays the neon **Karaoke** wordmark. The configured client
name replaces **Eternal** on the second neon line. An optional logo appears
above **Karaoke**, with the complete group centered. The editor preview
uses the same layout. Long names are truncated visually, with the full name
available in the wordmark's accessible label and tooltip.

Leave the name empty to retain **Karaoke Eternal**. An omitted or failed image
keeps the two-line wordmark centered. **Quitar logo** removes only the image;
**Usar marca del software** clears all client branding. Both require saving.
Use **Descartar** to restore the last saved values without changing the live brand.

Client branding is public before login. Do not enter private information in
these fields. Only administrators can update it through `PUT /api/prefs/branding`;
after initial setup, non-admin responses from `GET /api/prefs` contain only roles
and branding. Existing installations default to the software identity.

## Discord & Support

Join the [Karaoke Eternal Discord Server](https://discord.gg/PgqVtFq) for general support and development chat, or just to say hi!

## Contributing & Development

Contributions are welcome! Please join the `#dev` channel of the [Discord Server](https://discord.gg/PgqVtFq) before embarking on major features; the project's scope is limited to ensure success.

Make sure you have [Node.js](https://nodejs.org/en/) v24 or later, then:

1. Fork and clone the repo
2. `npm i`
3. `npm run dev` and look for "Web server running at" for the **server URL**
