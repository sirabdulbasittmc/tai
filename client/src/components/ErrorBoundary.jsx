import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', background: '#1a1a1a', color: '#e8e8e0', fontFamily: 'inherit',
        }}>
          <div style={{
            maxWidth: 440, textAlign: 'center', padding: 32,
            background: '#222', borderRadius: 16, border: '1px solid #333',
          }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>Something went wrong</h2>
            <p style={{ color: '#888', fontSize: 14, marginBottom: 20 }}>
              An unexpected error occurred. Please refresh the page to continue.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 28px', fontSize: 14, fontWeight: 600,
                background: '#cc6b4a', color: '#fff', border: 'none',
                borderRadius: 8, cursor: 'pointer',
              }}
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
