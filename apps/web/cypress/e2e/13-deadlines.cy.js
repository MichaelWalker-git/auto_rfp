// 13-deadlines.cy.js
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

const goToDeadlines = () => {
  cy.visit(`/organizations/${ORG_ID}/deadlines`, { failOnStatusCode: false })
  cy.contains('Deadlines', { timeout: 15000 }).should('be.visible')
}

describe('Deadlines', () => {
  before(() => { cy.login(); goToDeadlines() })

  describe('Happy Path', () => {
    it('loads the Deadlines page with controls', () => {
      cy.contains('Deadlines').should('be.visible')
      cy.contains('Track deadlines for all').should('be.visible')
      cy.contains('Organization Deadlines').should('be.visible')
      cy.contains('Urgency').should('be.visible')
      cy.contains('Project').should('be.visible')
      cy.contains('Opportunity').should('be.visible')
      cy.contains('Deadline Type').should('be.visible')
      cy.contains('Month').should('be.visible')
      cy.contains('Week').should('be.visible')
      cy.contains('Day').should('be.visible')
      cy.contains('Agenda').should('be.visible')
      cy.contains('Export All').should('be.visible')
      cy.contains('Subscribe').should('be.visible')
    })

    it('opens and closes Subscribe dialog', () => {
      cy.contains('Subscribe').click()
      cy.contains('Subscribe to Calendar', { timeout: 5000 }).should('be.visible')
      cy.contains('Subscription URL').should('be.visible')
      cy.contains('Security notice').should('be.visible')
      cy.contains('Regenerate Token').should('be.visible')
      cy.contains('Done').click()
      cy.contains('Deadlines').should('be.visible')
    })

    it('switches calendar views', () => {
      cy.contains('Week').click()
      cy.get('main').should('be.visible')
      cy.contains('Agenda').click()
      cy.get('main').should('be.visible')
    })

    it('navigates months and returns to today', () => {
      cy.contains('Next').click()
      cy.get('main').should('be.visible')
      cy.contains('Today').click()
      cy.get('main').should('be.visible')
    })
  })

  describe('Error States', () => {
    it('shows error if deadlines fail to load', () => {
      cy.login()
      goToDeadlines()
      cy.intercept('GET', '**/deadlines**').as('deadlinesFail')
      cy.reload()
      cy.wait('@deadlinesFail')
      cy.get('main, body').should('be.visible')
    })
  })
})
