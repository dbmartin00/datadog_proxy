import { gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { after } from 'next/server';

const FLAG_CDN = `https://preview.ff-cdn.datadoghq.com/precompute-assignments`;

const LOG_BODY_MAX_CHARS = 2000;

const s3 = new S3Client({ region: process.env.AWS_REGION });

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

// One record per flag returned in the response — a single request can evaluate multiple flags at once.
function buildAssignmentRecords(requestText: string, responseText: string) {
  const requestJson = JSON.parse(requestText);
  const responseJson = JSON.parse(responseText);

  const subject = requestJson?.data?.attributes?.subject ?? {};
  const targetingAttributes = subject.targeting_attributes ?? {};
  const flags = responseJson?.data?.attributes?.flags ?? {};

  const shared = {
    targetingKey: subject.targeting_key,
    userId: targetingAttributes.userId,
    userRole: targetingAttributes.userRole,
    env: requestJson?.data?.attributes?.env?.dd_env,
    sdkName: requestJson?.data?.attributes?.source?.sdk_name,
    sdkVersion: requestJson?.data?.attributes?.source?.sdk_version,
    createdAt: responseJson?.data?.attributes?.createdAt,
    environmentName: responseJson?.data?.attributes?.environment?.name,
  };

  return Object.entries(flags).map(([flagName, flag]: [string, any]) => ({
    ...shared,
    flagName,
    variationType: flag.variationType,
    // Athena/Glue columns are fixed-type; variationValue's shape varies per flag,
    // so it's stored as a JSON string and unpacked per-query with json_extract.
    variationValue: JSON.stringify(flag.variationValue),
    allocationKey: flag.allocationKey,
    variationKey: flag.variationKey,
    reason: flag.reason,
  }));
}

async function writeAssignmentsToS3(records: unknown[]) {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    console.error('[flag-config] S3_BUCKET_NAME not set, skipping S3 write');
    return;
  }

  const receivedAt = new Date();
  const datePrefix = receivedAt.toISOString().slice(0, 10);
  const key = `flag-assignments/dt=${datePrefix}/${receivedAt.getTime()}-${randomUUID()}.json`;
  const body = records.map((record) => JSON.stringify({ ...(record as object), receivedAt: receivedAt.toISOString() })).join('\n');

  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'application/x-ndjson' }));
    console.log('[flag-config] wrote assignments to s3', { bucket, key, records: records.length });
  } catch (err) {
    console.error('[flag-config] failed to write assignments to s3', err);
  }
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
      const records = buildAssignmentRecords(reqText, resText);
      console.log('[flag-config] assignments', records);
      if (records.length > 0) {
        after(() => writeAssignmentsToS3(records));
      }
    } catch (err) {
      console.error('[flag-config] failed to build assignment records', err);
    }
  }

  return new Response(response.body, { status: response.status });
}
