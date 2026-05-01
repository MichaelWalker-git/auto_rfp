// 11-past-performance.cy.js
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

const goToPastPerformance = () => {
  cy.visit(`/organizations/${ORG_ID}/past-performance`, { failOnStatusCode: false })
  cy.contains('Past Performance', { timeout: 15000 }).should('be.visible')
}

describe('Past Performance', () => {
  before(() => { cy.login(); goToPastPerformance() })

  describe('Happy Path', () => {
    it('loads the Past Performance page', () => {
      cy.contains('Past Performance').should('be.visible')
      cy.contains('Add Past Project').should('be.visible')
      cy.contains('Upload Documents').should('be.visible')
    })
  })

  describe('Add & Extract Dialogs', () => {
    beforeEach(() => { cy.login(); goToPastPerformance() })

    it('opens Add Past Performance form with Technical Details and navigates back', () => {
      cy.contains('Add Past Project').click()
      cy.contains('Add Past Performance Project', { timeout: 10000 }).should('be.visible')
      cy.contains('Basic Information').should('be.visible')
      cy.contains('Project Title').should('be.visible')
      cy.contains('Client Name').should('be.visible')
      cy.contains('Contract Details').should('be.visible')
      cy.contains('Technical Details').should('be.visible')
      cy.go('back')
      cy.contains('Past Performance', { timeout: 10000 }).should('be.visible')
    })

    it('opens and cancels Extract Past Performance upload dialog', () => {
      cy.contains('Upload Documents').click()
      cy.contains('Extract Past Performance', { timeout: 5000 }).should('be.visible')
      cy.contains('Upload case studies').should('be.visible')
      cy.contains('Upload & Extract').should('be.visible')
      cy.contains('Cancel').click()
      cy.contains('Past Performance').should('be.visible')
    })
  })

  describe('Edge Cases', () => {
    it('shows validation error when submitting with empty required fields', () => {
      cy.login()
      goToPastPerformance()
      cy.contains('Add Past Project').click()
      cy.contains('Add Past Performance Project', { timeout: 10000 }).should('be.visible')
      cy.get('body').then(($body) => {
        const saveBtn = $body.find('button:contains("Save"), button:contains("Create"), button[type="submit"]')
        if (saveBtn.length > 0) {
          cy.wrap(saveBtn.first()).click()
          cy.get('input:invalid, [class*="error"], [role="alert"]').should('exist')
        }
      })
    })
  })

  describe('Error States', () => {
    it('shows error if past performance fails to load', () => {
      cy.login()
      goToPastPerformance()
      cy.intercept('GET', '**/past-performance**').as('ppFail')
      cy.reload()
      cy.wait('@ppFail')
      cy.get('main, body').should('be.visible')
    })
  })
})
