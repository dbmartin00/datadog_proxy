import { gunzipSync } from 'node:zlib';

const FLAG_CDN = `https://preview.ff-cdn.datadoghq.com/precompute-assignments`;

const LOG_BODY_MAX_CHARS = 2000;

function decodeBody(raw: Buffer, contentEncoding: string) {
  const text = contentEncoding.includes('gzip') ? gunzipSync(raw).toString('utf-8') : raw.toString('utf-8');
  return text.length > LOG_BODY_MAX_CHARS ? `${text.slice(0, LOG_BODY_MAX_CHARS)}…(truncated)` : text;
}

async function logRequestPayload(req: Request) {
  try {
    const contentEncoding = req.headers.get('content-encoding') ?? '';
    const contentType = req.headers.get('content-type') ?? '';
    const raw = Buffer.from(await req.clone().arrayBuffer());

    console.log('[flag-config] request payload', {
      contentType,
      contentEncoding,
      bytes: raw.length,
      body: decodeBody(raw, contentEncoding),
    });
  } catch (err) {
    console.error('[flag-config] failed to decode request payload for logging', err);
  }
}

async function logResponsePayload(response: Response) {
  try {
    const contentEncoding = response.headers.get('content-encoding') ?? '';
    const contentType = response.headers.get('content-type') ?? '';
    const raw = Buffer.from(await response.clone().arrayBuffer());

    console.log('[flag-config] response payload', {
      status: response.status,
      contentType,
      contentEncoding,
      bytes: raw.length,
      body: decodeBody(raw, contentEncoding),
    });
  } catch (err) {
    console.error('[flag-config] failed to decode response payload for logging', err);
  }
}

export async function POST(req: Request) {
  await logRequestPayload(req);

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

  await logResponsePayload(response);

  return new Response(response.body, { status: response.status });
}
