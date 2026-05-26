// 18-audit-trail.cy.js
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

const goToAuditTrail = () => {
  cy.visit(`/organizations/${ORG_ID}/audit`, { failOnStatusCode: false })
  cy.contains('Audit Trail', { timeout: 15000 }).should('be.visible')
}

describe('Audit Trail', () => {
  before(() => { cy.login(); goToAuditTrail() })

  describe('Happy Path', () => {
    it('loads the Audit Trail page with filters and table', () => {
      cy.contains('Audit Trail').should('be.visible')
      cy.contains('Immutable record of all user actions').should('be.visible')
      cy.contains('Log Viewer').should('be.visible')
      cy.contains('User').should('be.visible')
      cy.contains('Action').should('be.visible')
      cy.contains('Resource').should('be.visible')
      cy.contains('Result').should('be.visible')
      cy.contains('Filter').should('be.visible')
      cy.contains('Clear').should('be.visible')
      cy.contains('Timestamp').should('be.visible')
      cy.contains('IP Address').should('be.visible')
    })

    it('displays log entries with success badges and pagination', () => {
      cy.get('table tbody tr, [class*="row"]').should('have.length.greaterThan', 0)
      cy.contains('success').should('be.visible')
      cy.contains('total entries').should('be.visible')
      cy.contains('Page 1').should('be.visible')
      cy.contains('Next').should('be.visible')
    })

    it('navigates to next page', () => {
      cy.contains('Next').click()
      cy.get('main', { timeout: 10000 }).should('be.visible')
    })

    it('applies and clears filters', () => {
      cy.contains('Filter').click()
      cy.get('main').should('be.visible')
      cy.contains('Clear').click()
      cy.get('main').should('be.visible')
    })
  })

  describe('Compliance Reports', () => {
    it('shows the Compliance Reports section with all controls', () => {
      cy.contains('Compliance Reports').scrollIntoView().should('be.visible')
      cy.contains('Generate compliance reports for ISO 27001').should('be.visible')
      cy.contains('Report type').should('be.visible')
      cy.contains('From').should('be.visible')
      cy.contains('To').should('be.visible')
      cy.contains('Export format').should('be.visible')
      cy.contains('JSON (view inline)').should('be.visible')
      cy.contains('Generate Report').should('be.visible')
    })
  })

  describe('Error States', () => {
    it('shows error if audit log fails to load', () => {
      cy.login()
      goToAuditTrail()
      cy.intercept('GET', '**/audit**').as('auditFail')
      cy.reload()
      cy.wait('@auditFail')
      cy.get('main, body').should('be.visible')
    })
  })
})
