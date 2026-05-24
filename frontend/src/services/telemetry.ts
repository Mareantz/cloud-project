// ── Application Insights telemetry for the React frontend ────────────────────
//
// Call initTelemetry() once at app startup (main.tsx) before rendering.
// After that, import and call the helpers anywhere in the app:
//
//   trackPageView(name?, uri?)
//   trackEvent(name, properties?)
//   trackException(error, properties?)
//
// Safe-by-default: when VITE_APPLICATIONINSIGHTS_CONNECTION_STRING is blank
// or absent (the default for local development) initTelemetry() is a no-op
// and all helpers become silent no-ops.  The rest of the app is unaffected.
//
// Page views for SPA route changes are captured automatically via
// enableAutoRouteTracking, which hooks into the history API that React Router
// v6 uses under the hood.  No changes to App.tsx are required.

import { ApplicationInsights } from '@microsoft/applicationinsights-web';

// ── Internal state ────────────────────────────────────────────────────────────

// The SDK instance – null when telemetry is not configured.
let _appInsights: ApplicationInsights | null = null;

// ── Initialisation ────────────────────────────────────────────────────────────

/**
 * Initialises Application Insights from the Vite environment variable
 * VITE_APPLICATIONINSIGHTS_CONNECTION_STRING.
 *
 * Must be called once, before the React tree is rendered.  Safe to call
 * when the variable is blank – becomes a no-op in that case.
 */
export function initTelemetry(): void {
  // Vite replaces import.meta.env.* at build time.
  // Cast because the generated type may be broader than string.
  const connectionString = (
    import.meta.env.VITE_APPLICATIONINSIGHTS_CONNECTION_STRING as
      | string
      | undefined
  )?.trim();

  if (!connectionString) {
    // No connection string configured – telemetry disabled for this build.
    return;
  }

  try {
    _appInsights = new ApplicationInsights({
      config: {
        connectionString,
        // Automatically fire a pageView telemetry item on every history-based
        // navigation (pushState / replaceState).  React Router v6 uses these
        // APIs, so every client-side route change is captured without any
        // manual instrumentation in App.tsx.
        enableAutoRouteTracking: true,
      },
    });
    _appInsights.loadAppInsights();
    // Track the very first page load explicitly.
    _appInsights.trackPageView();
  } catch (initError: unknown) {
    console.warn(
      '[telemetry] Failed to initialise Application Insights:',
      initError,
    );
    _appInsights = null;
  }
}

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Sends a page-view event.  Useful for manual tracking when
 * enableAutoRouteTracking cannot detect the transition.
 *
 * @param name Optional page name shown in App Insights; defaults to document title.
 * @param uri  Optional URL; defaults to window.location.href.
 */
export function trackPageView(name?: string, uri?: string): void {
  try {
    _appInsights?.trackPageView({ name, uri });
  } catch {
    // Never let telemetry helpers throw.
  }
}

/**
 * Sends a named custom event.
 *
 * @param name       Short, dot-namespaced name, e.g. "restaurant.created".
 * @param properties Optional string key/value pairs attached to the record.
 */
export function trackEvent(
  name: string,
  properties?: Record<string, string>,
): void {
  try {
    _appInsights?.trackEvent({ name }, properties);
  } catch {
    // Never let telemetry helpers throw.
  }
}

/**
 * Sends a handled exception to Application Insights.
 *
 * Non-Error values are automatically wrapped in an Error.
 *
 * @param error      The caught value.
 * @param properties Optional string key/value pairs attached to the record.
 */
export function trackException(
  error: unknown,
  properties?: Record<string, string>,
): void {
  try {
    const exception =
      error instanceof Error ? error : new Error(String(error));
    _appInsights?.trackException({ exception }, properties);
  } catch {
    // Never let telemetry helpers throw.
  }
}
