// 17-org-members.cy.js
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

const goToOrgMembers = () => {
  cy.visit(`/organizations/${ORG_ID}/team`, { failOnStatusCode: false })
  cy.contains('Org Members', { timeout: 15000 }).should('be.visible')
}

describe('Org Members', () => {
  beforeEach(() => { login(); goToOrgMembers() })

  describe('Happy Path', () => {
    it('loads the Org Members page', () => {
      cy.contains('Org Members').should('be.visible')
      cy.contains('members in your organization').should('be.visible')
    })

    it('displays existing members with Admin badges', () => {
      cy.get('[class*="member"], [class*="user"], tr, li').should('have.length.greaterThan', 0)
      cy.contains('Admin').should('be.visible')
    })

    it('shows the Create User button', () => {
      cy.contains('Create User').should('be.visible')
    })

    it('opens the Create User dialog', () => {
      cy.contains('Create User').click()
      cy.contains('Create a new team member', { timeout: 5000 }).should('be.visible')
      cy.contains('Email').should('be.visible')
      cy.contains('First Name').should('be.visible')
      cy.contains('Last Name').should('be.visible')
      cy.contains('Position').should('be.visible')
      cy.contains('Role').should('be.visible')
      cy.contains('VIEWER').should('be.visible')
    })

    it('cancels user creation without saving', () => {
      cy.contains('Create User').click()
      cy.contains('Create a new team member', { timeout: 5000 }).should('be.visible')
      cy.contains('Cancel').click()
      cy.contains('Org Members').should('be.visible')
    })
  })

  describe('Edge Cases', () => {
    it('does not submit with invalid email', () => {
      cy.contains('Create User').click()
      cy.contains('Create a new team member', { timeout: 5000 }).should('be.visible')
      cy.get('input[placeholder*="user@example" i]').type('not-an-email')
      cy.get('button').contains('Create User').click({ force: true })
      cy.wait(1000)
      cy.contains('Create a new team member').should('be.visible')
    })

    it('does not submit with empty email', () => {
      cy.contains('Create User').click()
      cy.contains('Create a new team member', { timeout: 5000 }).should('be.visible')
      cy.get('button').contains('Create User').click({ force: true })
      cy.wait(1000)
      cy.contains('Create a new team member').should('be.visible')
    })
  })

  describe('Error States', () => {
    it('intercepts member list request successfully', () => {
      cy.intercept('GET', '**/team**').as('teamRequest')
      cy.reload()
      cy.wait('@teamRequest')
      cy.contains('Org Members', { timeout: 10000 }).should('be.visible')
    })
  })
})
