import { asBufferSource, b64ToBytes, bytesToB64, randomBytes } from "./bytes";

export const maxVideoDurationSeconds = 75;
export const maxVideoSourceBytes = 500_000_000;
export const maxEncryptedVideoBytes = 6_500_000;
const maxVideoWidth = 854;
const maxVideoHeight = 480;
const videoBitrate = 440_000;
const audioBitrate = 48_000;
const maxCompressedDurationDriftSeconds = 1.5;

export type CompressedVideo = {
  blob: Blob;
  duration: number;
};

export type EncryptedVideo = {
  ciphertext: Uint8Array;
  key: string;
  nonce: string;
  mime: "video/webm" | "video/mp4";
  duration: number;
};

export function validateVideoDuration(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("This video has an invalid duration.");
  }
  if (duration > maxVideoDurationSeconds) {
    throw new Error("Videos must be 75 seconds or shorter.");
  }
}

export function validateCompressedVideoDuration(
  sourceDuration: number,
  compressedDuration: number,
) {
  validateVideoDuration(sourceDuration);
  if (!Number.isFinite(compressedDuration) || compressedDuration <= 0) {
    throw new Error("The compressed video has an invalid duration.");
  }
  if (
    Math.abs(sourceDuration - compressedDuration) >
    maxCompressedDurationDriftSeconds
  ) {
    throw new Error(
      "Video compression changed the clip duration. Try uploading it again in a supported browser.",
    );
  }
  validateVideoDuration(compressedDuration);
}

function isVideoFile(file: File) {
  return file.type.startsWith("video/") ||
    /\.(mp4|m4v|mov|webm|ogv|ogg|3gp|3g2|mkv)$/i.test(file.name);
}

export function getCompressedVideoDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("The video has invalid dimensions.");
  }
  const scale = Math.min(1, maxVideoWidth / width, maxVideoHeight / height);
  return {
    width: Math.max(2, Math.floor((width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((height * scale) / 2) * 2),
  };
}

export function readVideoDuration(file: File): Promise<number> {
  if (!isVideoFile(file)) {
    return Promise.reject(new Error("Choose a supported video file."));
  }
  if (file.size > maxVideoSourceBytes) {
    return Promise.reject(new Error("Videos must be 500 MB or smaller before compression."));
  }

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.src = url;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Could not read the video duration."));
    }, 30_000);
    video.addEventListener("loadedmetadata", () => {
      window.clearTimeout(timer);
      const duration = video.duration;
      cleanup();
      try {
        validateVideoDuration(duration);
        resolve(duration);
      } catch (error) {
        reject(error);
      }
    }, { once: true });
    video.addEventListener("error", () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new Error("This video format cannot be opened in your browser."));
    }, { once: true });
  });
}

function supportedRecordingMime() {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Video compression is not supported in this browser.");
  }
  const choices = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm",
  ];
  const mime = choices.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!mime) {
    throw new Error("This browser cannot encode a compressed video format.");
  }
  return mime;
}

export async function compressVideoFile(file: File): Promise<CompressedVideo> {
  const duration = await readVideoDuration(file);
  if (
    typeof HTMLCanvasElement.prototype.captureStream !== "function" ||
    typeof AudioContext === "undefined"
  ) {
    throw new Error("Video compression is not supported in this browser.");
  }
  const mimeType = supportedRecordingMime();
  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.playsInline = true;
  video.src = sourceUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
      video.addEventListener("error", () => reject(new Error("This video format cannot be opened in your browser.")), { once: true });
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) resolve();
    });

    const dimensions = getCompressedVideoDimensions(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare video compression.");

    const canvasStream = canvas.captureStream(15);
    const audioContext = new AudioContext();
    const audioSource = audioContext.createMediaElementSource(video);
    const audioDestination = audioContext.createMediaStreamDestination();
    audioSource.connect(audioDestination);
    const stream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks(),
    ]);

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: videoBitrate,
      audioBitsPerSecond: audioBitrate,
    });
    const chunks: Blob[] = [];

    return await new Promise<CompressedVideo>((resolve, reject) => {
      let settled = false;
      let animationFrame = 0;
      const cleanup = () => {
        window.cancelAnimationFrame(animationFrame);
        video.onended = null;
        stream.getTracks().forEach((track) => track.stop());
        canvasStream.getTracks().forEach((track) => track.stop());
        audioSource.disconnect();
        audioDestination.stream.getTracks().forEach((track) => track.stop());
        void audioContext.close();
        video.pause();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(sourceUrl);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        if (recorder.state !== "inactive") recorder.stop();
        cleanup();
        reject(error);
      };
      const drawFrame = () => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
        if (!settled && recorder.state === "recording") {
          animationFrame = window.requestAnimationFrame(drawFrame);
        }
      };

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener("error", () => {
        fail(new Error("The video could not be compressed."));
      }, { once: true });
      recorder.addEventListener("stop", () => {
        if (settled) return;
        settled = true;
        const blob = new Blob(chunks, {
          type: recorder.mimeType.split(";")[0] || mimeType.split(";")[0],
        });
        cleanup();
        if (blob.size === 0) {
          reject(new Error("The compressed video is empty."));
        } else if (blob.size + 16 > maxEncryptedVideoBytes) {
          reject(new Error("The compressed video is too large to send. Try a shorter clip."));
        } else {
          const extension = blob.type.startsWith("video/mp4") ? "mp4" : "webm";
          const compressedFile = new File([blob], `compressed.${extension}`, {
            type: blob.type,
          });
          void readVideoDuration(compressedFile).then((compressedDuration) => {
            try {
              validateCompressedVideoDuration(duration, compressedDuration);
              resolve({ blob, duration: compressedDuration });
            } catch (error) {
              reject(error);
            }
          }, reject);
        }
      }, { once: true });
      video.onended = () => {
        if (recorder.state !== "inactive") recorder.stop();
      };

      void audioContext.resume().then(() => {
        if (settled) return;
        try {
          recorder.start();
          drawFrame();
          return video.play();
        } catch (error) {
          fail(error instanceof Error ? error : new Error("Could not start video compression."));
          return undefined;
        }
      }).catch((error: unknown) => {
        fail(error instanceof Error ? error : new Error("Could not start video compression."));
      });
    });
  } finally {
    if (video.src) URL.revokeObjectURL(sourceUrl);
  }
}

export async function encryptVideoFile(file: File): Promise<EncryptedVideo> {
  const compressed = await compressVideoFile(file);
  return encryptVideoBytes(
    new Uint8Array(await compressed.blob.arrayBuffer()),
    compressed.blob.type.startsWith("video/mp4") ? "video/mp4" : "video/webm",
    compressed.duration,
  );
}

export async function encryptVideoBytes(
  plaintext: Uint8Array,
  mime: EncryptedVideo["mime"],
  duration: number,
): Promise<EncryptedVideo> {
  validateVideoDuration(duration);
  if (plaintext.byteLength + 16 > maxEncryptedVideoBytes) {
    throw new Error("The video exceeds the storage limit.");
  }
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const nonce = randomBytes(12);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBufferSource(nonce) },
      key,
      asBufferSource(plaintext),
    ),
  );
  if (ciphertext.byteLength > maxEncryptedVideoBytes) {
    throw new Error("The encrypted video exceeds the storage limit.");
  }

  return {
    ciphertext,
    key: bytesToB64(new Uint8Array(await crypto.subtle.exportKey("raw", key))),
    nonce: bytesToB64(nonce),
    mime,
    duration,
  };
}

export async function decryptVideoBytes(
  ciphertext: Uint8Array,
  keyB64: string,
  nonceB64: string,
  mime: EncryptedVideo["mime"],
) {
  const key = await crypto.subtle.importKey(
    "raw",
    asBufferSource(b64ToBytes(keyB64)),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBufferSource(b64ToBytes(nonceB64)) },
      key,
      asBufferSource(ciphertext),
    ),
  );
  return new Blob([asBufferSource(plaintext)], { type: mime });
}
