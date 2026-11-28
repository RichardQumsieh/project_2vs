const { AndroidConfig, createRunOncePlugin, withAndroidManifest, withAppBuildGradle, withDangerousMod, withMainApplication } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PERMISSIONS = [
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.USE_FULL_SCREEN_INTENT",
  "android.permission.VIBRATE",
  "android.permission.WAKE_LOCK",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_MICROPHONE",
  "android.permission.FOREGROUND_SERVICE_CAMERA",
];

// Matches expo-notifications' Firebase Messaging artifact so the app module can compile
// SophiaFirebaseMessagingService. The library declares it as implementation, which is not
// visible to app sources.
const FIREBASE_MESSAGING = "com.google.firebase:firebase-messaging:25.0.1";

/**
 * EAS file env vars expose GOOGLE_SERVICES_JSON as a filesystem path.
 * Prefer that path when it exists; otherwise use mobile/google-services.json.
 */
function resolveGoogleServicesPath(projectRoot, env = process.env) {
  const fromEnv = typeof env.GOOGLE_SERVICES_JSON === "string" ? env.GOOGLE_SERVICES_JSON.trim() : "";
  if (fromEnv && fs.existsSync(fromEnv)) {
    return path.resolve(fromEnv);
  }
  return path.join(projectRoot, "google-services.json");
}

function copyNative(config) {
  return withDangerousMod(config, [
    "android",
    (next) => {
      const destination = path.join(
        next.modRequest.platformProjectRoot,
        "app/src/main/java/com/sophia/messenger/call",
      );
      fs.mkdirSync(destination, { recursive: true });
      const source = path.join(next.modRequest.projectRoot, "native/call");
      for (const file of fs.readdirSync(source)) {
        if (!file.endsWith(".kt")) continue;
        fs.copyFileSync(path.join(source, file), path.join(destination, file));
      }
      if (fs.existsSync(resolveGoogleServicesPath(next.modRequest.projectRoot))) {
        const firebase = path.join(next.modRequest.projectRoot, "native/call-firebase/SophiaFirebaseMessagingService.kt");
        if (fs.existsSync(firebase)) fs.copyFileSync(firebase, path.join(destination, "SophiaFirebaseMessagingService.kt"));
      }
      return next;
    },
  ]);
}

function registerPackage(config) {
  return withMainApplication(config, (next) => {
    const contents = next.modResults.contents;
    if (contents.includes("SophiaCallPackage")) return next;
    const anchors = [
      "// add(MyReactNativePackage())",
      "// packages.add(MyReactNativePackage())",
    ];
    const anchor = anchors.find((item) => contents.includes(item));
    if (!anchor) {
      throw new Error("Sophia call plugin could not find the MainApplication package list.");
    }
    next.modResults.contents = contents.replace(
      anchor,
      "add(com.sophia.messenger.call.SophiaCallPackage())",
    );
    return next;
  });
}

function manifest(config) {
  return withAndroidManifest(config, (next) => {
    const manifestRoot = next.modResults.manifest;
    const application = manifestRoot.application?.[0];
    const activity = application?.activity?.find((item) =>
      item.$?.["android:name"] === ".MainActivity",
    );
    if (activity?.$) {
      activity.$["android:showWhenLocked"] = "true";
      activity.$["android:turnScreenOn"] = "true";
      activity.$["android:supportsPictureInPicture"] = "true";
      activity.$["android:resizeableActivity"] = "true";
    }
    application.service = application.service || [];
    if (!application.service.some((item) => item.$?.["android:name"] === ".call.CallForegroundService")) {
      application.service.push({
        $: {
          "android:name": ".call.CallForegroundService",
          "android:exported": "false",
          "android:foregroundServiceType": "shortService|dataSync|microphone|camera",
        },
      });
    }
    if (fs.existsSync(resolveGoogleServicesPath(next.modRequest.projectRoot))) {
      application.service = application.service || [];
      if (!application.service.some((item) => item.$?.["android:name"] === ".call.SophiaFirebaseMessagingService")) {
        application.service.push({
          $: {
            "android:name": ".call.SophiaFirebaseMessagingService",
            "android:exported": "false",
          },
          "intent-filter": [{ action: [{ $: { "android:name": "com.google.firebase.MESSAGING_EVENT" } }] }],
        });
      }
    }
    application.receiver = application.receiver || [];
    if (!application.receiver.some((item) => item.$?.["android:name"] === ".call.CallActionReceiver")) {
      application.receiver.push({
        $: {
          "android:name": ".call.CallActionReceiver",
          "android:exported": "false",
        },
      });
    }
    return next;
  });
}

function withFirebaseMessagingDependency(config) {
  return withAppBuildGradle(config, (next) => {
    if (!fs.existsSync(resolveGoogleServicesPath(next.modRequest.projectRoot))) return next;
    if (next.modResults.contents.includes("com.google.firebase:firebase-messaging")) return next;
    if (next.modResults.language !== "groovy") {
      throw new Error("Sophia call plugin could not add Firebase messaging because app/build.gradle is not Groovy.");
    }
    if (!/dependencies\s*\{/.test(next.modResults.contents)) {
      throw new Error("Sophia call plugin could not find the app dependencies block.");
    }
    next.modResults.contents = next.modResults.contents.replace(
      /dependencies\s*\{/,
      `dependencies {\n    implementation "${FIREBASE_MESSAGING}"`,
    );
    return next;
  });
}

function withCallNotifications(config) {
  config = AndroidConfig.Permissions.withPermissions(config, PERMISSIONS);
  config = manifest(config);
  config = copyNative(config);
  config = registerPackage(config);
  config = withFirebaseMessagingDependency(config);
  const googleServicesFile = resolveGoogleServicesPath(path.resolve(__dirname, ".."));
  if (fs.existsSync(googleServicesFile)) {
    config.android = config.android || {};
    config.android.googleServicesFile = googleServicesFile;
  }
  return config;
}

const plugin = createRunOncePlugin(withCallNotifications, "sophia-call-notifications");
plugin.resolveGoogleServicesPath = resolveGoogleServicesPath;
module.exports = plugin;
