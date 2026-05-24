import { useState } from 'react';
import '../styles/global.css';

interface StarRatingProps {
  /** The current rating value (1-5). Use 0 for no rating. */
  value: number;
  /** If true, the component renders clickable stars for user input. */
  interactive?: boolean;
  /** Called with the new rating when the user clicks a star (interactive mode). */
  onChange?: (rating: number) => void;
  /** 'sm' | 'md' | 'lg' — controls star size. Defaults to 'md'. */
  size?: 'sm' | 'md' | 'lg';
  /** If true, renders the numeric value label alongside the stars. */
  showValue?: boolean;
  /** Accessible label prefix, e.g. "Rating:" */
  label?: string;
}

function StarRating({
  value,
  interactive = false,
  onChange,
  size = 'md',
  showValue = false,
  label = 'Rating',
}: StarRatingProps) {
  const [hoverValue, setHoverValue] = useState(0);
  const displayValue = interactive && hoverValue > 0 ? hoverValue : value;
  const sizeClass = size === 'sm' ? 'star-rating--sm' : size === 'lg' ? 'star-rating--lg' : '';

  const handleSelect = (rating: number) => {
    if (!interactive || !onChange) {
      return;
    }

    onChange(rating);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>, rating: number) => {
    if (!interactive) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect(rating);
    }
  };

  return (
    <div className={`star-rating ${sizeClass}`.trim()} role="group" aria-label={label}>
      <div className="star-rating__stars">
        {[1, 2, 3, 4, 5].map((starValue) => {
          const isFilled = starValue <= displayValue;
          return (
            <span
              key={starValue}
              className={[
                'star-rating__star',
                interactive ? 'star-rating__star--interactive' : '',
                isFilled ? 'star-rating__star--filled' : 'star-rating__star--empty',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseEnter={interactive ? () => setHoverValue(starValue) : undefined}
              onClick={interactive ? () => handleSelect(starValue) : undefined}
              onKeyDown={interactive ? (event) => handleKeyDown(event, starValue) : undefined}
              onMouseLeave={interactive ? () => setHoverValue(0) : undefined}
              role={interactive ? 'radio' : undefined}
              aria-checked={interactive ? value === starValue : undefined}
              aria-label={interactive ? `${label} ${starValue} out of 5` : undefined}
              tabIndex={interactive ? 0 : -1}
            >
              ★
            </span>
          );
        })}
      </div>
      {showValue && value > 0 && <span className="star-rating__value">{value.toFixed(1)}</span>}
    </div>
  );
}

export type { StarRatingProps };
export default StarRating;
