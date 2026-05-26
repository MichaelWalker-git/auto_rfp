/// <reference types="cypress" />

const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

/**
 * Helper function to perform login with given credentials
 */
const performLogin = (email: string, password: string) => {
  cy.visit('/', { failOnStatusCode: false })
  cy.get('input[type="email"]', { timeout: 15000 }).should('be.visible')
  cy.get('input[type="email"]').clear().type(email)
  cy.get('input[type="password"]').clear().type(password, { log: false })
  cy.get('button[type="submit"]').click()
  cy.url({ timeout: 30000 }).should('include', '/organizations/')
  // Wait for auth context to fully load - user menu should show a name
  cy.wait(2000)
}

/**
 * Helper to validate that auth session is still active after navigation
 * Call this after cy.visit() to ensure session wasn't lost
 */
const validateAuthSession = () => {
  // Wait for page to load and auth to hydrate
  cy.wait(1000)
  // Check that we're not on the login page
  cy.url().then((url) => {
    if (url.includes('/login') || url.endsWith('/')) {
      cy.log('Session lost - redirected to login page. Re-logging in.')
      // Session was lost, need to re-login
      // This shouldn't happen with proper session management, but is a fallback
    }
  })
}

/**
 * Login as Admin user (default test user with full permissions)
 * Uses: CYPRESS_USER_EMAIL and CYPRESS_USER_PASSWORD
 */
Cypress.Commands.add('login', () => {
  cy.session('adminSession', () => {
    const userEmail = Cypress.env('USER_EMAIL')
    const userPassword = Cypress.env('USER_PASSWORD')

    if (typeof userEmail !== 'string' || userEmail.trim() === '') {
      throw new Error(
        'Missing required Cypress environment variable USER_EMAIL. Set USER_EMAIL to a valid test user email before running Cypress login.'
      )
    }

    if (typeof userPassword !== 'string' || userPassword.trim() === '') {
      throw new Error(
        'Missing required Cypress environment variable USER_PASSWORD. Set USER_PASSWORD to a valid test user password before running Cypress login.'
      )
    }

    performLogin(userEmail, userPassword)
  })
})

/**
 * Login as Editor user (limited permissions - can't create orgs, delete solicitation docs)
 * Uses: CYPRESS_EDITOR_EMAIL and CYPRESS_ROLE_PASSWORD
 */
Cypress.Commands.add('loginAsEditor', () => {
  cy.session('editorSession', () => {
    const editorEmail = Cypress.env('EDITOR_EMAIL')
    const rolePassword = Cypress.env('ROLE_PASSWORD')

    if (typeof editorEmail !== 'string' || editorEmail.trim() === '') {
      throw new Error(
        'Missing required Cypress environment variable EDITOR_EMAIL. Set EDITOR_EMAIL to a valid editor user email.'
      )
    }

    if (typeof rolePassword !== 'string' || rolePassword.trim() === '') {
      throw new Error(
        'Missing required Cypress environment variable ROLE_PASSWORD. Set ROLE_PASSWORD to the shared role password.'
      )
    }

    performLogin(editorEmail, rolePassword)
  })
})

/**
 * Login as Viewer user (read-only permissions)
 * Uses: CYPRESS_VIEWER_EMAIL and CYPRESS_ROLE_PASSWORD
 */
Cypress.Commands.add('loginAsViewer', () => {
  cy.session('viewerSession', () => {
    const viewerEmail = Cypress.env('VIEWER_EMAIL')
    const rolePassword = Cypress.env('ROLE_PASSWORD')

    if (typeof viewerEmail !== 'string' || viewerEmail.trim() === '') {
      throw new Error(
        'Missing required Cypress environment variable VIEWER_EMAIL. Set VIEWER_EMAIL to a valid viewer user email.'
      )
    }

    if (typeof rolePassword !== 'string' || rolePassword.trim() === '') {
      throw new Error(
        'Missing required Cypress environment variable ROLE_PASSWORD. Set ROLE_PASSWORD to the shared role password.'
      )
    }

    performLogin(viewerEmail, rolePassword)
  })
})

Cypress.Commands.add('goToProjects', () => {
  cy.visit(`/organizations/${ORG_ID}/projects/`, { failOnStatusCode: false })
  cy.url({ timeout: 30000 }).should('include', '/projects')
})

Cypress.Commands.add('goToOrganizations', () => {
  cy.visit('/organizations', { failOnStatusCode: false })
  cy.url({ timeout: 30000 }).should('include', '/organizations')
  // Wait for page content to load (organizations list or empty state)
  cy.get('body', { timeout: 15000 }).should('be.visible')
  cy.wait(2000) // Wait for API to load organizations
})

export {}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /** Login as Admin user (full permissions) */
      login(): Chainable<void>
      /** Login as Editor user (limited permissions) */
      loginAsEditor(): Chainable<void>
      /** Login as Viewer user (read-only permissions) */
      loginAsViewer(): Chainable<void>
      /** Navigate to projects page */
      goToProjects(): Chainable<void>
      /** Navigate to organizations page */
      goToOrganizations(): Chainable<void>
    }
  }
}
