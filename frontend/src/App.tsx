// Root application component.
//
// Sets up client-side routing with React Router v6.  The BrowserRouter lives
// here so every page can use useNavigate and useParams without needing an
// extra provider wrapper in main.tsx.
//
// Routes
//   /                    → HomePage             (restaurant listing + filters)
//   /restaurants/:id     → RestaurantDetailPage (detail + reviews + review form)
//   /add                 → AddRestaurantPage    (create restaurant form)
//   /index.html          → redirect to /        (handles SWA direct-file hits)
//   *                    → NotFoundPage         (unknown paths)

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import HomePage from './pages/HomePage';
import RestaurantDetailPage from './pages/RestaurantDetailPage';
import AddRestaurantPage from './pages/AddRestaurantPage';

// Simple inline 404 page — no need for a dedicated file at this project scale.
function NotFoundPage() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '80vh',
        gap: '1rem',
        textAlign: 'center',
        padding: '0 1.5rem',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <p style={{ fontSize: '4rem', lineHeight: 1 }}>🍽️</p>
      <h1 style={{ fontSize: '1.875rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
        404 — Page Not Found
      </h1>
      <p style={{ color: 'var(--color-text-secondary)' }}>
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <a href="/" className="btn btn--primary" style={{ marginTop: '0.5rem' }}>
        Go to Home
      </a>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/restaurants/:id" element={<RestaurantDetailPage />} />
        <Route path="/add" element={<AddRestaurantPage />} />
        {/* Redirect /index.html to / so SWA never shows the raw HTML file URL. */}
        <Route path="/index.html" element={<Navigate to="/" replace />} />
        {/* Catch-all for unknown paths. */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
