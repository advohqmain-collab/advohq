/**
 * scripts/test-s3.js
 * ──────────────────
 * Verifies your S3 bucket works with the SAME SDK + env vars the app uses.
 * Runs a full Put → Head → presigned GET → Delete cycle.
 *
 * Usage (from the advohq-backend folder):
 *
 *   # 1. make sure deps are installed
 *   npm install
 *
 *   # 2. run with your real credentials (PowerShell):
 *   $env:AWS_REGION="ap-south-1"; `
 *   $env:AWS_ACCESS_KEY_ID="AKIA..."; `
 *   $env:AWS_SECRET_ACCESS_KEY="..."; `
 *   $env:S3_BUCKET_NAME="advohq-documents"; `
 *   node scripts/test-s3.js
 *
 *   # ...or, if you have a .env.local, load it first however you prefer.
 */

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const REGION = process.env.AWS_REGION || 'ap-south-1';
const BUCKET = process.env.S3_BUCKET_NAME;

function need(name) {
  if (!process.env[name]) {
    console.error(`❌ Missing env var: ${name}`);
    process.exit(1);
  }
}
['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET_NAME'].forEach(need);

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const KEY = `__healthcheck__/test_${Date.now()}.txt`;

async function main() {
  console.log(`\nBucket: ${BUCKET}   Region: ${REGION}\n`);

  // 1. Upload
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: KEY,
      Body: 'advohq s3 healthcheck',
      ContentType: 'text/plain',
      ServerSideEncryption: 'AES256',
    }));
    console.log('✅ PutObject     — upload works (credentials + write permission OK)');
  } catch (e) {
    console.error('❌ PutObject failed:', e.name, '-', e.message);
    hint(e);
    process.exit(1);
  }

  // 2. Confirm it exists
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: KEY }));
    console.log('✅ HeadObject    — object exists in bucket');
  } catch (e) {
    console.error('❌ HeadObject failed:', e.name, '-', e.message);
  }

  // 3. Presigned download URL (what /api/cases/:id/download returns)
  try {
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: KEY }), { expiresIn: 120 });
    console.log('✅ Presigned GET — signed download URL generated');
    console.log('   ', url.slice(0, 90) + '…');
  } catch (e) {
    console.error('❌ Presigned GET failed:', e.name, '-', e.message);
  }

  // 4. Clean up
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: KEY }));
    console.log('✅ DeleteObject  — cleanup works (delete permission OK)');
  } catch (e) {
    console.error('❌ DeleteObject failed:', e.name, '-', e.message);
  }

  console.log('\n🎉 Bucket is reachable and your IAM credentials work.\n');
  console.log('NOTE: this does NOT test browser CORS. Direct browser uploads also');
  console.log('need a CORS policy on the bucket (see instructions).\n');
}

function hint(e) {
  const n = e.name || '';
  if (n.includes('NoSuchBucket'))        console.error('   → The bucket name is wrong or in a different region.');
  if (n.includes('AccessDenied'))        console.error('   → IAM user lacks s3:PutObject on this bucket.');
  if (n.includes('InvalidAccessKeyId'))  console.error('   → AWS_ACCESS_KEY_ID is wrong.');
  if (n.includes('SignatureDoesNotMatch')) console.error('   → AWS_SECRET_ACCESS_KEY is wrong.');
}

main().catch((e) => { console.error('Unexpected error:', e); process.exit(1); });
