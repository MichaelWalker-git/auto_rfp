/// <reference types="cypress" />

const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

Cypress.Commands.add('login', () => {
  cy.session('userSession', () => {
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

    cy.visit('/', { failOnStatusCode: false })
    cy.get('input[type="email"]', { timeout: 15000 }).should('be.visible')
    cy.get('input[type="email"]').clear().type(userEmail)
    cy.get('input[type="password"]').clear().type(userPassword, { log: false })
    cy.get('button[type="submit"]').click()
    cy.url({ timeout: 30000 }).should('include', '/organizations/')
  })
})

Cypress.Commands.add('goToProjects', () => {
  cy.visit(`/organizations/${ORG_ID}/projects/`, { failOnStatusCode: false })
  cy.url({ timeout: 30000 }).should('include', '/projects')
})

declare global {
  namespace Cypress {
    interface Chainable {
      login(): Chainable<void>
      goToProjects(): Chainable<void>
    }
  }
}