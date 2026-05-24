import '../styles/global.css';

interface NavbarProps {
  onAddRestaurant?: () => void;
}

function Navbar({ onAddRestaurant }: NavbarProps) {
  return (
    <nav className="navbar" aria-label="Main navigation">
      <div className="navbar__inner">
        <a href="/" className="navbar__brand" aria-label="Restaurant Reviews home">
          <span className="navbar__logo">🍽️</span>
          <span className="navbar__brand-name">
            Resto<span>Reviews</span>
          </span>
        </a>
        <div className="navbar__actions">
          <a href="/" className="navbar__link">
            Restaurants
          </a>
          {onAddRestaurant ? (
            <button type="button" className="btn btn--primary btn--sm" onClick={onAddRestaurant}>
              + Add Restaurant
            </button>
          ) : null}
        </div>
      </div>
    </nav>
  );
}

export type { NavbarProps };
export default Navbar;
