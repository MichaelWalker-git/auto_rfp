// 01-auth.cy.js
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

describe('Authentication', () => {
  describe('Happy Path', () => {
    it('renders the login page', () => {
      cy.visit('/login/', { failOnStatusCode: false })
      cy.get('input[type="email"]').should('be.visible')
      cy.get('input[type="password"]').should('be.visible')
      cy.get('button[type="submit"]').should('be.visible')
    })

    it('logs in with valid credentials', () => {
      cy.visit('/login/', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 10000 }).should('be.visible')
      cy.get('input[type="email"]').clear().type(Cypress.env('USER_EMAIL'))
      cy.get('input[type="password"]').clear().type(Cypress.env('USER_PASSWORD'), { log: false })
      cy.get('button[type="submit"]').click()
          cy.visit(`/organizations/${ORG_ID}/projects/`, { failOnStatusCode: false })
      cy.contains('Projects', { timeout: 15000 }).should('be.visible')
    })

    it('persists session on page refresh', () => {
      cy.login()
      cy.goToProjects()
      cy.reload()
      cy.contains('Projects', { timeout: 15000 }).should('be.visible')
    })

    it('logs out successfully', () => {
      cy.login()
      cy.goToProjects()
      cy.get('button').last().click()
      cy.contains(/log out|sign out/i, { timeout: 5000 }).click()
          cy.get('input[type="email"]', { timeout: 15000 }).should('be.visible')
      cy.get('button[type="submit"]').should('be.visible')
    })
  })

  describe('Error States', () => {
    beforeEach(() => {
      cy.visit('/login/', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 10000 }).should('be.visible')
    })

    it('stays on login page with wrong password', () => {
      cy.get('input[type="email"]').clear().type(Cypress.env('USER_EMAIL'))
      cy.get('input[type="password"]').clear().type('WrongPassword123!', { log: false })
      cy.get('button[type="submit"]').click()
          cy.url().should('include', '/login')
    })

    it('stays on login page with non-existent email', () => {
      cy.get('input[type="email"]').clear().type('notauser@doesnotexist.com')
      cy.get('input[type="password"]').clear().type('SomePassword123!', { log: false })
      cy.get('button[type="submit"]').click()
          cy.url().should('include', '/login')
    })

    it('login page is accessible without being logged in', () => {
      cy.visit('/login/', { failOnStatusCode: false })
      cy.get('input[type="email"]').should('be.visible')
      cy.get('button[type="submit"]').should('be.visible')
    })
  })
})