import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

function createR2Client(): S3Client {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = config;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error("Cloudflare R2 is not configured");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

function bucketName(): string {
  if (!config.R2_BUCKET_NAME) {
    throw new Error("Cloudflare R2 bucket is not configured");
  }
  return config.R2_BUCKET_NAME;
}

export async function uploadPrivateObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const client = createR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "private, no-store",
    }),
  );
}

export async function createPrivateObjectUrl(key: string): Promise<string> {
  const client = createR2Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucketName(),
      Key: key,
    }),
    { expiresIn: 300 },
  );
}

export async function createAssetUpload(
  eventId: string,
  filename: string,
  contentType: string,
  contentLength: number,
): Promise<{ key: string; uploadUrl: string }> {
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowedTypes.has(contentType)) {
    throw new RangeError("Only JPEG, PNG, and WebP uploads are supported");
  }
  if (!/\.(jpe?g|png|webp)$/i.test(filename)) {
    throw new RangeError("The file extension does not match an allowed image type");
  }
  if (!Number.isInteger(contentLength) || contentLength < 1 || contentLength > 5 * 1024 * 1024) {
    throw new RangeError("Images must be no larger than 5 MB");
  }

  const key = `events/${eventId}/uploads/${randomUUID()}`;
  const client = createR2Client();
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
      CacheControl: "private, no-store",
    }),
    { expiresIn: 300 },
  );
  return { key, uploadUrl };
}

export async function deletePrivateObject(key: string): Promise<void> {
  const client = createR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: bucketName(), Key: key }));
}
