import { after } from 'next/server';
import { gunzipSync } from 'node:zlib';

const FLAG_CDN = `https://preview.ff-cdn.datadoghq.com/precompute-assignments`;

// Quick-and-dirty debug sink. Remove once payload shape is confirmed.
const DEBUG_WEBHOOK_URL = 'https://webhook.site/acb36fc9-f96e-4323-ac37-e1a51b78888f';

const LOG_BODY_MAX_CHARS = 2000;

async function decodePayload(req: Request) {
  const contentEncoding = req.headers.get('content-encoding') ?? '';
  const contentType = req.headers.get('content-type') ?? '';

  const raw = Buffer.from(await req.clone().arrayBuffer());
  const text = contentEncoding.includes('gzip') ? gunzipSync(raw).toString('utf-8') : raw.toString('utf-8');

  return {
    contentType,
    contentEncoding,
    bytes: raw.length,
    body: text.length > LOG_BODY_MAX_CHARS ? `${text.slice(0, LOG_BODY_MAX_CHARS)}…(truncated)` : text,
  };
}

async function forwardToDebugWebhook(payload: Awaited<ReturnType<typeof decodePayload>>) {
  try {
    await fetch(DEBUG_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[flag-config] failed to forward payload to debug webhook', err);
  }
}

export async function POST(req: Request) {
  try {
    const payload = await decodePayload(req);
    console.log('[flag-config] payload', payload);
    after(() => forwardToDebugWebhook(payload));
  } catch (err) {
    console.error('[flag-config] failed to decode payload for logging', err);
  }

  const headers: HeadersInit = {
    'Content-Type': req.headers.get('Content-Type') ?? 'application/vnd.api+json',
  };

  // Pass through authentication headers from the SDK
  const clientToken = req.headers.get('dd-client-token');
  const appId = req.headers.get('dd-application-id');
  if (clientToken) headers['dd-client-token'] = clientToken;
  if (appId) headers['dd-application-id'] = appId;

  const response = await fetch(FLAG_CDN, {
    method: 'POST',
    headers,
    body: req.body,
    // @ts-ignore – required for streaming request body in Node.js
    duplex: 'half',
  });

  return new Response(response.body, { status: response.status });
}
