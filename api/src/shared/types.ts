// ── Domain types for the Restaurant Reviews app ──────────────────────────────
// Keep these in sync with any shared types you expose to the frontend later.
// Plain interfaces are intentional – no class overhead, easy to serialize.

// ── Restaurant ────────────────────────────────────────────────────────────────

/**
 * A restaurant listed in the directory.
 *
 * Cosmos DB container: `restaurants`
 * Partition key:       `/city`
 *
 * Rationale: restaurants are naturally browsed and filtered by city, so
 * grouping documents by city keeps cross-partition fan-out minimal for the
 * most common "list restaurants in <city>" query without creating hot partitions.
 */
export interface Restaurant {
  /** Cosmos DB document id – a UUID generated at creation time. */
  id: string;
  name: string;
  /** Broad cuisine category, e.g. "Italian", "Japanese". */
  cuisine: string;
  /** Street address line. */
  address: string;
  /** City name; doubles as the partition key value. */
  city: string;
  /** Maintained by the API each time a review is written. Starts at 0. */
  averageRating: number;
  /** Total number of reviews; maintained by the API alongside averageRating. Starts at 0. */
  reviewCount: number;
  /** Optional URL to a hero/cover photo (Blob Storage URL in production). */
  photoUrl?: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

// ── Review ────────────────────────────────────────────────────────────────────

/**
 * A single anonymous review for a restaurant.
 *
 * Cosmos DB container: `reviews`
 * Partition key:       `/restaurantId`
 *
 * Rationale: all reviews for a given restaurant live in the same partition,
 * making "fetch all reviews for restaurant X" a cheap single-partition query.
 */
export interface Review {
  /** Cosmos DB document id – a UUID generated at creation time. */
  id: string;
  /** Foreign key referencing `Restaurant.id`; also the partition key. */
  restaurantId: string;
  /** Display name supplied by the reviewer (no auth yet). */
  authorName: string;
  /** Integer rating from 1 (worst) to 5 (best) inclusive. */
  rating: number;
  /** Free-form review text. */
  text: string;
  /**
   * Public URL of the original image uploaded with this review.
   * Stored in the `review-images` Blob container.
   * Populated after upload; absent when no image was attached.
   */
  imageUrl?: string;
  /**
   * Public URL of the auto-generated thumbnail for this review's image.
   * Written by the thumbnail-generation function (Phase 2) after it processes
   * the original image from the queue. Absent until processing is complete.
   */
  thumbnailUrl?: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

// ── Input shapes ──────────────────────────────────────────────────────────────
// Used by HTTP function handlers when parsing request bodies.
// The API is responsible for generating id, createdAt, and computed fields.

/** Fields the caller must supply when creating a new restaurant. */
export type CreateRestaurantInput = Omit<Restaurant, 'id' | 'averageRating' | 'reviewCount' | 'createdAt'>;

/** Fields the caller must supply when creating a new review. */
export type CreateReviewInput = Omit<Review, 'id' | 'createdAt'>;

// ── API envelope ──────────────────────────────────────────────────────────────

/**
 * Standard JSON envelope returned by every HTTP function.
 *
 * Success:  { data: T }
 * Failure:  { error: "Human-readable message" }
 */
export interface ApiResponse<T> {
  data?: T;
  error?: string;
}
