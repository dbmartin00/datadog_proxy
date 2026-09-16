import { NextRequest, NextResponse } from 'next/server';
import { gunzipSync } from 'node:zlib';

const SITE = 'datadoghq.com';
const _parts = SITE.split('.');
const _tld = _parts.pop();
const BROWSER_INTAKE = `https://browser-intake-${_parts.join('-')}.${_tld}`;

const LOG_BODY_MAX_CHARS = 2000;

async function logRequestPayload(req: NextRequest) {
  const contentEncoding = req.headers.get('content-encoding') ?? '';
  const contentType = req.headers.get('content-type') ?? '';

  try {
    const raw = Buffer.from(await req.clone().arrayBuffer());
    const text = contentEncoding.includes('gzip') ? gunzipSync(raw).toString('utf-8') : raw.toString('utf-8');

    console.log('[intake] payload', {
      contentType,
      contentEncoding,
      bytes: raw.length,
      body: text.length > LOG_BODY_MAX_CHARS ? `${text.slice(0, LOG_BODY_MAX_CHARS)}…(truncated)` : text,
    });
  } catch (err) {
    console.error('[intake] failed to decode payload for logging', err);
  }
}

export async function POST(req: NextRequest) {
  const ddforward = req.nextUrl.searchParams.get('ddforward');
  if (!ddforward) {
    return NextResponse.json({ error: 'missing ddforward' }, { status: 400 });
  }

  await logRequestPayload(req);

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
