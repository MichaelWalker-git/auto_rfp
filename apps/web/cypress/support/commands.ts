/// <reference types="cypress" />

const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

Cypress.Commands.add('login', () => {
  cy.visit('/login/', { failOnStatusCode: false })
  cy.get('input[type="email"]', { timeout: 10000 }).should('be.visible')
  cy.get('input[type="email"]').clear().type(Cypress.env('USER_EMAIL'))
  cy.get('input[type="password"]').clear().type(Cypress.env('USER_PASSWORD'), { log: false })
  cy.get('button[type="submit"]').click()
  cy.contains('Projects', { timeout: 15000 }).should('be.visible')
})

Cypress.Commands.add('goToProjects', () => {
  cy.visit(`/organizations/${ORG_ID}/projects/`, { failOnStatusCode: false })
  cy.contains('Projects', { timeout: 15000 }).should('be.visible')
})

declare global {
  namespace Cypress {
    interface Chainable {
      login(): Chainable<void>
      goToProjects(): Chainable<void>
    }
  }
}