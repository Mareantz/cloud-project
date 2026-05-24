import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Returns a simple JSON payload confirming the API is reachable.
 * The frontend polls this on startup to show connection status.
 */
export async function healthHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log(`Health check – method=${request.method} url=${request.url}`);

  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    jsonBody: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'restaurant-reviews-api',
    },
  };
}

// ── Registration ─────────────────────────────────────────────────────────────

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  // Accessible at: GET http://localhost:7071/api/health
  route: 'health',
  handler: healthHandler,
});
