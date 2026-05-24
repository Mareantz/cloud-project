// ── Cosmos DB client module ───────────────────────────────────────────────────
//
// Exposes three async accessor functions:
//   getDatabase()              → Database
//   getRestaurantsContainer()  → Container  (partition key: /city)
//   getReviewsContainer()      → Container  (partition key: /restaurantId)
//
// All three are lazy: the underlying SDK objects are created on first call and
// cached for the lifetime of the process.  This avoids network calls at import
// time and makes unit-testing straightforward.
//
// Config is read exclusively from process.env so the same code works locally
// (via api/local.settings.json loaded by the Functions host) and in Azure
// (via Application Settings).
//
// Local emulator hardening (Phase 2)
// ───────────────────────────────────
// The Cosmos DB emulator (https://localhost:8081) presents a self-signed TLS
// certificate.  Node's default TLS stack rejects it with DEPTH_ZERO_SELF_SIGNED_CERT
// before any request completes.  When the endpoint resolves to localhost or
// 127.0.0.1 we therefore:
//   1. Inject an https.Agent with rejectUnauthorized: false so the self-signed
//      cert is accepted.
//   2. Disable background endpoint refreshing, which otherwise fires HTTPS
//      calls that also fail against the emulator's self-signed cert.
// Neither option is applied in production (non-localhost endpoints), so
// Azure-hosted behavior is completely unchanged.

import { CosmosClient, Database, Container } from '@azure/cosmos';
import https from 'node:https';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Throws a descriptive error instead of passing `undefined` to the SDK. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[cosmosClient] Missing required environment variable: "${name}". ` +
        `Check api/local.settings.json (local) or Application Settings (Azure).`,
    );
  }
  return value;
}

/**
 * Returns true when the endpoint targets a loopback address (emulator).
 * Matches both "localhost" and explicit IPv4 loopback "127.0.0.1".
 */
function isLocalEmulator(endpoint: string): boolean {
  try {
    const { hostname } = new URL(endpoint);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

// ── Singleton client ──────────────────────────────────────────────────────────

let _client: CosmosClient | null = null;

/** Returns the shared CosmosClient, creating it on first call. */
function getClient(): CosmosClient {
  if (!_client) {
    const endpoint = requireEnv('COSMOS_ENDPOINT');
    const key = requireEnv('COSMOS_KEY');

    if (isLocalEmulator(endpoint)) {
      // Emulator uses a self-signed cert – bypass TLS verification locally only.
      console.log('[cosmosClient] Local emulator detected – disabling TLS verification and background endpoint refresh.');
      _client = new CosmosClient({
        endpoint,
        key,
        agent: new https.Agent({ rejectUnauthorized: false }),
        connectionPolicy: { enableBackgroundEndpointRefreshing: false },
      });
    } else {
      _client = new CosmosClient({ endpoint, key });
    }
  }
  return _client;
}

// ── Database ──────────────────────────────────────────────────────────────────

// Concurrency-safe initialisation via promise memoization
// ────────────────────────────────────────────────────────
// Storing the Promise (not the resolved value) as the singleton eliminates the
// check-then-act race that caused 409 Conflict errors during startup.
//
// Why it works:
//   • The assignment  `_databasePromise = …`  is synchronous – it happens
//     before the JS engine yields control at the first `await` inside the
//     promise chain.
//   • Any concurrent caller that arrives while the first call is still in
//     flight finds a non-null promise and simply awaits the same one.
//   • Cosmos DB createIfNotExists is therefore called exactly once, no matter
//     how many function invocations race to the first await point.

let _databasePromise: Promise<Database> | null = null;

/**
 * Returns the application database, creating it if it does not yet exist.
 *
 * Concurrency-safe: the in-flight Promise is stored synchronously so that
 * concurrent callers all await the same operation instead of each firing a
 * separate createIfNotExists request (which would produce 409 Conflicts).
 */
export function getDatabase(): Promise<Database> {
  if (!_databasePromise) {
    // Store the promise synchronously BEFORE the first await so that any
    // concurrent caller sees it immediately and joins this single operation.
    _databasePromise = getClient()
      .databases.createIfNotExists({ id: requireEnv('COSMOS_DATABASE') })
      .then(({ database }) => database);
  }
  return _databasePromise;
}

// ── Containers ────────────────────────────────────────────────────────────────

let _restaurantsPromise: Promise<Container> | null = null;

/**
 * Returns the `restaurants` container, creating it if it does not yet exist.
 *
 * Partition key: `/city`
 *   Restaurants are browsed and filtered by city most of the time.
 *   Partitioning by city keeps "list restaurants in <city>" queries cheap
 *   and distributes load across cities without hot partitions.
 *
 * Concurrency-safe via promise memoization (see getDatabase for details).
 */
export function getRestaurantsContainer(): Promise<Container> {
  if (!_restaurantsPromise) {
    _restaurantsPromise = getDatabase().then((db) =>
      db.containers
        .createIfNotExists({
          id: requireEnv('COSMOS_CONTAINER_RESTAURANTS'),
          partitionKey: { paths: ['/city'] },
        })
        .then(({ container }) => container),
    );
  }
  return _restaurantsPromise;
}

let _reviewsPromise: Promise<Container> | null = null;

/**
 * Returns the `reviews` container, creating it if it does not yet exist.
 *
 * Partition key: `/restaurantId`
 *   All reviews for a restaurant live in the same partition.
 *   "Fetch all reviews for restaurant X" becomes a single-partition query,
 *   which is the dominant read pattern for the reviews container.
 *
 * Concurrency-safe via promise memoization (see getDatabase for details).
 */
export function getReviewsContainer(): Promise<Container> {
  if (!_reviewsPromise) {
    _reviewsPromise = getDatabase().then((db) =>
      db.containers
        .createIfNotExists({
          id: requireEnv('COSMOS_CONTAINER_REVIEWS'),
          partitionKey: { paths: ['/restaurantId'] },
        })
        .then(({ container }) => container),
    );
  }
  return _reviewsPromise;
}
