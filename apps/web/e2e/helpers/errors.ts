import type { Page } from '@playwright/test';

/**
 * Collects JavaScript errors from a page.
 * Must be called BEFORE navigating to the page.
 */
export class JSErrorCollector {
  private errors: string[] = [];
  private handler: (error: Error) => void;

  constructor(private page: Page) {
    this.handler = (error: Error) => this.errors.push(error.message);
    this.page.on('pageerror', this.handler);
  }

  /** Get all collected errors */
  getErrors(): string[] {
    return [...this.errors];
  }

  /** Get errors matching a filter */
  getErrorsMatching(...patterns: string[]): string[] {
    return this.errors.filter((e) =>
      patterns.some((pattern) => e.includes(pattern)),
    );
  }

  /** Assert no critical JS errors occurred (TypeError, ReferenceError) */
  expectNoCriticalErrors(): void {
    const critical = this.errors.filter(
      (e) => e.includes('TypeError') || e.includes('ReferenceError'),
    );
    if (critical.length > 0) {
      throw new Error(
        `Critical JavaScript errors detected:\n${critical.join('\n')}`,
      );
    }
  }

  /** Assert no JS errors at all */
  expectNoErrors(): void {
    if (this.errors.length > 0) {
      throw new Error(
        `JavaScript errors detected:\n${this.errors.join('\n')}`,
      );
    }
  }

  /** Stop collecting and clean up the listener */
  dispose(): void {
    this.page.off('pageerror', this.handler);
  }

  /** Reset collected errors */
  clear(): void {
    this.errors = [];
  }
}