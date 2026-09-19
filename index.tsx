import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

// Global error logger untuk mendeteksi error di browser HP
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    console.error('[SITA Global Error]:', event.message, event.error);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[SITA Unhandled Promise Rejection]:', event.reason);
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);