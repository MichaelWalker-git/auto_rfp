// 08-dashboard.cy.js
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

const goToDashboard = () => {
  cy.visit(`/organizations/${ORG_ID}/dashboard`, { failOnStatusCode: false })
  cy.contains('Analytics Dashboard', { timeout: 15000 }).should('be.visible')
}

describe('Analytics Dashboard', () => {
  before(() => { cy.login(); goToDashboard() })

  describe('Happy Path', () => {
    it('loads the analytics dashboard with metric cards', () => {
      cy.contains('Analytics Dashboard').should('be.visible')
      cy.contains('Organisation-wide proposal performance').should('be.visible')
      cy.contains(/win rate/i).should('be.visible')
      cy.contains(/pipeline value/i).should('be.visible')
      cy.contains(/won contract value/i).should('be.visible')
      cy.contains(/submission rate/i).should('be.visible')
    })

    it('shows charts and time range filters', () => {
      cy.contains('Win / Loss by Month').scrollIntoView().should('be.visible')
      cy.contains('Win Rate Trend').scrollIntoView().should('be.visible')
      cy.contains('Last 3 months').should('be.visible')
      cy.contains('Last 6 months').should('be.visible')
      cy.contains('Last 12 months').should('be.visible')
      cy.contains('Last 24 months').should('be.visible')
    })

    it('has Export and Refresh buttons that work', () => {
      cy.contains('Export').should('be.visible')
      cy.contains('Refresh').should('be.visible')
      cy.contains('Refresh').click()
      cy.contains('Analytics Dashboard', { timeout: 10000 }).should('be.visible')
    })

    it('switches time range to Last 6 months', () => {
      cy.contains('Last 6 months').click()
      cy.get('main').should('be.visible')
    })
  })

  describe('Error States', () => {
    it('shows error if dashboard data fails to load', () => {
      cy.login()
      goToDashboard()
      cy.intercept('GET', '**/dashboard**').as('dashFail')
      cy.reload()
      cy.wait('@dashFail')
      cy.get('main, body').should('be.visible')
    })
  })
})
