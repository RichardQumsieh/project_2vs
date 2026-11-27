const { AndroidConfig, createRunOncePlugin, withInfoPlist } = require("@expo/config-plugins");

const CAMERA = "Sophia uses the camera so you can take photos, record videos, and join encrypted video calls.";
const MICROPHONE = "Sophia uses the microphone so you can record voice messages and join encrypted voice and video calls.";

function withWebRtc(config) {
  config = withInfoPlist(config, (next) => {
    next.modResults.NSCameraUsageDescription = next.modResults.NSCameraUsageDescription || CAMERA;
    next.modResults.NSMicrophoneUsageDescription = next.modResults.NSMicrophoneUsageDescription || MICROPHONE;
    return next;
  });
  return AndroidConfig.Permissions.withPermissions(config, [
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.BLUETOOTH_CONNECT",
  ]);
}

module.exports = createRunOncePlugin(withWebRtc, "sophia-webrtc");
