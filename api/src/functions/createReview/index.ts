import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import { SqlQuerySpec } from '@azure/cosmos';
import { randomUUID } from 'crypto';

import {
  getRestaurantsContainer,
  getReviewsContainer,
} from '../../shared/cosmosClient';
import { Restaurant, Review } from '../../shared/types';
import { requireFields, validateRating } from '../../shared/validation';
import { trackException, trackEvent } from '../../shared/telemetry';

export async function createReviewHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const restaurantId = request.params.id?.trim();
  context.log(
    `Create review – method=${request.method} url=${request.url} restaurantId=${restaurantId}`,
  );

  try {
    if (!restaurantId) {
      return {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: 'Restaurant with id "" not found.' },
      };
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch (error: unknown) {
      context.error('Failed to parse create review request body.', error);
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: 'Request body must be valid JSON.' },
      };
    }

    if (typeof body !== 'object' || body === null) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: 'Request body must be a JSON object.' },
      };
    }

    const input = body as Record<string, unknown>;
    const required = requireFields(input, ['authorName', 'text']);
    if (!required.valid) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: required.message ?? 'Missing required fields.' },
      };
    }

    const ratingCheck = validateRating(input.rating);
    if (!ratingCheck.valid) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: ratingCheck.message ?? 'Invalid rating value.' },
      };
    }

    const restaurantsContainer = await getRestaurantsContainer();
    const restaurantQuery: SqlQuerySpec = {
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: restaurantId }],
    };
    const { resources: restaurants } = await restaurantsContainer
      .items.query<Restaurant>(restaurantQuery)
      .fetchAll();
    const restaurant = restaurants[0];

    if (!restaurant) {
      return {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: `Restaurant with id "${restaurantId}" not found.` },
      };
    }

    // Validate optional image URL fields – must be strings when present.
    if (input.imageUrl !== undefined && typeof input.imageUrl !== 'string') {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: 'imageUrl must be a string.' },
      };
    }
    if (input.thumbnailUrl !== undefined && typeof input.thumbnailUrl !== 'string') {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: 'thumbnailUrl must be a string.' },
      };
    }

    // Normalise: treat blank strings the same as omitted so documents stay
    // clean and callers can pass an empty string without side-effects.
    const imageUrl =
      typeof input.imageUrl === 'string' && input.imageUrl.trim() !== ''
        ? input.imageUrl.trim()
        : undefined;
    const thumbnailUrl =
      typeof input.thumbnailUrl === 'string' && input.thumbnailUrl.trim() !== ''
        ? input.thumbnailUrl.trim()
        : undefined;

    const now = new Date().toISOString();
    const review: Review = {
      id: randomUUID(),
      restaurantId,
      authorName: (input.authorName as string).trim(),
      rating: input.rating as number,
      text: (input.text as string).trim(),
      // Only include image fields in the document when they carry a value so
      // that reviews without images remain identical to the pre-existing shape.
      ...(imageUrl !== undefined && { imageUrl }),
      ...(thumbnailUrl !== undefined && { thumbnailUrl }),
      createdAt: now,
    };

    const reviewsContainer = await getReviewsContainer();
    const { resource: createdReview } = await reviewsContainer.items.create<Review>(review);

    const ratingsQuery: SqlQuerySpec = {
      query: 'SELECT VALUE c.rating FROM c WHERE c.restaurantId = @restaurantId',
      parameters: [{ name: '@restaurantId', value: restaurantId }],
    };
    const { resources: ratings } = await reviewsContainer
      .items.query<number>(ratingsQuery, { partitionKey: restaurantId })
      .fetchAll();

    const sum = ratings.reduce((accumulator, value) => accumulator + value, 0);
    const averageRating =
      ratings.length === 0 ? 0 : parseFloat((sum / ratings.length).toFixed(1));
    const reviewCount = ratings.length;

    await restaurantsContainer
      .item(restaurant.id, restaurant.city)
      .replace<Restaurant>({ ...restaurant, averageRating, reviewCount });

    trackEvent('review.created', {
      restaurantId,
      rating: String(review.rating),
    });

    return {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: { data: createdReview ?? review },
    };
  } catch (error: unknown) {
    context.error(`Failed to create review for restaurant "${restaurantId ?? ''}".`, error);
    trackException(error, { function: 'createReview', restaurantId: restaurantId ?? '' });
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: { error: 'Failed to create review.' },
    };
  }
}

app.http('createReview', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'restaurants/{id}/reviews',
  handler: createReviewHandler,
});
