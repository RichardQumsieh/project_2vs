# Message notifications

Push payloads carry a conversation id and a sender id. Call alerts also carry a call id, mode, and scope. The server never sends message text, display names, or media. The visible template is the constant "New message".

A device may show a sender name and a short preview only after it decrypts the message locally, and only when **Hide sender names and previews** is off. That setting defaults to on. The open chat is not notified. Muted chats are skipped until the mute time passes, or forever when no time is set. Badges count messages, stop at 99, and clear when the app opens.

Tapping a notification opens the chat after the messaging vault is unlocked. A quick reply is kept on the device and placed in the composer. It is not sent from the notification shade.

## Web push

Set all three, or leave all three empty:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (`mailto:` address or `https://` URL)

Generate a pair with `npx web-push generate-vapid-keys`. The browser reads the public key from `GET /notifications/settings`. The service worker is `frontend/public/sw.js`.

## Android and iOS

The app registers an Expo push token. Delivery uses Expo's push service, which uses Firebase Cloud Messaging on Android.

Upload these in EAS. Do not commit them:

- `google-services.json` from the Firebase Android app. Place it at `mobile/google-services.json` for a local prebuild. It is gitignored. Prebuild still succeeds when the file is absent, and push will not be delivered until it exists.
- The FCM V1 service account key, through `eas credentials`. It is not an environment variable in this repo.

The Expo project id is the `extra.eas.projectId` already in `mobile/app.json`.

## Credentials the owner sets

Names only: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, plus the FCM files above. Theme generation reuses `SOPHIA_MODEL_API_KEY`, `SOPHIA_MODEL_BASE_URL`, and `SOPHIA_MODEL_NAME`.
