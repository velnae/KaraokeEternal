# Development HTTPS at karaoke.puyu.pe

**Outcome**: `https://karaoke.puyu.pe` reaches the existing development server at `http://127.0.0.1:3000` through a dedicated Cloudflare Tunnel. Use the HTTPS address for administrator, player and guest links so the YouTube iframe has a secure parent context.

## Quick path

1. Keep `npm run dev` running in the project. The tunnel does not launch the application.
2. Open `https://karaoke.puyu.pe`, sign in and open the player from that origin. Close an older player tab first to release the room's player slot.
3. The QR now derives the public HTTPS hostname. Previously FAILED songs must be added again; changing origin does not reset queue history.

## Tunnel configuration

| Item | Value |
| --- | --- |
| Name | `karaoke-eternal-dev` |
| UUID | `27380612-da7d-4437-b2c7-efe4843d75f9` |
| DNS | `karaoke.puyu.pe` routed to this tunnel by `cloudflared tunnel route dns` |
| Origin | `http://127.0.0.1:3000` |
| Config | `~/.cloudflared/config-karaoke-eternal-dev.yml` |
| Service | `~/.config/systemd/user/karaoke-eternal-tunnel.service` |
| Credentials | UUID-named JSON under `~/.cloudflared`, owner-read-only; never stored in the repository |

Ingress has one exact hostname rule and a final `http_status:404` fallback. The user service is enabled under `default.target`, uses `Restart=on-failure`, and does not require a terminal to remain open. Its lifetime follows the user manager; no system-wide installation or linger setting was changed.

```sh
systemctl --user status karaoke-eternal-tunnel.service
systemctl --user restart karaoke-eternal-tunnel.service
journalctl --user -u karaoke-eternal-tunnel.service -f
```

Stop publication with `systemctl --user disable --now karaoke-eternal-tunnel.service`. DNS remains until explicitly removed. The existing WhatsApp/Conversa tunnel is independent and was not changed.

## Authorization

The existing connector's token only authorized that tunnel. A one-time `cloudflared tunnel login` browser authorization was needed for account-level tunnel/DNS operations. After the user authorized `puyu.pe`, creation, validation, DNS routing and startup were performed through CLI tools. Certificate/token contents were never read or exposed.

## Development cache correction

Initial public JS/CSS responses were Cloudflare `HIT` with `max-age=14400`, which would serve stale development builds.

- Development responses now carry `Cache-Control: no-store` and `Cloudflare-CDN-Cache-Control: no-store`.
- JS/CSS use build-hashed filenames in development as well as production. New entry paths avoid existing cached fixed-name assets.
- The SPA index middleware reads the current compilation's HTML on each request. The async webpack completion hook updates it after every rebuild; otherwise hashed filenames would leave the initial HTML pointing to removed assets.
- Production retains its prior hashed filenames and cache behavior; only development gets the no-store middleware.

Code: `server/lib/clientAssets.ts`, `server/lib/clientAssets.test.ts`, `server/serverWorker.ts`, `config/webpack.config.js`.

## Verification on 2026-10-09

- Tunnel configuration and systemd unit validation passed; service active/enabled with four registered QUIC connections and local readiness reporting four connections.
- Public HTTPS, login/guest UI, `/api/rooms` and `/api/prefs` returned 200. No application accounts or live queue entries were created by verification.
- Native WSS received the Engine.IO handshake, without connecting an authenticated Socket.IO room. Webpack HMR's SSE endpoint returned 200 and streamed data.
- Browser reported `isSecureContext=true` and protected-media API availability. Isolated real YouTube probes under the public HTTPS origin started `1IgOZaQqB58`, `ue0RP3C1Brg` and `U5TiuzOkJEY` and advanced past one second, with secure iframe context. Playback was muted and did not connect to the application's room/player.
- After the cache correction, both repeated HEAD requests for each generated JS/CSS entry returned 200, `Cache-Control: no-store`, Cloudflare `BYPASS` and no `Age` header. WSS and HMR still worked.
- Regression tests cover fresh index HTML after rebuild, base paths, exclusion of API/assets, downstream cache-header replacement and streaming responses. Final suite: **207/207 passed in 28 files**; scoped ESLint, server TypeScript and `git diff --check` passed.

## DNS and URL notes

DNS propagation was briefly inconsistent: the Wi-Fi primary resolver and Google/Cloudflare returned the new records while the secondary resolver still returned NXDOMAIN. Both configured Wi-Fi resolvers later returned the correct addresses. No persistent DNS/network configuration was changed. A network-only query (`resolvectl --cache=no query karaoke.puyu.pe`) refreshed the local result during diagnosis.

Use **HTTPS explicitly**. Cloudflare also currently serves HTTP for this hostname; an HTTP-to-HTTPS redirect rule was not configured globally or on other hostnames. HTTPS is what enables protected-media playback and gives phones a usable shared QR address.

## Delivery

Tunnel/service configuration is installed locally outside the repository. Application cache changes, this evidence document and the prior secure-context diagnosis are delivered together in the development-cache fix commit. No push was requested. The diagnosis remains in `youtube-secure-context-diagnosis.md`.
