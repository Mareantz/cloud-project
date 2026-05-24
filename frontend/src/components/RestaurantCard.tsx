import '../styles/global.css';
import StarRating from './StarRating';

interface RestaurantCardProps {
  id: string;
  name: string;
  cuisine: string;
  address: string;
  description?: string;
  averageRating: number;
  reviewCount: number;
  onClick?: (id: string) => void;
}

function RestaurantCard({
  id,
  name,
  cuisine,
  address,
  description,
  averageRating,
  reviewCount,
  onClick,
}: RestaurantCardProps) {
  const handleClick = () => {
    onClick?.(id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      className="card restaurant-card"
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick ? handleClick : undefined}
      onKeyDown={handleKeyDown}
      aria-label={onClick ? `View details for ${name}` : undefined}
    >
      <div className="restaurant-card__header">
        <h2 className="restaurant-card__title">{name}</h2>
        <div className="restaurant-card__meta">
          <span className="badge badge--cuisine">{cuisine}</span>
          {averageRating === 0 ? (
            <span className="text-muted text-sm">No ratings yet</span>
          ) : (
            <StarRating value={averageRating} showValue size="sm" label={`${name} rating`} />
          )}
        </div>
      </div>

      {description ? (
        <div className="restaurant-card__body">
          <p className="restaurant-card__description">{description}</p>
        </div>
      ) : null}

      <div className="restaurant-card__footer">
        <p className="restaurant-card__address">
          <span aria-hidden="true">📍</span>
          <span>{address}</span>
        </p>
        <span className="badge badge--count">
          {reviewCount} review{reviewCount === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

export type { RestaurantCardProps };
export default RestaurantCard;
