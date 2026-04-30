// 01-auth.cy.js
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

describe('Authentication', () => {
  describe('Happy Path', () => {
    it('renders the login form', () => {
      cy.visit('/', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 15000 }).should('be.visible')
      cy.get('input[type="password"]').should('be.visible')
      cy.get('button[type="submit"]').should('be.visible')
    })

    it('logs in with valid credentials', () => {
      cy.visit('/', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 15000 }).should('be.visible')
      cy.get('input[type="email"]').clear().type(Cypress.env('USER_EMAIL'))
      cy.get('input[type="password"]').clear().type(Cypress.env('USER_PASSWORD'), { log: false })
      cy.get('button[type="submit"]').click()
      cy.url({ timeout: 30000 }).should('include', '/organizations/')
    })

    it('navigates to projects after login', () => {
      cy.login()
      cy.visit(`/organizations/${ORG_ID}/projects/`, { failOnStatusCode: false })
      cy.url({ timeout: 30000 }).should('include', '/projects')
    })

    it('persists session on page refresh', () => {
      cy.login()
      cy.goToProjects()
      cy.reload()
      cy.url({ timeout: 30000 }).should('include', '/projects')
    })

    it('logs out successfully', () => {
      cy.login()
      cy.goToProjects()
      cy.get('[data-sidebar="footer"] [data-sidebar="menu-button"]', { timeout: 10000 }).first().click()
      cy.contains(/log out/i, { timeout: 5000 }).click()
      cy.get('input[type="email"]', { timeout: 30000 }).should('be.visible')
      cy.get('button[type="submit"]').should('be.visible')
      // Re-login so the cached session is valid for subsequent spec files
      Cypress.session.clearAllSavedSessions()
    })
  })

  describe('Error States', () => {
    beforeEach(() => {
      cy.visit('/', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 15000 }).should('be.visible')
    })

    it('stays on login with wrong password', () => {
      cy.get('input[type="email"]').clear().type(Cypress.env('USER_EMAIL'))
      cy.get('input[type="password"]').clear().type('WrongPassword123!', { log: false })
      cy.get('button[type="submit"]').click()
      cy.get('input[type="email"]', { timeout: 10000 }).should('be.visible')
      cy.url().should('not.include', '/organizations')
    })

    it('stays on login with non-existent email', () => {
      cy.get('input[type="email"]').clear().type('notauser@doesnotexist.com')
      cy.get('input[type="password"]').clear().type('SomePassword123!', { log: false })
      cy.get('button[type="submit"]').click()
      cy.get('input[type="email"]', { timeout: 10000 }).should('be.visible')
      cy.url().should('not.include', '/organizations')
    })

    it('login form is accessible without being logged in', () => {
      cy.visit('/', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 15000 }).should('be.visible')
      cy.get('button[type="submit"]').should('be.visible')
    })
  })
})
