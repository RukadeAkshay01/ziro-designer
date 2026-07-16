/**
 * Minimal dependency-free SigV4 client for R2's S3-compatible API.
 * Shared by the content uploaders (demos, libraries). Credentials come from
 * R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (+ R2_BUCKET).
 */
import { createHash, createHmac } from 'node:crypto';

const ACCOUNT = process.env.R2_ACCOUNT_ID;
const KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET = process.env.R2_SECRET_ACCESS_KEY;
export const BUCKET = process.env.R2_BUCKET ?? 'ziro-3dmodels';
if (!ACCOUNT || !KEY || !SECRET) {
  console.error('Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.');
  process.exit(1);
}
const HOST = `${ACCOUNT}.r2.cloudflarestorage.com`;

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const encPath = (p) =>
  p
    .split('/')
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');

export async function putObject(key, body, contentType) {
  const amzDate = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const canonicalUri = `/${BUCKET}/${encPath(key)}`;
  const headers = { host: HOST, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonical = [
    'PUT',
    canonicalUri,
    '',
    ...Object.keys(headers)
      .sort()
      .map((h) => `${h}:${headers[h]}`),
    '',
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${SECRET}`, date), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const res = await fetch(`https://${HOST}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      ...headers,
      authorization: auth,
      'content-type': contentType,
      'content-length': String(body.length),
    },
    body,
  });
  if (!res.ok) throw new Error(`PUT ${key}: ${res.status} ${await res.text()}`);
}

/** Upload [key, body, type] entries with limited concurrency and retries. */
export async function uploadAll(entries, { concurrency = 8, onProgress } = {}) {
  let done = 0;
  const queue = [...entries];
  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [key, body, type] = next;
      for (let attempt = 1; ; attempt++) {
        try {
          await putObject(key, body, type);
          break;
        } catch (e) {
          if (attempt >= 4) throw e;
          await new Promise((r) => setTimeout(r, attempt * 2000));
        }
      }
      done++;
      onProgress?.(done, entries.length);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}
