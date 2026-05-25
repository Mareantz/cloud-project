// Typed API client for /api/* endpoints.
//
// All functions return typed data on success, or throw ApiError on any
// non-2xx response so callers can display consistent error messages.
// Local dev uses relative /api paths so the Vite proxy still works. In
// production, VITE_API_BASE_URL can point the frontend at a standalone
// Function App (for example: https://func-xyz.azurewebsites.net/api).

// ── Domain types (mirrored from api/src/shared/types.ts) ─────────────────────
// Keep in sync with the backend types by hand; no shared package needed for
// this student project.

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  address: string;
  city: string;
  averageRating: number;
  // Optional because older Cosmos documents written before this field was
  // added will not carry it; callers should fall back to 0.
  reviewCount?: number;
  photoUrl?: string;
  createdAt: string;
}

export interface Review {
  id: string;
  restaurantId: string;
  // Field name used by the API — callers map to UI props as needed.
  authorName: string;
  rating: number;
  // Field name used by the API — callers map to UI props as needed.
  text: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  createdAt: string;
}

// Fields the frontend supplies when creating a new restaurant.
// city is separate from address because the API uses it as the Cosmos
// partition key.
export interface CreateRestaurantInput {
  name: string;
  cuisine: string;
  address: string;
  city: string;
  photoUrl?: string;
}

// Fields the frontend supplies when creating a new review for a restaurant.
// restaurantId is passed as a URL parameter, not in this object.
export interface CreateReviewInput {
  authorName: string;
  rating: number;
  text: string;
  imageUrl?: string;
  thumbnailUrl?: string;
}

/** Returned by POST /api/upload-review-image. */
export interface UploadReviewImageResult {
  imageUrl: string;
  thumbnailUrl: string;
}

// ── Error class ───────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

// Standard response envelope returned by every API function.
interface ApiEnvelope<T> {
  data?: T;
  error?: string;
}

const configuredApiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL as string | undefined
)?.trim();

const apiBaseUrl =
  configuredApiBaseUrl && configuredApiBaseUrl !== '/'
    ? configuredApiBaseUrl.replace(/\/$/, '')
    : '';

function apiUrl(path: `/${string}`): string {
  return apiBaseUrl ? `${apiBaseUrl}${path}` : `/api${path}`;
}

// Parses the API envelope, throwing ApiError when the server signals failure.
async function parseResponse<T>(res: Response): Promise<T> {
  let json: ApiEnvelope<T>;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(res.status, `HTTP ${res.status}: response was not valid JSON`);
  }

  if (!res.ok || json.error) {
    throw new ApiError(res.status, json.error ?? `HTTP ${res.status}`);
  }

  if (json.data === undefined) {
    throw new ApiError(res.status, 'Server returned an empty response body');
  }

  return json.data;
}

// ── Restaurants ───────────────────────────────────────────────────────────────

export interface RestaurantFilters {
  city?: string;
  cuisine?: string;
}

/**
 * GET /api/restaurants?city=&cuisine=
 * Returns all restaurants, optionally filtered by city and/or cuisine.
 */
export async function getRestaurants(filters: RestaurantFilters = {}): Promise<Restaurant[]> {
  const params = new URLSearchParams();
  if (filters.city) params.set('city', filters.city);
  if (filters.cuisine) params.set('cuisine', filters.cuisine);

  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${apiUrl('/restaurants')}${query}`);
  return parseResponse<Restaurant[]>(res);
}

/**
 * GET /api/restaurants/:id
 * Returns a single restaurant by its ID.
 */
export async function getRestaurantById(id: string): Promise<Restaurant> {
  const res = await fetch(apiUrl(`/restaurants/${encodeURIComponent(id)}`));
  return parseResponse<Restaurant>(res);
}

/**
 * POST /api/restaurants
 * Creates a new restaurant and returns the saved document.
 */
export async function createRestaurant(input: CreateRestaurantInput): Promise<Restaurant> {
  const res = await fetch(apiUrl('/restaurants'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseResponse<Restaurant>(res);
}

/**
 * POST /api/upload-photo
 * Uploads a photo file to Blob Storage and returns its public URL.
 */
export async function uploadPhoto(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('photo', file);

  // Do NOT set Content-Type header — the browser must set it with the boundary.
  const res = await fetch(apiUrl('/upload-photo'), {
    method: 'POST',
    body: formData,
  });

  const data = await parseResponse<{ url: string }>(res);
  return data.url;
}

/**
 * POST /api/upload-review-image
 * Uploads a review image to the review-images Blob container.
 * Returns both the original imageUrl and the expected thumbnailUrl.
 * The thumbnail is generated asynchronously; thumbnailUrl will resolve
 * within seconds of the upload completing.
 */
export async function uploadReviewImage(file: File): Promise<UploadReviewImageResult> {
  const formData = new FormData();
  // Field name must match what the upload endpoint reads: formData.get('image')
  formData.append('image', file);
  // Do NOT set Content-Type header — browser must set it with boundary.
  const res = await fetch(apiUrl('/upload-review-image'), {
    method: 'POST',
    body: formData,
  });
  return parseResponse<UploadReviewImageResult>(res);
}
// ── Reviews ───────────────────────────────────────────────────────────────────

/**
 * GET /api/restaurants/:id/reviews
 * Returns all reviews for a restaurant, newest first.
 */
export async function getReviews(restaurantId: string): Promise<Review[]> {
  const res = await fetch(apiUrl(`/restaurants/${encodeURIComponent(restaurantId)}/reviews`));
  return parseResponse<Review[]>(res);
}

/**
 * POST /api/restaurants/:id/reviews
 * Creates a new review and returns the saved document.
 * The API also updates the restaurant's averageRating as a side effect.
 */
export async function createReview(
  restaurantId: string,
  input: CreateReviewInput,
): Promise<Review> {
  const res = await fetch(apiUrl(`/restaurants/${encodeURIComponent(restaurantId)}/reviews`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Include restaurantId in the body as required by the API schema.
    body: JSON.stringify({ restaurantId, ...input }),
  });
  return parseResponse<Review>(res);
}
