// ── Application Insights telemetry wrapper ────────────────────────────────────
//
// Exposes two helpers used throughout the API functions:
//   trackException(error, properties?)  – log a caught error to App Insights
//   trackEvent(name, properties?)       – log a named business event
//
// Safe-by-default: when APPLICATIONINSIGHTS_CONNECTION_STRING is blank or
// absent (the local-dev default) every call is a silent no-op.  The app
// continues to work normally without any telemetry configuration.
//
// In Azure the Functions runtime initialises the App Insights SDK automatically
// when that environment variable is present and populates `defaultClient`.
// We reuse that client so there is no double-initialisation.  When running
// `func start` locally with a real connection string we initialise once
// ourselves on first use.

import * as appInsights from 'applicationinsights';

// ── Internal state ────────────────────────────────────────────────────────────

// Guards against calling appInsights.setup() more than once.
let _setupAttempted = false;

/**
 * Returns the active TelemetryClient, or null when telemetry is not
 * configured.  Handles three scenarios:
 *
 *  1. No connection string → returns null (no-op mode).
 *  2. Azure deployment    → the Functions runtime has already populated
 *                           defaultClient; we return it directly.
 *  3. Local dev with a real connection string → we call setup() once
 *                           so manual testing against a real resource works.
 */
function getClient(): appInsights.TelemetryClient | null {
  const connectionString =
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim();

  if (!connectionString) {
    // No key configured – silently disable telemetry.
    return null;
  }

  // The Azure Functions runtime populates defaultClient automatically.
  // Prefer it to avoid double-initialisation.
  if (appInsights.defaultClient) {
    return appInsights.defaultClient;
  }

  // Not yet initialised (e.g. local `func start` with a real connection string).
  if (!_setupAttempted) {
    _setupAttempted = true;
    try {
      appInsights
        .setup(connectionString)
        // The Functions runtime already tracks HTTP requests; disable here to
        // avoid duplicate dependency and request records.
        .setAutoCollectRequests(false)
        .setAutoCollectDependencies(false)
        .setAutoCollectConsole(false)
        // Keep exception auto-collection on as a belt-and-suspenders measure.
        .setAutoCollectExceptions(true)
        .start();
    } catch (initError: unknown) {
      console.warn(
        '[telemetry] Failed to initialise Application Insights:',
        initError,
      );
    }
  }

  return appInsights.defaultClient ?? null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sends a handled exception to Application Insights.
 *
 * Non-Error values are automatically wrapped in an Error so the stack trace
 * field in App Insights is always populated.
 *
 * @param error      The caught value from a catch block.
 * @param properties Optional string key/value pairs attached to the record.
 */
export function trackException(
  error: unknown,
  properties?: Record<string, string>,
): void {
  try {
    const client = getClient();
    if (!client) return;

    const exception =
      error instanceof Error ? error : new Error(String(error));
    client.trackException({ exception, properties });
  } catch {
    // Telemetry must never crash the app – swallow any SDK errors.
  }
}

/**
 * Sends a named custom event to Application Insights.
 *
 * Use dot-namespaced names to keep the App Insights query explorer tidy,
 * e.g. "restaurant.created", "review.created", "photo.uploaded".
 *
 * @param name       The event name.
 * @param properties Optional string key/value pairs attached to the record.
 */
export function trackEvent(
  name: string,
  properties?: Record<string, string>,
): void {
  try {
    const client = getClient();
    if (!client) return;

    client.trackEvent({ name, properties });
  } catch {
    // Telemetry must never crash the app – swallow any SDK errors.
  }
}
