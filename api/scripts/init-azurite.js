// ── scripts/init-azurite.js ───────────────────────────────────────────────────
//
// Creates the Azure Storage queue(s) that the Functions host requires before it
// can start polling them.  Run this once before `func start` so the host does
// not crash with a 404 / QueueNotFound error.
//
// Usage:
//   node scripts/init-azurite.js          (plain Node – no build step needed)
//   npm run init-azurite                  (npm script alias)
//
// Settings are read from api/local.settings.json so they stay in sync with the
// rest of the local dev configuration automatically.  The script falls back to
// the Azurite well-known connection string when a value is missing so it works
// out-of-the-box for students cloning the repo for the first time.
//
// The @azure/storage-queue package is already a production dependency, so no
// extra install is required.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const path = require('path');
const { QueueServiceClient } = require('@azure/storage-queue');

// ── Load local.settings.json ──────────────────────────────────────────────────

const settingsPath = path.join(__dirname, '..', 'local.settings.json');

let settings = {};
try {
  settings = require(settingsPath).Values ?? {};
} catch {
  // File absent or malformed – fall back to defaults below.
  console.warn(
    '[init-azurite] Could not read local.settings.json; using built-in defaults.',
  );
}

// ── Resolve config values ─────────────────────────────────────────────────────

// Azurite's well-known development connection string (same as UseDevelopmentStorage=true).
const AZURITE_CONNECTION_STRING =
  'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;' +
  'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;' +
  'BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;' +
  'QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;' +
  'TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;';

const connectionString =
  // Accept both key names used across the project.
  settings['AzureWebJobsStorage'] ||
  settings['BLOB_CONNECTION_STRING'] ||
  AZURITE_CONNECTION_STRING;

// Resolve "UseDevelopmentStorage=true" shorthand to the full Azurite string so
// the SDK does not need the Azure Storage Emulator host-name alias.
const resolvedConnectionString =
  connectionString.trim().toLowerCase() === 'usedevelopmentstorage=true'
    ? AZURITE_CONNECTION_STRING
    : connectionString;

const queueName =
  settings['REVIEW_IMAGES_QUEUE_NAME'] || 'review-image-processing';

// ── Create queues ─────────────────────────────────────────────────────────────

async function main() {
  console.log('[init-azurite] Connecting to Azurite queue service…');

  const client = QueueServiceClient.fromConnectionString(resolvedConnectionString);
  const queueClient = client.getQueueClient(queueName);

  try {
    const response = await queueClient.createIfNotExists();
    if (response.created) {
      console.log(`[init-azurite] Queue created: "${queueName}"`);
    } else {
      console.log(`[init-azurite] Queue already exists: "${queueName}"`);
    }
  } catch (err) {
    // Surface a clear message so students know what is wrong.
    console.error(
      `[init-azurite] Failed to create queue "${queueName}": ${err.message}`,
    );
    console.error(
      '[init-azurite] Is Azurite running?  Start it with: azurite --silent &',
    );
    process.exit(1);
  }

  console.log('[init-azurite] Done. You can now run: npm start');
}

main();
