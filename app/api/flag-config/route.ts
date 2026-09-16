const FLAG_CDN = `https://preview.ff-cdn.datadoghq.com/precompute-assignments`;

export async function POST(req: Request) {
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
