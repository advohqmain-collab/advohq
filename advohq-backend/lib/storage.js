/**
 * lib/storage.js
 * ──────────────
 * AWS S3 helpers for case document storage.
 * Files are stored at: cases/{caseId}/{filename}
 *
 * Required env vars:
 *   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET_NAME;

// ── Build S3 key ──────────────────────────────────────────────────────────────

export function buildKey(caseId, filename) {
  // Sanitise filename to avoid path traversal
  const safe = filename.replace(/[^a-zA-Z0-9._\- ]/g, '_');
  return `cases/${caseId}/${Date.now()}_${safe}`;
}

// ── Pre-signed upload URL (client uploads directly to S3) ────────────────────

/**
 * Generate a pre-signed PUT URL so the browser can upload directly to S3.
 * @param {string} key        — S3 object key
 * @param {string} mimeType   — e.g. 'application/pdf'
 * @param {number} expiresIn  — seconds (default 300)
 */
export async function getUploadUrl(key, mimeType, expiresIn = 300) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key:    key,
    ContentType: mimeType,
    // Server-side encryption at rest
    ServerSideEncryption: 'AES256',
  });
  return getSignedUrl(s3, command, { expiresIn });
}

// ── Pre-signed download URL ───────────────────────────────────────────────────

/**
 * Generate a pre-signed GET URL for secure, time-limited download.
 */
export async function getDownloadUrl(key, filename, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key:    key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteObject(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
