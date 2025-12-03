import { NextRequest, NextResponse } from 'next/server';

// Hard-code the crawl target to Azure to avoid local overrides.
const CRAWL_API_TARGET = 'https://aireceptionist-func.azurewebsites.net/api/crawl-kb';

const corsHeaders = (origin?: string) => {
  const allowOrigin = process.env.CORS_ALLOW_ORIGIN || origin || '*';
  const allowCredentials = process.env.CORS_ALLOW_CREDENTIALS === 'true' && allowOrigin !== '*';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
  if (allowCredentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
};

export const dynamic = 'force-dynamic';

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin') || undefined;
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

/**
 * Server-side proxy to the crawl-kb service to avoid browser CORS.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin') || undefined;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch (err) {
    return NextResponse.json({ message: 'Invalid request body' }, { status: 400, headers: corsHeaders(origin) });
  }

  try {
    const apiResponse = await fetch(CRAWL_API_TARGET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const contentType = apiResponse.headers.get('Content-Type') || 'application/json';
    const responseText = await apiResponse.text(); // buffer to avoid locked stream issues

    return new NextResponse(responseText, {
      status: apiResponse.status,
      headers: {
        'Content-Type': contentType,
        'X-Crawl-Target': CRAWL_API_TARGET,
        ...corsHeaders(origin),
      },
    });
  } catch (error: any) {
    console.error('Proxy request failed:', error);
    return NextResponse.json(
      { message: 'Proxy request failed. Is the backend service running?' },
      { status: 502, headers: corsHeaders(origin) },
    );
  }
}
