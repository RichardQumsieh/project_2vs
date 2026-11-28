import { NativeModules, Platform } from "react-native";

type PendingCallAction = {
  action: string;
  callId: string;
  conversationId: string;
  reply?: string | null;
};

type SophiaCallNative = {
  showIncoming: (callId: string, conversationId: string, mode: string, scope: string) => void;
  showOngoing: (callId: string, conversationId: string) => void;
  showMessage: (conversationId: string, title: string, body: string) => void;
  dismiss: () => void;
  consumePendingAction: () => Promise<PendingCallAction | null>;
  canUseFullScreenIntent: () => Promise<boolean>;
  openFullScreenSettings: () => void;
  enterPictureInPicture: () => void;
};

export function sophiaCall(): SophiaCallNative | null {
  if (Platform.OS !== "android") return null;
  const native = NativeModules.SophiaCall as SophiaCallNative | undefined;
  return native?.showIncoming ? native : null;
}

export async function presentIncomingCall(input: {
  callId: string;
  conversationId: string;
  mode: string;
  scope: string;
  appState: string;
}) {
  if (input.appState === "active") return;
  sophiaCall()?.showIncoming(input.callId, input.conversationId, input.mode, input.scope);
}

export function presentOngoingCall(callId: string, conversationId: string) {
  sophiaCall()?.showOngoing(callId, conversationId);
}

export function dismissCallAlert() {
  try {
    sophiaCall()?.dismiss();
  } catch {
    // The call UI still ends if the native service is unavailable.
  }
}

export function enterCallPictureInPicture() {
  try {
    sophiaCall()?.enterPictureInPicture();
  } catch {
    // Picture-in-picture is optional when the activity cannot enter it.
  }
}
