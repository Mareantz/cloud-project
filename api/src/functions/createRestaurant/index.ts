import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import { randomUUID } from 'crypto';

import { getRestaurantsContainer } from '../../shared/cosmosClient';
import { Restaurant } from '../../shared/types';
import { requireFields } from '../../shared/validation';
import { trackException, trackEvent } from '../../shared/telemetry';

export async function createRestaurantHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log(`Create restaurant – method=${request.method} url=${request.url}`);

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch (error: unknown) {
      context.error('Failed to parse create restaurant request body.', error);
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
    const required = requireFields(input, ['name', 'cuisine', 'address', 'city']);
    if (!required.valid) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: required.message ?? 'Missing required fields.' },
      };
    }

    const name = (input.name as string).trim();
    const cuisine = (input.cuisine as string).trim();
    const address = (input.address as string).trim();
    const city = (input.city as string).trim();

    let photoUrl: string | undefined;
    if (input.photoUrl !== undefined && input.photoUrl !== null) {
      if (typeof input.photoUrl !== 'string' || input.photoUrl.trim().length === 0) {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          jsonBody: {
            error: 'Field "photoUrl" must be a non-empty string when provided.',
          },
        };
      }
      photoUrl = input.photoUrl.trim();
    }

    const restaurant: Restaurant = {
      id: randomUUID(),
      name,
      cuisine,
      address,
      city,
      averageRating: 0,
      reviewCount: 0,
      createdAt: new Date().toISOString(),
      ...(photoUrl ? { photoUrl } : {}),
    };

    const container = await getRestaurantsContainer();
    const { resource } = await container.items.create<Restaurant>(restaurant);

    trackEvent('restaurant.created', { cuisine, city });

    return {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: { data: resource ?? restaurant },
    };
  } catch (error: unknown) {
    context.error('Failed to create restaurant.', error);
    trackException(error, { function: 'createRestaurant' });
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: { error: 'Failed to create restaurant.' },
    };
  }
}

app.http('createRestaurant', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'restaurants',
  handler: createRestaurantHandler,
});
