/** @jsxImportSource preact */
import { h, Component, type ComponentChildren } from "preact";

interface ErrorBoundaryProps {
  fallbackLabel?: string;
  children?: ComponentChildren;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      const label = this.props.fallbackLabel || "Component";
      return (
        <div
          class="error-boundary-card"
          role="alert"
          style={{
            margin: "8px",
            padding: "16px",
            borderRadius: "8px",
            border: "1px solid var(--vscode-inputValidation-errorBorder, #be1100)",
            background: "var(--vscode-inputValidation-errorBackground, #5a1d1d)",
            color: "var(--vscode-errorForeground, #f48771)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "4px", fontSize: "13px" }}>
            {label} crashed
          </div>
          <div style={{ fontSize: "12px", opacity: 0.85, marginBottom: "12px", wordBreak: "break-word" }}>
            {this.state.error.message}
          </div>
          <button
            onClick={this.handleRetry}
            style={{
              padding: "4px 12px",
              borderRadius: "4px",
              border: "none",
              cursor: "pointer",
              fontSize: "12px",
              background: "var(--vscode-button-background, #0e639c)",
              color: "var(--vscode-button-foreground, #fff)",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
