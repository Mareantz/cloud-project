// Restaurant detail page — shows a single restaurant with its reviews and a
// review submission form.
//
// Data is loaded in parallel: restaurant and reviews are two independent
// fetches so a slow reviews query doesn't block the restaurant header from
// rendering.  After a review is submitted, both are re-fetched so that the
// displayed averageRating and review list are always fresh.

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import Navbar from '../components/Navbar';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import ReviewCard from '../components/ReviewCard';
import ReviewForm from '../components/ReviewForm';
import StarRating from '../components/StarRating';
import { ReviewFormValues } from '../components/ReviewForm';
import {
  getRestaurantById,
  getReviews,
  createReview,
  Restaurant,
  Review,
  ApiError,
} from '../services/api';

function RestaurantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // ── Restaurant state ────────────────────────────────────────────────────────
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [restaurantLoading, setRestaurantLoading] = useState(true);
  const [restaurantError, setRestaurantError] = useState<string | null>(null);

  // ── Reviews state ───────────────────────────────────────────────────────────
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsError, setReviewsError] = useState<string | null>(null);

  // ── Review form state ───────────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // ── Data fetchers ───────────────────────────────────────────────────────────

  const fetchRestaurant = useCallback(async () => {
    if (!id) return;
    setRestaurantLoading(true);
    setRestaurantError(null);
    try {
      const data = await getRestaurantById(id);
      setRestaurant(data);
    } catch (err) {
      setRestaurantError(
        err instanceof ApiError ? err.message : 'Failed to load restaurant.',
      );
    } finally {
      setRestaurantLoading(false);
    }
  }, [id]);

  const fetchReviews = useCallback(async () => {
    if (!id) return;
    setReviewsLoading(true);
    setReviewsError(null);
    try {
      const data = await getReviews(id);
      setReviews(data);
    } catch (err) {
      setReviewsError(
        err instanceof ApiError ? err.message : 'Failed to load reviews.',
      );
    } finally {
      setReviewsLoading(false);
    }
  }, [id]);

  // Kick off both fetches in parallel on mount (or when id changes).
  useEffect(() => {
    fetchRestaurant();
    fetchReviews();
  }, [fetchRestaurant, fetchReviews]);

  // ── Review submission ───────────────────────────────────────────────────────

  // ReviewForm calls onSubmit with { author, rating, body }.
  // The API expects { authorName, rating, text } — map the fields here.
  const handleReviewSubmit = async (values: ReviewFormValues) => {
    if (!id) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);
    try {
      await createReview(id, {
        authorName: values.author,
        rating: values.rating,
        text: values.body,
        ...(values.imageUrl ? { imageUrl: values.imageUrl } : {}),
        ...(values.thumbnailUrl ? { thumbnailUrl: values.thumbnailUrl } : {}),
      });
      setSubmitSuccess(true);
      // Re-fetch both so averageRating and review list are up to date.
      await Promise.all([fetchRestaurant(), fetchReviews()]);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : 'Failed to submit review.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Guard against a missing :id param (shouldn't happen with React Router but
  // keeps TypeScript happy and avoids a blank screen).
  if (!id) {
    return (
      <ErrorMessage
        title="Invalid URL"
        detail="No restaurant ID was provided in the URL."
      />
    );
  }

  return (
    <>
      <Navbar onAddRestaurant={() => navigate('/add')} />

      <main className="page-content">
        <div className="container--narrow">
          {/* Back navigation */}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate('/')}
            style={{ marginBottom: 'var(--space-6)' }}
          >
            ← Back to restaurants
          </button>

          {/* ── Restaurant header ─────────────────────────────────────────── */}
          {restaurantLoading && <LoadingSpinner message="Loading restaurant…" fullPage />}

          {!restaurantLoading && restaurantError !== null && (
            <ErrorMessage
              title="Could not load restaurant"
              detail={restaurantError}
              onRetry={fetchRestaurant}
            />
          )}

          {!restaurantLoading && restaurantError === null && restaurant !== null && (
            <section style={{ marginBottom: 'var(--space-8)' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 'var(--space-4)',
                  marginBottom: 'var(--space-4)',
                }}
              >
                {/* Name, cuisine badge, address */}
                <div>
                  <h1
                    style={{
                      fontSize: 'var(--font-size-3xl)',
                      fontWeight: 'var(--font-weight-bold)',
                      lineHeight: 'var(--line-height-tight)',
                      marginBottom: 'var(--space-3)',
                    }}
                  >
                    {restaurant.name}
                  </h1>
                  <div
                    style={{
                      display: 'flex',
                      gap: 'var(--space-3)',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    <span className="badge badge--cuisine">{restaurant.cuisine}</span>
                    <span className="text-secondary text-sm">
                      📍 {restaurant.address}, {restaurant.city}
                    </span>
                  </div>
                </div>

                {/* Rating summary */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: 'var(--space-1)',
                  }}
                >
                  {restaurant.averageRating > 0 ? (
                    <>
                      <StarRating
                        value={restaurant.averageRating}
                        showValue
                        size="lg"
                        label="Average rating"
                      />
                      <span className="text-muted text-xs">
                        {reviews.length} review{reviews.length !== 1 ? 's' : ''}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted text-sm">No ratings yet</span>
                  )}
                </div>
              </div>
            </section>
          )}

          <hr className="divider" />

          {/* ── Review form ───────────────────────────────────────────────── */}
          {/* Only render the form once the restaurant has loaded successfully. */}
          {restaurant !== null && (
            <section style={{ marginBottom: 'var(--space-8)' }}>
              <h2
                style={{
                  fontSize: 'var(--font-size-xl)',
                  fontWeight: 'var(--font-weight-semibold)',
                  marginBottom: 'var(--space-5)',
                }}
              >
                Write a Review
              </h2>

              {submitSuccess && (
                <p
                  style={{
                    color: 'var(--color-success)',
                    fontWeight: 'var(--font-weight-medium)',
                    marginBottom: 'var(--space-4)',
                  }}
                >
                  ✅ Your review has been posted!
                </p>
              )}

              {submitError !== null && (
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <ErrorMessage title="Could not post review" detail={submitError} />
                </div>
              )}

              <ReviewForm
                restaurantName={restaurant.name}
                onSubmit={handleReviewSubmit}
                isSubmitting={isSubmitting}
              />
            </section>
          )}

          <hr className="divider" />

          {/* ── Reviews list ──────────────────────────────────────────────── */}
          <section>
            <h2
              style={{
                fontSize: 'var(--font-size-xl)',
                fontWeight: 'var(--font-weight-semibold)',
                marginBottom: 'var(--space-5)',
              }}
            >
              Reviews
            </h2>

            {reviewsLoading && <LoadingSpinner message="Loading reviews…" />}

            {!reviewsLoading && reviewsError !== null && (
              <ErrorMessage
                title="Could not load reviews"
                detail={reviewsError}
                onRetry={fetchReviews}
              />
            )}

            {!reviewsLoading && reviewsError === null && reviews.length === 0 && (
              <div className="empty-state">
                <p className="empty-state__icon">📝</p>
                <p className="empty-state__title">No reviews yet</p>
                <p className="empty-state__description">
                  Be the first to share your experience!
                </p>
              </div>
            )}

            {/* ReviewCard expects author/body; API returns authorName/text. */}
            {!reviewsLoading && reviewsError === null && reviews.length > 0 && (
              <div className="card">
                {reviews.map((review) => (
                  <ReviewCard
                    key={review.id}
                    id={review.id}
                    author={review.authorName}
                    rating={review.rating}
                    body={review.text}
                    createdAt={review.createdAt}
                    imageUrl={review.imageUrl}
                    thumbnailUrl={review.thumbnailUrl}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

export default RestaurantDetailPage;
