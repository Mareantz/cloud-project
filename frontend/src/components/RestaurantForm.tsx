import { useState, useEffect } from 'react';
import '../styles/global.css';

interface RestaurantFormValues {
  name: string;
  cuisine: string;
  address: string;
  description: string;
  photoFile: File | null;
}

interface RestaurantFormProps {
  initialValues?: Partial<Omit<RestaurantFormValues, 'photoFile'>>;
  onSubmit: (values: RestaurantFormValues) => void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
}

function RestaurantForm({
  initialValues,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel = 'Save Restaurant',
}: RestaurantFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '');
  const [cuisine, setCuisine] = useState(initialValues?.cuisine ?? '');
  const [address, setAddress] = useState(initialValues?.address ?? '');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const nameError = submitAttempted && name.trim().length === 0;
  const cuisineError = submitAttempted && cuisine.trim().length === 0;
  const addressError = submitAttempted && address.trim().length === 0;

  // Keep the object URL in sync with the selected file and revoke stale URLs.
  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    setPhotoFile(file);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitAttempted(true);

    if (name.trim().length === 0 || cuisine.trim().length === 0 || address.trim().length === 0) {
      return;
    }

    onSubmit({
      name: name.trim(),
      cuisine: cuisine.trim(),
      address: address.trim(),
      description: description.trim(),
      photoFile,
    });
  };

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <div className="form__group">
        <label htmlFor="restaurant-name" className="form__label form__label--required">
          Name
        </label>
        <input
          id="restaurant-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          className={`form__input ${nameError ? 'form__input--error' : ''}`.trim()}
          placeholder="e.g., Ember & Oak"
          required
          aria-invalid={nameError}
        />
        {nameError ? <p className="form__error-msg">Restaurant name is required.</p> : null}
      </div>

      <div className="form__row">
        <div className="form__group">
          <label htmlFor="restaurant-cuisine" className="form__label form__label--required">
            Cuisine
          </label>
          <input
            id="restaurant-cuisine"
            type="text"
            value={cuisine}
            onChange={(event) => setCuisine(event.currentTarget.value)}
            className={`form__input ${cuisineError ? 'form__input--error' : ''}`.trim()}
            placeholder="e.g., Italian"
            required
            aria-invalid={cuisineError}
          />
          {cuisineError ? <p className="form__error-msg">Cuisine is required.</p> : null}
        </div>

        <div className="form__group">
          <label htmlFor="restaurant-address" className="form__label form__label--required">
            Address
          </label>
          <input
            id="restaurant-address"
            type="text"
            value={address}
            onChange={(event) => setAddress(event.currentTarget.value)}
            className={`form__input ${addressError ? 'form__input--error' : ''}`.trim()}
            placeholder="Street, City"
            required
            aria-invalid={addressError}
          />
          {addressError ? <p className="form__error-msg">Address is required.</p> : null}
        </div>
      </div>

      <div className="form__group">
        <label htmlFor="restaurant-description" className="form__label">
          Description
        </label>
        <textarea
          id="restaurant-description"
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
          className="form__textarea"
          placeholder="Tell people what makes this place special..."
        />
        <p className="form__hint">A short description shown on the restaurant card</p>
      </div>

      <div className="form__group">
        <label htmlFor="restaurant-photo" className="form__label">
          Photo <span className="form__hint" style={{ display: 'inline', marginLeft: 'var(--space-2)' }}>(optional)</span>
        </label>
        <input
          id="restaurant-photo"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handlePhotoChange}
          className="form__input"
          style={{ paddingTop: 'var(--space-2)', paddingBottom: 'var(--space-2)' }}
          disabled={isSubmitting}
        />
        {photoPreviewUrl !== null ? (
          <img
            src={photoPreviewUrl}
            alt="Photo preview"
            style={{
              marginTop: 'var(--space-3)',
              maxHeight: '180px',
              maxWidth: '100%',
              borderRadius: 'var(--radius-md)',
              objectFit: 'cover',
              border: '1px solid var(--color-border)',
            }}
          />
        ) : null}
        <p className="form__hint">JPEG, PNG, WebP or GIF · max 5 MB</p>
      </div>

      <div className="form__actions">
        {onCancel ? (
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="btn btn--primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

export type { RestaurantFormProps, RestaurantFormValues };
export default RestaurantForm;
