// Home page — lists all restaurants with city and cuisine filters.
//
// On initial mount it loads every restaurant (no filters).
// Clicking Search re-fetches with the current filter values.
// Clicking a card navigates to /restaurants/:id.

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import Navbar from '../components/Navbar';
import RestaurantCard from '../components/RestaurantCard';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { getRestaurants, Restaurant, ApiError } from '../services/api';

function HomePage() {
  const navigate = useNavigate();

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Controlled filter fields. Values are trimmed before sending to the API.
  const [cityFilter, setCityFilter] = useState('');
  const [cuisineFilter, setCuisineFilter] = useState('');

  // Fetches restaurants using the supplied filter strings.
  // Empty strings are treated as "no filter" by the API.
  const fetchRestaurants = useCallback(async (city: string, cuisine: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRestaurants({
        city: city.trim() || undefined,
        cuisine: cuisine.trim() || undefined,
      });
      setRestaurants(data);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load restaurants.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load all restaurants when the page first mounts.
  useEffect(() => {
    fetchRestaurants('', '');
    // fetchRestaurants is stable (useCallback with no deps), so this is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchRestaurants(cityFilter, cuisineFilter);
  };

  const handleClearFilters = () => {
    setCityFilter('');
    setCuisineFilter('');
    fetchRestaurants('', '');
  };

  const hasActiveFilters = cityFilter.trim().length > 0 || cuisineFilter.trim().length > 0;

  return (
    <>
      <Navbar onAddRestaurant={() => navigate('/add')} />

      <main className="page-content">
        <div className="container">
          {/* Page header */}
          <section style={{ marginBottom: 'var(--space-8)' }}>
            <h1
              style={{
                fontSize: 'var(--font-size-3xl)',
                fontWeight: 'var(--font-weight-bold)',
                marginBottom: 'var(--space-2)',
              }}
            >
              Find a Restaurant
            </h1>
            <p className="text-secondary">
              Discover great places to eat, reviewed by your community.
            </p>
          </section>

          {/* Filter bar */}
          <form
            onSubmit={handleFilterSubmit}
            style={{
              display: 'flex',
              gap: 'var(--space-3)',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              marginBottom: 'var(--space-8)',
            }}
          >
            <div className="form__group" style={{ flex: '1 1 180px' }}>
              <label htmlFor="filter-city" className="form__label">
                City
              </label>
              <input
                id="filter-city"
                type="text"
                className="form__input"
                placeholder="e.g. Amsterdam"
                value={cityFilter}
                onChange={(e) => setCityFilter(e.currentTarget.value)}
              />
            </div>

            <div className="form__group" style={{ flex: '1 1 180px' }}>
              <label htmlFor="filter-cuisine" className="form__label">
                Cuisine
              </label>
              <input
                id="filter-cuisine"
                type="text"
                className="form__input"
                placeholder="e.g. Italian"
                value={cuisineFilter}
                onChange={(e) => setCuisineFilter(e.currentTarget.value)}
              />
            </div>

            <div
              style={{
                display: 'flex',
                gap: 'var(--space-2)',
                // Align buttons with inputs by matching the label's line-height offset.
                paddingBottom: 'var(--space-2)',
              }}
            >
              <button type="submit" className="btn btn--primary">
                Search
              </button>
              {hasActiveFilters && (
                <button type="button" className="btn btn--secondary" onClick={handleClearFilters}>
                  Clear
                </button>
              )}
            </div>
          </form>

          {/* Loading state */}
          {loading && <LoadingSpinner message="Loading restaurants…" fullPage />}

          {/* Error state */}
          {!loading && error !== null && (
            <ErrorMessage
              title="Could not load restaurants"
              detail={error}
              onRetry={() => fetchRestaurants(cityFilter, cuisineFilter)}
            />
          )}

          {/* Empty state */}
          {!loading && error === null && restaurants.length === 0 && (
            <div className="empty-state">
              <p className="empty-state__icon">🍽️</p>
              <p className="empty-state__title">No restaurants found</p>
              <p className="empty-state__description">
                {hasActiveFilters
                  ? 'Try a different city or cuisine, or clear the filters.'
                  : 'Be the first to add one!'}
              </p>
              <button className="btn btn--primary" onClick={() => navigate('/add')}>
                + Add Restaurant
              </button>
            </div>
          )}

          {/* Restaurant grid */}
          {!loading && error === null && restaurants.length > 0 && (
            <div className="grid-cards">
              {restaurants.map((restaurant) => (
                <RestaurantCard
                  key={restaurant.id}
                  id={restaurant.id}
                  name={restaurant.name}
                  cuisine={restaurant.cuisine}
                  // Combine address and city into a single display string since
                  // RestaurantCard has one address field but the API stores them
                  // separately.
                  address={`${restaurant.address}, ${restaurant.city}`}
                  averageRating={restaurant.averageRating}
                  // Fall back to 0 for older documents that predate the reviewCount field.
                  reviewCount={restaurant.reviewCount ?? 0}
                  onClick={(id) => navigate(`/restaurants/${id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

export default HomePage;
