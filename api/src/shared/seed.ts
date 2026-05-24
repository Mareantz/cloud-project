// ── Seed script ───────────────────────────────────────────────────────────────
//
// Populates the local Cosmos DB emulator with sample restaurants and reviews.
//
// Usage (from the api/ directory):
//   npm run seed
//
// Safe to rerun: every document is upserted using a fixed id, so no duplicates
// are created on subsequent runs.
//
// The script loads api/local.settings.json automatically so it can run outside
// the Azure Functions host without any extra environment setup.

import fs from 'fs';
import path from 'path';
import type { Restaurant, Review } from './types';

// ── Load local.settings.json ──────────────────────────────────────────────────
// The Functions runtime loads this file automatically, but a standalone Node
// script does not have that runtime.  We load it here before any Cosmos SDK
// code is invoked (the SDK only reads env vars on first call, not at import).

const settingsPath = path.resolve(__dirname, '../../../local.settings.json');

if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, 'utf-8');
  const settings = JSON.parse(raw) as { Values?: Record<string, string> };
  for (const [key, val] of Object.entries(settings.Values ?? {})) {
    // Don't overwrite vars that were already set in the real environment.
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
  console.log('[seed] Loaded env from local.settings.json');
} else {
  console.warn('[seed] local.settings.json not found – relying on process.env');
}

// Import after env is loaded so getClient() picks up the correct values.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getRestaurantsContainer, getReviewsContainer } = require('./cosmosClient') as typeof import('./cosmosClient');

// ── Sample data ───────────────────────────────────────────────────────────────
// Fixed UUIDs ensure upsert is idempotent across runs.

const RESTAURANTS: Restaurant[] = [
  {
    id: 'rest-001',
    name: 'La Bella Italia',
    cuisine: 'Italian',
    address: '123 Pike St',
    city: 'Seattle',
    averageRating: 4.5,
    reviewCount: 2,
    photoUrl: undefined,
    createdAt: '2024-01-10T10:00:00.000Z',
  },
  {
    id: 'rest-002',
    name: 'Sakura Sushi',
    cuisine: 'Japanese',
    address: '456 Broadway Ave',
    city: 'Seattle',
    averageRating: 4.8,
    reviewCount: 2,
    photoUrl: undefined,
    createdAt: '2024-01-12T11:00:00.000Z',
  },
  {
    id: 'rest-003',
    name: 'El Rancho Cantina',
    cuisine: 'Mexican',
    address: '789 Burnside St',
    city: 'Portland',
    averageRating: 4.2,
    reviewCount: 2,
    photoUrl: undefined,
    createdAt: '2024-01-15T09:30:00.000Z',
  },
  {
    id: 'rest-004',
    name: 'The Spice Garden',
    cuisine: 'Indian',
    address: '321 Alberta St',
    city: 'Portland',
    averageRating: 4.6,
    reviewCount: 2,
    photoUrl: undefined,
    createdAt: '2024-01-18T14:00:00.000Z',
  },
];

const REVIEWS: Review[] = [
  // La Bella Italia
  {
    id: 'rev-001',
    restaurantId: 'rest-001',
    authorName: 'Alice',
    rating: 5,
    text: 'Incredible pasta and a warm, cozy atmosphere. Best tiramisu in Seattle!',
    createdAt: '2024-01-20T18:30:00.000Z',
  },
  {
    id: 'rev-002',
    restaurantId: 'rest-001',
    authorName: 'Bob',
    rating: 4,
    text: 'Great food and friendly staff. A bit pricey but worth it for a special occasion.',
    createdAt: '2024-01-22T19:00:00.000Z',
  },

  // Sakura Sushi
  {
    id: 'rev-003',
    restaurantId: 'rest-002',
    authorName: 'Carol',
    rating: 5,
    text: 'Freshest fish in town. The omakase experience is absolutely worth every penny.',
    createdAt: '2024-01-25T20:00:00.000Z',
  },
  {
    id: 'rev-004',
    restaurantId: 'rest-002',
    authorName: 'David',
    rating: 5,
    text: 'Exceptional quality and presentation. My go-to sushi spot.',
    createdAt: '2024-01-26T19:30:00.000Z',
  },

  // El Rancho Cantina
  {
    id: 'rev-005',
    restaurantId: 'rest-003',
    authorName: 'Eva',
    rating: 4,
    text: 'Delicious tacos al pastor and strong margaritas. Lively weekend atmosphere.',
    createdAt: '2024-01-28T21:00:00.000Z',
  },
  {
    id: 'rev-006',
    restaurantId: 'rest-003',
    authorName: 'Frank',
    rating: 4,
    text: 'Solid Mexican food at a fair price. The guacamole is made tableside.',
    createdAt: '2024-01-30T20:00:00.000Z',
  },

  // The Spice Garden
  {
    id: 'rev-007',
    restaurantId: 'rest-004',
    authorName: 'Grace',
    rating: 5,
    text: 'Authentic regional Indian cuisine. The lamb rogan josh is outstanding.',
    createdAt: '2024-02-01T19:00:00.000Z',
  },
  {
    id: 'rev-008',
    restaurantId: 'rest-004',
    authorName: 'Henry',
    rating: 4,
    text: 'Great variety of vegetarian options and excellent naan bread.',
    createdAt: '2024-02-02T18:30:00.000Z',
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[seed] Starting seed...\n');

  // ── Restaurants ────────────────────────────────────────────────────────────
  console.log('[seed] Seeding restaurants...');
  const restaurants = await getRestaurantsContainer();

  for (const restaurant of RESTAURANTS) {
    await restaurants.items.upsert(restaurant);
    console.log(`  ✓  ${restaurant.id}  ${restaurant.name}  (${restaurant.city})`);
  }

  // ── Reviews ────────────────────────────────────────────────────────────────
  console.log('\n[seed] Seeding reviews...');
  const reviews = await getReviewsContainer();

  for (const review of REVIEWS) {
    await reviews.items.upsert(review);
    console.log(
      `  ✓  ${review.id}  ${review.authorName} → ${review.restaurantId}  (★${review.rating})`,
    );
  }

  console.log(
    `\n[seed] Done – upserted ${RESTAURANTS.length} restaurants and ${REVIEWS.length} reviews.`,
  );
  console.log('[seed] Safe to rerun: all writes use upsert with fixed ids.\n');
}

main().catch((err: unknown) => {
  console.error('[seed] Fatal error:', err);
  process.exit(1);
});
