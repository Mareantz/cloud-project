import '../styles/global.css';

interface ErrorMessageProps {
  title?: string;
  detail?: string;
  onRetry?: () => void;
}

function ErrorMessage({ title, detail, onRetry }: ErrorMessageProps) {
  return (
    <div className="error-message" role="alert">
      <span className="error-message__icon" aria-hidden="true">
        ⚠️
      </span>
      <div className="error-message__body">
        <p className="error-message__title">{title ?? 'Something went wrong'}</p>
        {detail ? <p className="error-message__detail">{detail}</p> : null}
        {onRetry ? (
          <div className="error-message__retry">
            <button className="btn btn--sm btn--secondary" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type { ErrorMessageProps };
export default ErrorMessage;
