export type PendingLocationShare = {
  lat: number;
  lon: number;
  accuracy?: number;
  altitude?: number;
  sharedAt: string;
};

export const GEOLOCATION_PERMISSION_DENIED = 1;
export const GEOLOCATION_POSITION_UNAVAILABLE = 2;
export const GEOLOCATION_TIMEOUT = 3;

export type GeolocationPermissionState =
  | "granted"
  | "denied"
  | "prompt"
  | "unknown";

export type BrowserLocationFix = {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  timestamp: number;
};

export type LocationReadDeps = {
  secureContext: boolean;
  supported: boolean;
  readPosition: (options?: PositionOptions) => Promise<BrowserLocationFix>;
  queryPermission: () => Promise<GeolocationPermissionState>;
  wait?: (ms: number) => Promise<void>;
};

const deniedMessage =
  "Location permission was denied. Enable it in the browser to share.";
const grantedBlockedMessage =
  "Location permission is granted, but the browser could not read it. Try again.";
const insecureMessage =
  "Location sharing needs a secure HTTPS page. Open Sophia over HTTPS, then try again.";
const unsupportedMessage = "This browser cannot share location.";
const promptMessage = "Allow location for this site, then try again.";
const unavailableMessage = "Location is unavailable right now.";
const timeoutMessage = "Timed out while reading your location.";
const genericMessage = "Could not read your location.";

export function roundCoordinate(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatCoordinate(value: number, digits = 5) {
  return value.toFixed(digits);
}

export function buildExternalMapsUrl(lat: number, lon: number) {
  const latitude = roundCoordinate(lat);
  const longitude = roundCoordinate(lon);
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
}

export function describeLocationAccuracy(accuracyMeters?: number) {
  if (typeof accuracyMeters !== "number" || !Number.isFinite(accuracyMeters)) {
    return null;
  }
  if (accuracyMeters < 1) {
    return "Accurate to under 1 m";
  }
  if (accuracyMeters < 1000) {
    return `Accurate to about ${Math.round(accuracyMeters)} m`;
  }
  return `Accurate to about ${(accuracyMeters / 1000).toFixed(1)} km`;
}

export function locationErrorMessage(input: {
  secureContext: boolean;
  permission: GeolocationPermissionState;
  code: number | null;
}) {
  if (!input.secureContext) {
    return insecureMessage;
  }
  if (input.code === GEOLOCATION_POSITION_UNAVAILABLE) {
    return unavailableMessage;
  }
  if (input.code === GEOLOCATION_TIMEOUT) {
    return timeoutMessage;
  }
  if (input.code === GEOLOCATION_PERMISSION_DENIED) {
    if (input.permission === "granted") {
      return grantedBlockedMessage;
    }
    if (input.permission === "denied") {
      return deniedMessage;
    }
    return promptMessage;
  }
  return genericMessage;
}

export function shouldRetryLocationRead(input: {
  code: number;
  permissionBefore: GeolocationPermissionState;
  permissionAfter: GeolocationPermissionState;
}) {
  if (input.code !== GEOLOCATION_PERMISSION_DENIED) {
    return false;
  }
  return (
    input.permissionAfter === "granted" || input.permissionBefore === "granted"
  );
}

function positionErrorCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "number"
  ) {
    return error.code;
  }
  return null;
}

function shareFromFix(position: BrowserLocationFix): PendingLocationShare {
  const { latitude, longitude, accuracy, altitude, timestamp } = position;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("The device returned an invalid location.");
  }
  return {
    lat: roundCoordinate(latitude),
    lon: roundCoordinate(longitude),
    ...(Number.isFinite(accuracy) && accuracy > 0
      ? { accuracy: Math.min(accuracy, 100_000) }
      : {}),
    ...(typeof altitude === "number" &&
    Number.isFinite(altitude) &&
    altitude >= -12_000 &&
    altitude <= 100_000
      ? { altitude }
      : {}),
    sharedAt: new Date(timestamp || Date.now()).toISOString(),
  };
}

export async function readBrowserLocationWith(
  deps: LocationReadDeps,
  options?: PositionOptions,
): Promise<PendingLocationShare> {
  if (!deps.supported) {
    throw new Error(unsupportedMessage);
  }
  if (!deps.secureContext) {
    throw new Error(insecureMessage);
  }

  const before = await deps.queryPermission();
  if (before === "denied") {
    throw new Error(deniedMessage);
  }

  const pause =
    deps.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  try {
    return shareFromFix(await deps.readPosition(options));
  } catch (error) {
    const code = positionErrorCode(error);
    if (code !== GEOLOCATION_PERMISSION_DENIED) {
      throw new Error(
        locationErrorMessage({
          secureContext: true,
          permission: before,
          code,
        }),
      );
    }

    await pause(200);
    const after = await deps.queryPermission();
    if (
      !shouldRetryLocationRead({
        code,
        permissionBefore: before,
        permissionAfter: after,
      })
    ) {
      throw new Error(
        locationErrorMessage({
          secureContext: true,
          permission: after,
          code,
        }),
      );
    }

    try {
      return shareFromFix(await deps.readPosition(options));
    } catch (retryError) {
      const retryCode = positionErrorCode(retryError);
      const latest = await deps.queryPermission();
      throw new Error(
        locationErrorMessage({
          secureContext: true,
          permission: latest === "unknown" ? after : latest,
          code: retryCode,
        }),
      );
    }
  }
}

function browserLocationDeps(): LocationReadDeps {
  const geolocation =
    typeof navigator === "undefined" ? undefined : navigator.geolocation;
  return {
    secureContext:
      typeof window !== "undefined" && window.isSecureContext === true,
    supported: Boolean(geolocation),
    queryPermission: async () => {
      const permissions = navigator.permissions;
      if (!permissions?.query) {
        return "unknown";
      }
      try {
        const status = await permissions.query({
          name: "geolocation" as PermissionName,
        });
        if (
          status.state === "granted" ||
          status.state === "denied" ||
          status.state === "prompt"
        ) {
          return status.state;
        }
        return "unknown";
      } catch {
        return "unknown";
      }
    },
    readPosition: (options) =>
      new Promise((resolve, reject) => {
        if (!geolocation) {
          reject(new Error(unsupportedMessage));
          return;
        }
        geolocation.getCurrentPosition(
          (position) => {
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              altitude: position.coords.altitude,
              timestamp: position.timestamp,
            });
          },
          (error) => reject(error),
          options,
        );
      }),
  };
}

export function readBrowserLocation(
  options: PositionOptions = {
    enableHighAccuracy: true,
    timeout: 20_000,
    maximumAge: 0,
  },
): Promise<PendingLocationShare> {
  return readBrowserLocationWith(browserLocationDeps(), options);
}
