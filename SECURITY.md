# Credential handling

This extension uses a local, loopback-only proxy for authenticated Renaiss API requests. The Chrome extension never receives the Renaiss API key or secret.

Copy `.env.example` to `.env`, add newly issued credentials, and set `RENAISS_ALLOWED_ORIGIN` to the unpacked extension's `chrome-extension://...` origin. `.env` is ignored by Git. Start the proxy with `npm run proxy` before using the extension.

The proxy:

- binds only to `127.0.0.1`
- accepts requests only from the configured extension origin
- injects credentials only into the server-to-server request
- never returns or logs credential values
- forwards only the API routes and methods used by this extension

## Index performance cache

Only the four public One Piece and Pokémon index summary/history responses are cached in proxy memory. Successful responses remain fresh for 15 minutes, may be served stale while one background refresh runs, and are discarded after 24 hours without a successful refresh. The proxy preloads these endpoints at startup and coalesces duplicate requests.

Card identity, certification, FMV, trades, search, and image-identification responses are never cached. Cache entries contain response bodies and non-sensitive metadata only; they never contain authentication headers or environment values.

If a credential is ever pasted into a chat, terminal transcript, commit, issue, or other shared location, revoke and replace it immediately.

The original credentials used during development appeared in repository history and must be considered compromised. Rotate them before creating `.env`. Rewriting Git history alone does not make an exposed credential safe.
