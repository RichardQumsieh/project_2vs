# Sophia Mobile

Sophia Mobile is an Expo / React Native app for the same Sophia backend as the web client. The primary app surfaces are native: Today and Daily Brief, Cloud Sophia, encrypted inbox list, task planning, Family / Team spaces, and account controls.

The Android build sets API 33 (Android 13) as its minimum OS version, so the install target is Android 13 and newer.

## Start the app

```sh
cd mobile
npm install
npx expo start --dev-client
```

Chat crypto and encrypted SQLite are native modules. Expo Go does not contain them. Link the app to an Expo account once with `npx eas-cli login` (project id is already in `app.json`), then build a phone-installable Android APK:

```sh
npx eas-cli build --profile preview --platform android
```

Install the APK from the EAS build page. For live JavaScript reloads while developing, build the `development` profile and run `npx expo start --dev-client`. EAS can build iOS in the cloud from Windows, but installing an internal iOS build on a phone requires Apple signing credentials and that phone's device registration. Use `--profile production` only for store builds; then `npx eas-cli submit --profile production --platform <android|ios> --latest`. Defaults for `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_SOPHIA_WEB_URL` live in `eas.json`; override with `mobile/.env` when needed. Full credential checklist: Project docs `docs/sophia-mobile-eas-deploy.md`.

Native 1:1 and group chats send the same encrypted payload prefixes as web (`PM1IMG` / `PM1VID` / `PM1AUD` / `PM1FIL` / `PM1ALB` / `PM1RPL`, plus `PM1CALL` for call history). Photos can be taken or chosen and edited on device, short videos include a poster frame, and voice notes are hold-to-record. Swipe left to quote one or more messages in a single reply, and swipe right to delete for you or for everyone. Ciphertext is uploaded via the media API; only sealed envelopes hit the message endpoints.

Voice and video calls use WebRTC (`react-native-webrtc`) over the existing authenticated `/ws` channel. Media is DTLS-SRTP. STUN is built in, and TURN is used when the server has `TURN_URLS` and `TURN_SHARED_SECRET`. This requires a dev-client or EAS build; Expo Go cannot load the native call module. The installable Android APK is `eas build -p android --profile preview`.

## Product architecture

- Native screens call the existing backend directly. Authentication cookies and the SQLCipher database key are stored with Expo SecureStore.
- The native Today surface presents the backend Daily Brief, meetings, mail follow-ups, and task priorities. Ask Sophia uses the backend's existing consent gate and explains which prompt and connected metadata can go to the cloud model.
- Inbox, person lookup, direct and group creation, message history, composer, and conversation sync use native React Native controls.
- One-to-one messages use Sophia's existing X3DH and Double Ratchet implementation. Group conversations use the existing MLS 1.6.4 implementation and cipher suite. These shared protocol modules retain the same message envelopes and backend endpoints as the web client.
- Ratchet sessions, messages, and group state are stored in a SQLCipher database. The database key is protected by the iOS Keychain or Android Keystore through SecureStore; the message vault password is required again when a new app process unlocks messaging.
- Encrypted account history restores direct messages across devices. Decrypted group messages are also encrypted to each member's own account archive key, allowing that member's other devices to restore their group history. A newly registered device still needs an existing group device to add it to the MLS group before it can send new group messages.
- Chat sync polls while a conversation is open and refreshes when the app returns to the foreground. The backend stores only encrypted message payloads and opaque MLS records.

The server's existing account must have completed TOTP setup before mobile sign-in. On first chat use, Sophia asks for the messaging vault password to register or unlock this device and restore account history.

## Store submission gates

This is an early product client, not a store-ready claim. Sophia currently has no backend report/block workflow or in-app account-deletion endpoint. Store review guidance requires apps with user-generated chat to provide safety controls, and Apple requires account deletion for apps that support account creation. Add these backend-backed flows and complete on-device review/testing before submission.
