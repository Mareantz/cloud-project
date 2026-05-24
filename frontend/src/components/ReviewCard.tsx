import { useState } from 'react';
import '../styles/global.css';
import StarRating from './StarRating';

interface ReviewCardProps {
  id: string;
  author: string;
  rating: number;
  body: string;
  createdAt: string;
  imageUrl?: string;
  thumbnailUrl?: string;
}

function getInitials(author: string): string {
  const words = author.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  if (words.length === 1) {
    return words[0].slice(0, 1).toUpperCase();
  }
  return `${words[0].slice(0, 1)}${words[words.length - 1].slice(0, 1)}`.toUpperCase();
}

function formatDate(createdAt: string): string {
  try {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) {
      return createdAt;
    }
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return createdAt;
  }
}

function ReviewCard({ id, author, rating, body, createdAt, imageUrl, thumbnailUrl }: ReviewCardProps) {
  const initials = getInitials(author);
  const formattedDate = formatDate(createdAt);

  // Start with the thumbnail when available; fall back to the original on error.
  const initialSrc = thumbnailUrl ?? imageUrl;
  const [imageSrc, setImageSrc] = useState(initialSrc);

  // The link always opens the full-size original image.
  const imageHref = imageUrl ?? imageSrc;

  // When the thumbnail is not yet ready (broken load), swap to the original.
  function handleImageError() {
    if (imageUrl && imageSrc !== imageUrl) {
      setImageSrc(imageUrl);
    }
  }

  return (
    <div className="review-card" data-review-id={id}>
      <div className="review-card__header">
        <div className="flex items-center gap-3">
          <div className="review-card__avatar" aria-hidden="true">
            {initials}
          </div>
          <div className="review-card__author-block">
            <p className="review-card__author">{author}</p>
            <p className="review-card__date">{formattedDate}</p>
          </div>
        </div>
        <StarRating size="sm" value={rating} label={`${author} rating`} />
      </div>
      <p className="review-card__body">{body}</p>
      {imageSrc && imageHref ? (
        <a href={imageHref} target="_blank" rel="noopener noreferrer" className="review-card__image-link">
          <img
            src={imageSrc}
            alt={`Review photo by ${author}`}
            className="review-card__thumbnail"
            onError={handleImageError}
          />
        </a>
      ) : null}
    </div>
  );
}

export type { ReviewCardProps };
export default ReviewCard;
