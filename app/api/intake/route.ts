import { NextRequest, NextResponse } from 'next/server';

const SITE = 'datadoghq.com';
const _parts = SITE.split('.');
const _tld = _parts.pop();
const BROWSER_INTAKE = `https://browser-intake-${_parts.join('-')}.${_tld}`;

export async function POST(req: NextRequest) {
  const ddforward = req.nextUrl.searchParams.get('ddforward');
  if (!ddforward) {
    return NextResponse.json({ error: 'missing ddforward' }, { status: 400 });
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

  console.log('req.body', req.body);

  return new Response(response.body, { status: response.status });
}
