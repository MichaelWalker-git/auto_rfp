// 06-export.cy.js
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'
const PROJECT_ID = '51651b52-8c6f-4489-806e-7e2605481e83' // Generic Project
const OPP_ID = '486e75f6-ef80-4500-9b74-b4f04bad0723'
const OPP_URL = `/organizations/${ORG_ID}/projects/${PROJECT_ID}/opportunities/${OPP_ID}/`

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

const goToOpportunity = () => {
  cy.visit(OPP_URL, { failOnStatusCode: false })
  cy.get('main', { timeout: 15000 }).should('be.visible')
}

const openExportModal = () => {
  // Click the Export button in the RFP Documents section
  cy.contains('RFP Documents').should('be.visible')
  cy.contains('Export').click()
  cy.contains('Export Documents', { timeout: 5000 }).should('be.visible')
}

describe('Export', () => {
  beforeEach(() => { login(); goToOpportunity() })

  describe('Happy Path', () => {
    it('shows an Export button in RFP Documents section', () => {
      cy.contains('RFP Documents').should('be.visible')
      cy.contains('Export').should('be.visible')
    })

    it('opens the Export Documents modal', () => {
      openExportModal()
      cy.contains('exportable documents').should('be.visible')
    })

    it('shows Individual Files (ZIP) option', () => {
      openExportModal()
      cy.contains('Individual Files (ZIP)').should('be.visible')
      cy.contains('Export each document separately').should('be.visible')
    })

    it('shows Merged Document option', () => {
      openExportModal()
      cy.contains('Merged Document').should('be.visible')
      cy.contains('Combine selected documents into one').should('be.visible')
    })

    it('opens Individual Files flow with format options', () => {
      openExportModal()
      cy.contains('Individual Files (ZIP)').click()
      cy.contains('Export Formats').should('be.visible')
      cy.contains('Word (.docx)').should('be.visible')
      cy.contains('PDF (.pdf)').should('be.visible')
      cy.contains('Export ZIP').should('be.visible')
    })

    it('opens Merged Document flow with format and file name options', () => {
      openExportModal()
      cy.contains('Merged Document').click()
      cy.contains('File Name').should('be.visible')
      cy.get('input[value*="Merged"], input[placeholder*="Merged"], input[placeholder*="file"]').should('exist')
      cy.contains('Word (.docx)').should('be.visible')
      cy.contains('PDF (.pdf)').should('be.visible')
      cy.contains('Merge').should('be.visible')
    })

    it('cancels Individual Files export', () => {
      openExportModal()
      cy.contains('Individual Files (ZIP)').click()
      cy.contains('Cancel').click()
      cy.contains('RFP Documents').should('be.visible')
    })

    it('cancels Merged Document export', () => {
      openExportModal()
      cy.contains('Merged Document').click()
      cy.contains('Cancel').click()
      cy.contains('RFP Documents').should('be.visible')
    })

    it('cancels from the initial Export Documents modal', () => {
      openExportModal()
      cy.contains('Export Documents').should('be.visible')
      // Close via the X button in the top right of the modal
      cy.get('button[aria-label*="close" i], [class*="close"]').first().click({ force: true })
      cy.contains('RFP Documents').should('be.visible')
    })
  })

  describe('DOCX Permissions Regression — HOR-1929', () => {
    it('does not show a 403 or permissions error when exporting as DOCX', () => {
      openExportModal()
      cy.contains('Individual Files (ZIP)').click()
      cy.contains('Export ZIP').click()
          cy.get('body').should('not.contain.text', '403')
      cy.get('body').should('not.contain.text', 'Forbidden')
      cy.get('body').should('not.contain.text', 'permission denied')
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.reload()
      cy.get('main', { timeout: 15000 }).should('be.visible')
    })
  })
})
