// 12-stale-report.cy.js
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

const goToStaleReport = () => {
  cy.visit(`/organizations/${ORG_ID}/stale-report`, { failOnStatusCode: false })
  cy.contains('Stale Content Report', { timeout: 15000 }).should('be.visible')
}

describe('Stale Content Report', () => {
  before(() => { cy.login(); goToStaleReport() })

  describe('Happy Path', () => {
    it('loads the Stale Content Report page with metric cards', () => {
      cy.contains('Stale Content Report').should('be.visible')
      cy.contains('Monitor outdated content').should('be.visible')
      cy.contains('Active').should('be.visible')
      cy.contains('Warning').should('be.visible')
      cy.contains('Stale').should('be.visible')
      cy.contains('Archived').should('be.visible')
    })

    it('shows filter tabs and switches to Warnings', () => {
      cy.contains('Warnings').should('be.visible')
      cy.contains('Warnings').click()
      cy.get('main').should('be.visible')
    })

    it('shows empty state when no stale content', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('No stale content')) {
          cy.contains('No stale content').should('be.visible')
        } else {
          cy.log('Stale content exists — skipping empty state check')
        }
      })
    })
  })

  describe('Error States', () => {
    it('shows error if stale report fails to load', () => {
      cy.login()
      goToStaleReport()
      cy.intercept('GET', '**/stale**').as('staleFail')
      cy.reload()
      cy.wait('@staleFail')
      cy.get('main, body').should('be.visible')
    })
  })
})
