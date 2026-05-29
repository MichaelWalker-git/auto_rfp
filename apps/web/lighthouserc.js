module.exports = {
  ci: {
    collect: {
      // When running in CI, the server is already started separately
      // When running locally with `pnpm lighthouse`, it will use startServerCommand
      // Note: staticDistDir is removed because Next.js uses a server, not static files
      url: ['http://localhost:3000'],
      numberOfRuns: 3,
      settings: {
        // Only run accessibility and best practices for faster CI
        onlyCategories: ['accessibility', 'best-practices'],
        // Skip categories that require network (performance varies too much in CI)
        // onlyCategories: ['accessibility', 'best-practices', 'seo'],
      },
    },
    assert: {
      assertions: {
        // Accessibility assertions - WCAG 2.1 AA target
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['warn', { minScore: 0.8 }],

        // Specific accessibility audits
        'aria-allowed-attr': 'error',
        'aria-hidden-body': 'error',
        'aria-hidden-focus': 'error',
        'aria-required-attr': 'error',
        'aria-required-children': 'error',
        'aria-required-parent': 'error',
        'aria-roles': 'error',
        'aria-valid-attr-value': 'error',
        'aria-valid-attr': 'error',
        'button-name': 'error',
        'bypass': 'warn',
        'color-contrast': 'error',
        'document-title': 'error',
        // 'duplicate-id-active' was deprecated in Lighthouse 11+
        'duplicate-id-aria': 'error',
        'form-field-multiple-labels': 'warn',
        'frame-title': 'error',
        'html-has-lang': 'error',
        'html-lang-valid': 'error',
        'image-alt': 'error',
        'input-image-alt': 'error',
        'label': 'error',
        'link-name': 'error',
        'list': 'warn',
        'listitem': 'warn',
        'meta-refresh': 'error',
        'meta-viewport': 'error',
        'object-alt': 'error',
        'tabindex': 'warn',
        'td-headers-attr': 'warn',
        'th-has-data-cells': 'warn',
        'valid-lang': 'error',
        'video-caption': 'error',
      },
    },
    upload: {
      // Temporary local storage for reports
      target: 'temporary-public-storage',
    },
  },
};
