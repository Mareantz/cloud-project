import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import { SqlQuerySpec } from '@azure/cosmos';

import {
  getRestaurantsContainer,
  getReviewsContainer,
} from '../../shared/cosmosClient';
import { Restaurant, Review } from '../../shared/types';
import { trackException } from '../../shared/telemetry';

export async function getReviewsHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const restaurantId = request.params.id?.trim();
  context.log(
    `Get reviews – method=${request.method} url=${request.url} restaurantId=${restaurantId}`,
  );

  try {
    if (!restaurantId) {
      return {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: 'Restaurant with id "" not found.' },
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

    if (restaurants.length === 0) {
      return {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: `Restaurant with id "${restaurantId}" not found.` },
      };
    }

    const reviewsContainer = await getReviewsContainer();
    const reviewsQuery: SqlQuerySpec = {
      query:
        'SELECT * FROM c WHERE c.restaurantId = @restaurantId ORDER BY c.createdAt DESC',
      parameters: [{ name: '@restaurantId', value: restaurantId }],
    };
    const { resources: reviews } = await reviewsContainer
      .items.query<Review>(reviewsQuery, { partitionKey: restaurantId })
      .fetchAll();

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: { data: reviews },
    };
  } catch (error: unknown) {
    context.error(`Failed to fetch reviews for restaurant "${restaurantId ?? ''}".`, error);
    trackException(error, { function: 'getReviews', restaurantId: restaurantId ?? '' });
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: { error: 'Failed to fetch reviews.' },
    };
  }
}

app.http('getReviews', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'restaurants/{id}/reviews',
  handler: getReviewsHandler,
});
