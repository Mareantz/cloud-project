import { useState } from 'react';
import '../styles/global.css';
import StarRating from './StarRating';
import { uploadReviewImage } from '../services/api';

interface ReviewFormValues {
  author: string;
  rating: number;
  body: string;
  imageUrl?: string;
  thumbnailUrl?: string;
}

interface ReviewFormProps {
  restaurantName?: string;
  onSubmit: (values: ReviewFormValues) => void | Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
}

function ReviewForm({ restaurantName, onSubmit, onCancel, isSubmitting = false }: ReviewFormProps) {
  const [author, setAuthor] = useState('');
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const authorError = submitAttempted && author.trim().length === 0;
  const ratingError = submitAttempted && rating === 0;
  const bodyError = submitAttempted && body.trim().length < 10;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitAttempted(true);
    setImageUploadError(null);

    if (author.trim().length === 0 || rating === 0 || body.trim().length < 10) {
      return;
    }

    let imageUrl: string | undefined;
    let thumbnailUrl: string | undefined;

    if (imageFile) {
      setIsUploading(true);
      try {
        const uploaded = await uploadReviewImage(imageFile);
        imageUrl = uploaded.imageUrl;
        thumbnailUrl = uploaded.thumbnailUrl;
      } catch {
        setImageUploadError('Image upload failed. Please try again.');
        return;
      } finally {
        setIsUploading(false);
      }
    }

    await onSubmit({
      author: author.trim(),
      rating,
      body: body.trim(),
      imageUrl,
      thumbnailUrl,
    });
  };

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      {restaurantName ? (
        <p className="text-secondary text-sm">
          Reviewing: <strong>{restaurantName}</strong>
        </p>
      ) : null}

      <div className="form__group">
        <label htmlFor="review-author" className="form__label form__label--required">
          Your Name
        </label>
        <input
          id="review-author"
          type="text"
          value={author}
          onChange={(event) => setAuthor(event.currentTarget.value)}
          className={`form__input ${authorError ? 'form__input--error' : ''}`.trim()}
          placeholder="e.g., Alex"
          required
          aria-invalid={authorError}
        />
        {authorError ? <p className="form__error-msg">Your name is required.</p> : null}
      </div>

      <div className="form__group">
        <label className="form__label form__label--required">Your Rating</label>
        <StarRating interactive size="lg" value={rating} onChange={setRating} label="Your rating" />
        {ratingError ? <p className="form__error-msg">Please select a rating.</p> : null}
      </div>

      <div className="form__group">
        <label htmlFor="review-body" className="form__label form__label--required">
          Review
        </label>
        <textarea
          id="review-body"
          value={body}
          onChange={(event) => setBody(event.currentTarget.value)}
          className={`form__textarea ${bodyError ? 'form__input--error' : ''}`.trim()}
          placeholder="Share your experience..."
          required
          aria-invalid={bodyError}
        />
        <p className="form__hint">Minimum 10 characters.</p>
        {bodyError ? (
          <p className="form__error-msg">Review text must be at least 10 characters.</p>
        ) : null}
      </div>

      <div className="form__group">
        <label htmlFor="review-photo" className="form__label">
          Photo (optional)
        </label>
        <input
          id="review-photo"
          type="file"
          accept="image/*"
          className="form__input"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            setImageFile(file);
            setImageUploadError(null);
          }}
        />
        <p className="form__hint">Attach an image to your review (JPG, PNG, WebP — max 5 MB).</p>
        {isUploading ? <p className="form__hint">Uploading image…</p> : null}
        {imageUploadError ? <p className="form__error-msg">{imageUploadError}</p> : null}
      </div>

      <div className="form__actions">
        {onCancel ? (
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="btn btn--primary" disabled={isSubmitting || isUploading}>
          {isSubmitting || isUploading ? 'Posting…' : 'Post Review'}
        </button>
      </div>
    </form>
  );
}

export type { ReviewFormProps, ReviewFormValues };
export default ReviewForm;
