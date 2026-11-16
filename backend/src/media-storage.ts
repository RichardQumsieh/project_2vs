import {
  GetObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { b2Configured, env } from "./env.js";

const uploadUrlExpiresSeconds = 5 * 60;
const downloadUrlExpiresSeconds = 5 * 60;

let client: S3Client | undefined;

function requireB2() {
  if (
    !b2Configured ||
    !env.B2_ENDPOINT ||
    !env.B2_REGION ||
    !env.B2_BUCKET ||
    !env.B2_KEY_ID ||
    !env.B2_APPLICATION_KEY
  ) {
    throw new Error("Media storage is not configured on this server.");
  }

  return {
    endpoint: env.B2_ENDPOINT,
    region: env.B2_REGION,
    bucket: env.B2_BUCKET,
    keyId: env.B2_KEY_ID,
    applicationKey: env.B2_APPLICATION_KEY,
  };
}

function s3() {
  if (client) {
    return client;
  }

  const config = requireB2();
  client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.keyId,
      secretAccessKey: config.applicationKey,
    },
    forcePathStyle: true,
  });
  return client;
}

export async function applyBucketCors() {
  const config = requireB2();
  await s3().send(
    new PutBucketCorsCommand({
      Bucket: config.bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [new URL(env.FRONTEND_ORIGIN).origin],
            AllowedMethods: ["GET", "PUT", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag", "Content-Length"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
}

export async function createMediaUploadUrl(objectKey: string, byteSize: number) {
  const config = requireB2();
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: objectKey,
    ContentType: "application/octet-stream",
    ContentLength: byteSize,
  });
  return getSignedUrl(s3(), command, { expiresIn: uploadUrlExpiresSeconds });
}

export async function createMediaDownloadUrl(objectKey: string) {
  const config = requireB2();
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: objectKey,
  });
  return getSignedUrl(s3(), command, { expiresIn: downloadUrlExpiresSeconds });
}
