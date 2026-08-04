# Credential handling

This extension requires a Renaiss API key and secret. Do not put either value in source code, `manifest.json`, environment files that are committed, issue comments, or pull requests.

The extension retains credentials only in `chrome.storage.session`. They are cleared when the browser session ends and are not synced through Chrome. Enter them through **API access** in the extension popup after loading the unpacked extension.

If a credential is ever pasted into a chat, terminal transcript, commit, issue, or other shared location, revoke and replace it immediately.
