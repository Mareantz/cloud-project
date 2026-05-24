import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import { SqlQuerySpec } from '@azure/cosmos';

import { getRestaurantsContainer } from '../../shared/cosmosClient';
import { Restaurant } from '../../shared/types';
import { trackException } from '../../shared/telemetry';

export async function getRestaurantByIdHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const id = request.params.id?.trim();
  context.log(
    `Get restaurant by id – method=${request.method} url=${request.url} id=${id}`,
  );

  try {
    if (!id) {
      return {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: 'Restaurant with id "" not found.' },
      };
    }

    const container = await getRestaurantsContainer();
    const querySpec: SqlQuerySpec = {
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: id }],
    };

    const { resources } = await container.items.query<Restaurant>(querySpec).fetchAll();
    const restaurant = resources[0];

    if (!restaurant) {
      return {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: `Restaurant with id "${id}" not found.` },
      };
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: { data: restaurant },
    };
  } catch (error: unknown) {
    context.error(`Failed to fetch restaurant with id "${id ?? ''}".`, error);
    trackException(error, { function: 'getRestaurantById', restaurantId: id ?? '' });
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: { error: 'Failed to fetch restaurant.' },
    };
  }
}

app.http('getRestaurantById', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'restaurants/{id}',
  handler: getRestaurantByIdHandler,
});
