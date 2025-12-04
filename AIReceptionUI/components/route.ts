import { NextRequest, NextResponse } from 'next/server';

/**
 * API route to proxy requests to the crawl-kb service.
 * This is used to avoid CORS issues in the browser during development and production.
 * The browser calls this endpoint, and the Next.js server calls the actual backend service.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ message: 'URL is required' }, { status: 400 });
    }

    // In a real app, you'd get this from environment variables
    // e.g., process.env.CRAWL_API_ENDPOINT
    const crawlApiEndpoint = 'https://aireceptionist-func.azurewebsites.net/api/crawl-kb';

    const apiResponse = await fetch(crawlApiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    const data = await apiResponse.json();
    return NextResponse.json(data, { status: apiResponse.status });
  } catch (error) {
    console.error('Crawl proxy API error:', error);
    return NextResponse.json({ message: 'An internal server error occurred' }, { status: 500 });
  }
}