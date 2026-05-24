import '../styles/global.css';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
  fullPage?: boolean;
}

function LoadingSpinner({ size = 'md', message, fullPage = false }: LoadingSpinnerProps) {
  const spinnerClasses = size === 'sm' ? 'spinner spinner--sm' : size === 'lg' ? 'spinner spinner--lg' : 'spinner';

  const content = (
    <div className="loading-container">
      <div className={spinnerClasses} role="status" aria-label={message ?? 'Loading…'} />
      {message ? <p>{message}</p> : null}
    </div>
  );

  if (fullPage) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {content}
      </div>
    );
  }

  return content;
}

export type { LoadingSpinnerProps };
export default LoadingSpinner;
