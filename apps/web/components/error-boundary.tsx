'use client';

import * as Sentry from '@sentry/nextjs';
import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

/**
 * Client-side React Error Boundary that catches rendering errors
 * and reports them to Sentry. This complements Next.js's global-error.tsx
 * which only handles server-side errors.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);

    Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack ?? undefined,
        },
      },
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex items-center justify-center min-h-[50vh] p-4">
          <Card className="max-w-md w-full">
            <CardHeader>
              <CardTitle>Something went wrong</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                An unexpected error occurred. Our team has been notified and is working on a fix.
              </p>
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <pre className="text-xs bg-muted p-2 rounded mt-4 overflow-auto max-h-40">
                  {this.state.error.message}
                  {'\n'}
                  {this.state.error.stack}
                </pre>
              )}
            </CardContent>
            <CardFooter>
              <Button onClick={() => this.setState({ hasError: false, error: undefined })}>
                Try Again
              </Button>
              <Button
                variant="outline"
                className="ml-2"
                onClick={() => window.location.reload()}
              >
                Reload Page
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
