import { gunzipSync } from 'node:zlib';

const FLAG_CDN = `https://preview.ff-cdn.datadoghq.com/precompute-assignments`;

const LOG_BODY_MAX_CHARS = 2000;

function decodeText(raw: Buffer, contentEncoding: string) {
  return contentEncoding.includes('gzip') ? gunzipSync(raw).toString('utf-8') : raw.toString('utf-8');
}

function truncate(text: string) {
  return text.length > LOG_BODY_MAX_CHARS ? `${text.slice(0, LOG_BODY_MAX_CHARS)}…(truncated)` : text;
}

async function logRequestPayload(req: Request, text: string, raw: Buffer) {
  console.log('[flag-config] request payload', {
    contentType: req.headers.get('content-type') ?? '',
    contentEncoding: req.headers.get('content-encoding') ?? '',
    bytes: raw.length,
    body: truncate(text),
  });
}

async function logResponsePayload(response: Response, text: string, raw: Buffer) {
  console.log('[flag-config] response payload', {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    contentEncoding: response.headers.get('content-encoding') ?? '',
    bytes: raw.length,
    body: truncate(text),
  });
}

function buildAssignmentRecord(requestText: string, responseText: string) {
  const requestJson = JSON.parse(requestText);
  const responseJson = JSON.parse(responseText);

  const subject = requestJson?.data?.attributes?.subject ?? {};
  const targetingAttributes = subject.targeting_attributes ?? {};

  const flags = responseJson?.data?.attributes?.flags ?? {};
  const flagName = Object.keys(flags)[0];
  const flag = flagName ? flags[flagName] : {};

  return {
    targetingKey: subject.targeting_key,
    targetingAttributes,
    userId: targetingAttributes.userId,
    userRole: targetingAttributes.userRole,
    env: requestJson?.data?.attributes?.env?.dd_env,
    sdkName: requestJson?.data?.attributes?.source?.sdk_name,
    sdkVersion: requestJson?.data?.attributes?.source?.sdk_version,
    createdAt: responseJson?.data?.attributes?.createdAt,
    environmentName: responseJson?.data?.attributes?.environment?.name,
    flagName,
    variationType: flag.variationType,
    variationValue: flag.variationValue,
    allocationKey: flag.allocationKey,
    variationKey: flag.variationKey,
    reason: flag.reason,
  };
}

export async function POST(req: Request) {
  const reqRaw = Buffer.from(await req.clone().arrayBuffer());
  let reqText = '';
  try {
    reqText = decodeText(reqRaw, req.headers.get('content-encoding') ?? '');
    await logRequestPayload(req, reqText, reqRaw);
  } catch (err) {
    console.error('[flag-config] failed to decode request payload for logging', err);
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

  let resText = '';
  try {
    const resRaw = Buffer.from(await response.clone().arrayBuffer());
    resText = decodeText(resRaw, response.headers.get('content-encoding') ?? '');
    await logResponsePayload(response, resText, resRaw);
  } catch (err) {
    console.error('[flag-config] failed to decode response payload for logging', err);
  }

  if (reqText && resText) {
    try {
      console.log('[flag-config] assignment', buildAssignmentRecord(reqText, resText));
    } catch (err) {
      console.error('[flag-config] failed to build assignment record', err);
    }
  }

  return new Response(response.body, { status: response.status });
}
