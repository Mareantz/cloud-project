// Add restaurant page — collects restaurant details and submits to the API.
//
// RestaurantForm captures name, cuisine, address, description, and an optional
// photo file. This page also collects city (the Cosmos partition key) above
// the shared form.
//
// Submit sequence:
//   1. If a photo file was selected, POST it to /api/upload-photo → get URL.
//   2. POST restaurant data (+ optional photoUrl) to /api/restaurants.
//   3. Navigate to the new restaurant's detail page.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Navbar from '../components/Navbar';
import RestaurantForm from '../components/RestaurantForm';
import ErrorMessage from '../components/ErrorMessage';
import { RestaurantFormValues } from '../components/RestaurantForm';
import { createRestaurant, uploadPhoto, ApiError } from '../services/api';

function AddRestaurantPage() {
  const navigate = useNavigate();

  const [city, setCity] = useState('');
  const [cityTouched, setCityTouched] = useState(false);
  const cityError = cityTouched && city.trim().length === 0;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Called by RestaurantForm when its internal validation passes.
  const handleFormSubmit = async (values: RestaurantFormValues) => {
    setCityTouched(true);
    if (city.trim().length === 0) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Step 1: upload photo if one was provided.
      let photoUrl: string | undefined;
      if (values.photoFile !== null) {
        photoUrl = await uploadPhoto(values.photoFile);
      }

      // Step 2: create the restaurant record.
      const restaurant = await createRestaurant({
        name: values.name,
        cuisine: values.cuisine,
        address: values.address,
        city: city.trim(),
        ...(photoUrl !== undefined ? { photoUrl } : {}),
      });

      // Step 3: navigate to the detail page.
      navigate(`/restaurants/${restaurant.id}`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : 'Failed to create restaurant.',
      );
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Navbar />

      <main className="page-content">
        <div className="container--narrow">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate('/')}
            style={{ marginBottom: 'var(--space-6)' }}
          >
            ← Back to restaurants
          </button>

          <h1
            style={{
              fontSize: 'var(--font-size-3xl)',
              fontWeight: 'var(--font-weight-bold)',
              marginBottom: 'var(--space-2)',
            }}
          >
            Add a Restaurant
          </h1>
          <p className="text-secondary" style={{ marginBottom: 'var(--space-8)' }}>
            Share a great place to eat with the community.
          </p>

          {submitError !== null && (
            <div style={{ marginBottom: 'var(--space-6)' }}>
              <ErrorMessage title="Could not add restaurant" detail={submitError} />
            </div>
          )}

          <div className="form__group" style={{ marginBottom: 'var(--space-5)' }}>
            <label htmlFor="restaurant-city" className="form__label form__label--required">
              City
            </label>
            <input
              id="restaurant-city"
              type="text"
              className={`form__input${cityError ? ' form__input--error' : ''}`}
              placeholder="e.g. Amsterdam"
              value={city}
              onChange={(e) => {
                setCity(e.currentTarget.value);
                if (cityError && e.currentTarget.value.trim().length > 0) {
                  setCityTouched(false);
                }
              }}
              onBlur={() => setCityTouched(true)}
              aria-invalid={cityError}
            />
            {cityError && <p className="form__error-msg">City is required.</p>}
          </div>

          <RestaurantForm
            onSubmit={handleFormSubmit}
            onCancel={() => navigate('/')}
            isSubmitting={isSubmitting}
            submitLabel="Add Restaurant"
          />
        </div>
      </main>
    </>
  );
}

export default AddRestaurantPage;
