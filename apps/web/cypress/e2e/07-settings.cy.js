// 07-admin.cy.js
// Org Members tests are covered in full by 17-org-members.cy.js
// This file covers Settings page only

const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

const login = () => {
  cy.session('userSession', () => {
    cy.visit('/login/', { failOnStatusCode: false })
    cy.get('input[type="email"]', { timeout: 10000 }).should('be.visible')
    cy.get('input[type="email"]').clear().type(Cypress.env('USER_EMAIL'))
    cy.get('input[type="password"]').clear().type(Cypress.env('USER_PASSWORD'), { log: false })
    cy.get('button[type="submit"]').click()
    cy.url({ timeout: 15000 }).should('not.include', '/login')
  })
}

describe('Settings', () => {
  beforeEach(() => {
    login()
    cy.visit(`/organizations/${ORG_ID}/settings`, { failOnStatusCode: false })
    cy.get('main', { timeout: 15000 }).should('be.visible')
  })

  describe('Happy Path', () => {
    it('loads the settings page', () => {
      cy.url().should('include', '/settings')
      cy.get('main').should('be.visible')
    })

    it('shows org settings fields', () => {
      cy.get('input, [contenteditable]').should('exist')
    })

    it('can navigate to Settings from the sidebar', () => {
      cy.visit(`/organizations/${ORG_ID}/projects/`, { failOnStatusCode: false })
      cy.contains('Projects', { timeout: 15000 }).should('be.visible')
      cy.contains('Settings').click()
      cy.url({ timeout: 10000 }).should('include', '/settings')
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.reload()
      cy.get('main', { timeout: 15000 }).should('be.visible')
    })
  })
})
