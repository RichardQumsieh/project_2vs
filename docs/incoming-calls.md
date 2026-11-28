# Incoming calls

Direct and group voice or video calls use the existing WebRTC session and the TURN credentials from `GET /calls/ice-servers`. This layer is how the ring is shown when Sophia is not in front.

## Android

An incoming call posts a full-screen notification (`USE_FULL_SCREEN_INTENT`, category `call`) with the default ringtone and a vibration pattern. Accept and Decline are on that notification. The screen turns on, including the lock screen. Sophia does not request permission to draw over other apps.

While the call continues, a foreground-service notification stays up with Mute and Hang up. Leaving a video call asks the activity for picture-in-picture, and the in-app call can also shrink to a small view.

Android 14 and later require the person to allow full-screen intents. Settings → Notifications explains that and opens the system screen when it is off. Notification permission is requested from that same screen.

A high-priority data message wakes a backgrounded or swiped-away app. The payload has no title. When JavaScript is running, the background task starts the ringing notification. When `google-services.json` was present at prebuild, a small Firebase receiver starts the same notification before JavaScript loads. A force-stopped app cannot be woken until the person opens it again. That is an Android limit.

Answering after a cold start loads the signaling offer from `GET /calls/:callId/invite`. The offer lives in Redis for the ring window (45 seconds) and is only returned to a participant. It is not put in the push payload.

The ringing service uses the `shortService` foreground type. The ongoing call adds microphone and camera only after those permissions are already granted. Sophia is not a phone dialer, so it does not use the `phoneCall` service type.

## Web

A background tab shows a browser notification titled "Incoming call", with Accept and Decline. The open app shows a full-screen ring. Accept on the web answers a direct call after loading the stored offer. Group media is answered in the mobile app.

## Credentials

Android delivery needs `google-services.json` and the FCM V1 key described in `docs/notifications.md`. Web delivery needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.
