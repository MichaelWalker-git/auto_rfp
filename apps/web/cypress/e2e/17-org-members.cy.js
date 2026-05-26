// 17-org-members.cy.js
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

const goToOrgMembers = () => {
  cy.visit(`/organizations/${ORG_ID}/team`, { failOnStatusCode: false })
  cy.contains('Org Members', { timeout: 15000 }).should('be.visible')
}

describe('Org Members', () => {
  before(() => { cy.login(); goToOrgMembers() })

  describe('Happy Path', () => {
    it('loads the Org Members page with existing members', () => {
      cy.contains('Org Members').should('be.visible')
      cy.contains('members in your organization').should('be.visible')
      cy.get('[class*="member"], [class*="user"], tr, li').should('have.length.greaterThan', 0)
      cy.contains('Admin').should('be.visible')
      cy.contains('Create User').should('be.visible')
    })
  })

  describe('Create User Dialog', () => {
    beforeEach(() => { cy.login(); goToOrgMembers() })

    it('opens dialog with all fields and cancels', () => {
      cy.contains('Create User').click()
      cy.contains('Create a new team member', { timeout: 5000 }).should('be.visible')
      cy.contains('Email').should('be.visible')
      cy.contains('First Name').should('be.visible')
      cy.contains('Last Name').should('be.visible')
      cy.contains('Position').should('be.visible')
      cy.contains('Role').should('be.visible')
      cy.contains('VIEWER').should('be.visible')
      cy.contains('Cancel').click()
      cy.contains('Org Members').should('be.visible')
    })
  })

  describe('Edge Cases', () => {
    beforeEach(() => { cy.login(); goToOrgMembers() })

    it('does not submit with invalid email', () => {
      cy.contains('Create User').click()
      cy.contains('Create a new team member', { timeout: 5000 }).should('be.visible')
      cy.get('input[placeholder*="user@example" i]').type('not-an-email')
      cy.get('button').contains('Create User').click({ force: true })
      cy.contains('Create a new team member').should('be.visible')
    })

    it('does not submit with empty email', () => {
      cy.contains('Create User').click()
      cy.contains('Create a new team member', { timeout: 5000 }).should('be.visible')
      cy.get('button').contains('Create User').click({ force: true })
      cy.contains('Create a new team member').should('be.visible')
    })
  })

  describe('Error States', () => {
    it('intercepts member list request successfully', () => {
      cy.login()
      goToOrgMembers()
      cy.intercept('GET', '**/team**').as('teamRequest')
      cy.reload()
      cy.wait('@teamRequest')
      cy.contains('Org Members', { timeout: 10000 }).should('be.visible')
    })
  })
})
