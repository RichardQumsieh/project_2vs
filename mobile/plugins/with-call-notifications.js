const { AndroidConfig, createRunOncePlugin, withAndroidManifest, withDangerousMod, withMainApplication } = require("@expo/config-plugins");
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

function googleServicesPath(projectRoot) {
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
      if (fs.existsSync(googleServicesPath(next.modRequest.projectRoot))) {
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
    if (fs.existsSync(googleServicesPath(path.resolve(__dirname, "..")))) {
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

function withCallNotifications(config) {
  config = AndroidConfig.Permissions.withPermissions(config, PERMISSIONS);
  config = manifest(config);
  config = copyNative(config);
  config = registerPackage(config);
  if (fs.existsSync(googleServicesPath(path.resolve(__dirname, "..")))) {
    config.android = config.android || {};
    config.android.googleServicesFile = "./google-services.json";
  }
  return config;
}

module.exports = createRunOncePlugin(withCallNotifications, "sophia-call-notifications");
