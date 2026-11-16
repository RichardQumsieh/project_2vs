export type PendingLocationShare = {
  lat: number;
  lon: number;
  accuracy?: number;
  altitude?: number;
  sharedAt: string;
};

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

export function readBrowserLocation(
  options: PositionOptions = {
    enableHighAccuracy: true,
    timeout: 20_000,
    maximumAge: 0,
  },
): Promise<PendingLocationShare> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(
      new Error("This browser cannot share location."),
    );
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy, altitude } = position.coords;
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180
        ) {
          reject(new Error("The device returned an invalid location."));
          return;
        }
        resolve({
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
          sharedAt: new Date(position.timestamp || Date.now()).toISOString(),
        });
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            reject(
              new Error(
                "Location permission was denied. Enable it in the browser to share.",
              ),
            );
            break;
          case error.POSITION_UNAVAILABLE:
            reject(new Error("Location is unavailable right now."));
            break;
          case error.TIMEOUT:
            reject(new Error("Timed out while reading your location."));
            break;
          default:
            reject(new Error("Could not read your location."));
        }
      },
      options,
    );
  });
}
