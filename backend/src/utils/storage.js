// Media storage: Cloudflare R2 when configured, local disk otherwise
// (development only). Object keys are unguessable.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/3gpp": "3gp",
};

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const AUDIO_MIME_TYPES = Object.keys(EXTENSIONS).filter((type) =>
  type.startsWith("audio/")
);

const r2Configured = Boolean(
  env.r2.endpoint && env.r2.accessKeyId && env.r2.secretAccessKey && env.r2.bucket
);

let s3Client = null;
async function getS3() {
  if (!s3Client) {
    const { S3Client } = await import("@aws-sdk/client-s3");
    s3Client = new S3Client({
      region: "auto",
      endpoint: env.r2.endpoint,
      credentials: {
        accessKeyId: env.r2.accessKeyId,
        secretAccessKey: env.r2.secretAccessKey,
      },
    });
  }
  return s3Client;
}

/**
 * Stores an uploaded file and returns its URL.
 * @param {{ buffer: Buffer, mimetype: string }} file  a multer memory file
 * @param {string} folder  e.g. "bills/12"
 */
export async function saveUpload(file, folder) {
  // multer reports e.g. "audio/webm;codecs=opus" for MediaRecorder blobs.
  const mimetype = file.mimetype.split(";")[0].trim();
  const extension = EXTENSIONS[mimetype];
  if (!extension) throw new Error(`Unsupported upload type: ${mimetype}`);
  const key = `${folder}/${crypto.randomUUID()}.${extension}`;

  if (r2Configured) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await getS3();
    await client.send(
      new PutObjectCommand({
        Bucket: env.r2.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: mimetype,
      })
    );
    return env.r2.publicBaseUrl ? `${env.r2.publicBaseUrl}/${key}` : key;
  }

  if (env.isProduction) {
    throw new Error("Object storage (R2_*) must be configured in production");
  }
  const target = path.resolve(env.uploadDir, key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, file.buffer);
  return `/uploads/${key}`;
}
