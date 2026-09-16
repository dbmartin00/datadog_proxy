import { NextRequest, NextResponse, after } from 'next/server';
import { gunzipSync } from 'node:zlib';

const SITE = 'datadoghq.com';
const _parts = SITE.split('.');
const _tld = _parts.pop();
const BROWSER_INTAKE = `https://browser-intake-${_parts.join('-')}.${_tld}`;

// Quick-and-dirty debug sink. Remove once payload shape is confirmed.
const DEBUG_WEBHOOK_URL = 'https://webhook.site/acb36fc9-f96e-4323-ac37-e1a51b78888f';

const LOG_BODY_MAX_CHARS = 2000;

async function decodePayload(req: NextRequest) {
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

async function forwardToDebugWebhook(payload: Awaited<ReturnType<typeof decodePayload>>, ddforward: string) {
  try {
    await fetch(DEBUG_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ddforward, ...payload }),
    });
  } catch (err) {
    console.error('[intake] failed to forward payload to debug webhook', err);
  }
}

export async function POST(req: NextRequest) {
  const ddforward = req.nextUrl.searchParams.get('ddforward');
  if (!ddforward) {
    return NextResponse.json({ error: 'missing ddforward' }, { status: 400 });
  }

  try {
    const payload = await decodePayload(req);
    console.log('[intake] payload', payload);
    after(() => forwardToDebugWebhook(payload, ddforward));
  } catch (err) {
    console.error('[intake] failed to decode payload for logging', err);
  }

  const targetUrl = `${BROWSER_INTAKE}${ddforward}`;
  const clientIp = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '';

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': req.headers.get('Content-Type') ?? 'application/octet-stream',
      'X-Forwarded-For': clientIp,
    },
    body: req.body,
    // @ts-ignore
    duplex: 'half',
  });

  return new Response(response.body, { status: response.status });
}
