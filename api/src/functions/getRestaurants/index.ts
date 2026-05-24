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

export async function getRestaurantsHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log(`Get restaurants – method=${request.method} url=${request.url}`);

  try {
    const city = request.query.get('city')?.trim();
    const cuisine = request.query.get('cuisine')?.trim();

    const conditions: string[] = [];
    const parameters: { name: string; value: string }[] = [];

    if (city) {
      conditions.push('c.city = @city');
      parameters.push({ name: '@city', value: city });
    }

    if (cuisine) {
      conditions.push('c.cuisine = @cuisine');
      parameters.push({ name: '@cuisine', value: cuisine });
    }

    const whereClause =
      conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const querySpec: SqlQuerySpec = {
      query: `SELECT * FROM c${whereClause} ORDER BY c.name ASC`,
      parameters,
    };

    const queryOptions = city ? { partitionKey: city } : {};
    const container = await getRestaurantsContainer();
    const { resources } = await container
      .items.query<Restaurant>(querySpec, queryOptions)
      .fetchAll();

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: { data: resources },
    };
  } catch (error: unknown) {
    context.error('Failed to fetch restaurants.', error);
    trackException(error, { function: 'getRestaurants' });
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: { error: 'Failed to fetch restaurants.' },
    };
  }
}

app.http('getRestaurants', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'restaurants',
  handler: getRestaurantsHandler,
});
