// 06-export.cy.js
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'
const PROJECT_ID = '51651b52-8c6f-4489-806e-7e2605481e83'
const OPP_ID = '486e75f6-ef80-4500-9b74-b4f04bad0723'
const OPP_URL = `/organizations/${ORG_ID}/projects/${PROJECT_ID}/opportunities/${OPP_ID}/`

const goToOpportunity = () => {
  cy.visit(OPP_URL, { failOnStatusCode: false })
  cy.get('main', { timeout: 20000 }).should('be.visible')
}

const openExportModal = () => {
  cy.contains('RFP Documents', { timeout: 15000 }).should('be.visible')
  cy.contains('Export').click()
  cy.contains('Export Documents', { timeout: 10000 }).should('be.visible')
}

describe('Export', () => {
  before(() => { cy.login(); goToOpportunity() })

  describe('Happy Path', () => {
    it('shows Export button in RFP Documents section', () => {
      cy.contains('RFP Documents').should('be.visible')
      cy.contains('Export').should('be.visible')
    })
  })

  describe('Export Flows', () => {
    beforeEach(() => { cy.login(); goToOpportunity() })

    it('opens modal with both export options and cancels', () => {
      openExportModal()
      cy.contains('exportable documents').should('be.visible')
      cy.contains('Individual Files (ZIP)').should('be.visible')
      cy.contains('Export each document separately').should('be.visible')
      cy.contains('Merged Document').should('be.visible')
      cy.contains('Combine selected documents into one').should('be.visible')
      cy.get('button[aria-label*="close" i], [class*="close"]').first().click({ force: true })
      cy.contains('RFP Documents').should('be.visible')
    })

    it('opens and cancels Individual Files flow', () => {
      openExportModal()
      cy.contains('Individual Files (ZIP)').click()
      cy.contains('Export Formats', { timeout: 10000 }).should('be.visible')
      cy.contains('Word (.docx)').should('be.visible')
      cy.contains('PDF (.pdf)').should('be.visible')
      cy.contains('Export ZIP').should('be.visible')
      cy.contains('Cancel').click()
      cy.contains('RFP Documents').should('be.visible')
    })

    it('opens and cancels Merged Document flow', () => {
      openExportModal()
      cy.contains('Merged Document').click()
      cy.contains('File Name', { timeout: 10000 }).should('be.visible')
      cy.get('input[value*="Merged"], input[placeholder*="Merged"], input[placeholder*="file"]').should('exist')
      cy.contains('Word (.docx)').should('be.visible')
      cy.contains('PDF (.pdf)').should('be.visible')
      cy.contains('Merge').should('be.visible')
      cy.contains('Cancel').click()
      cy.contains('RFP Documents').should('be.visible')
    })

    it('DOCX export does not show 403 or permissions error (HOR-1929)', () => {
      openExportModal()
      cy.contains('Individual Files (ZIP)').click()
      cy.contains('Export Formats', { timeout: 10000 }).should('be.visible')
      cy.contains('Export ZIP').should('be.visible').click()
      cy.get('body').should('not.contain.text', '403')
      cy.get('body').should('not.contain.text', 'Forbidden')
      cy.get('body').should('not.contain.text', 'permission denied')
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.login()
      goToOpportunity()
      cy.reload()
      cy.get('main', { timeout: 15000 }).should('be.visible')
    })
  })
})
