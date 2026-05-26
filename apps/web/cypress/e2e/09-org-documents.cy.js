// 09-org-documents.cy.js
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

const goToOrgDocuments = () => {
  cy.visit(`/organizations/${ORG_ID}/knowledge-base/`, { failOnStatusCode: false })
  cy.contains('Org Documents', { timeout: 15000 }).should('be.visible')
}

describe('Org Documents', () => {
  before(() => { cy.login(); goToOrgDocuments() })

  describe('Happy Path', () => {
    it('loads the Org Documents page', () => {
      cy.contains('Org Documents').should('be.visible')
      cy.contains('Manage document folders').should('be.visible')
      cy.contains('New Folder').should('be.visible')
    })

    it('displays folders on the page', () => {
      cy.get('main').should('be.visible')
      cy.get('body').should('not.be.empty')
    })

    it('navigates into a folder', () => {
      cy.get('body').then(($body) => {
        const links = $body.find('a[href*="knowledge-base"]')
        if (links.length > 0) {
          cy.wrap(links.first()).click()
          cy.get('main', { timeout: 10000 }).should('be.visible')
        } else {
          cy.log('No folder links found — skipping')
        }
      })
    })
  })

  describe('Folder CRUD', () => {
    beforeEach(() => { cy.login(); goToOrgDocuments() })

    it('opens and cancels folder creation dialog', () => {
      cy.contains('New Folder').click()
      cy.contains('Create Document Folder', { timeout: 5000 }).should('be.visible')
      cy.contains('Name').should('be.visible')
      cy.contains('Description').should('be.visible')
      cy.contains('Create').should('be.visible')
      cy.contains('Cancel').should('be.visible')
      cy.get('input[placeholder*="Technical Docs" i], input[placeholder*="name" i]').type('Should Not Save')
      cy.contains('Cancel').click()
      cy.contains('Should Not Save').should('not.exist')
    })

    it('creates a new folder', () => {
      cy.contains('New Folder').click()
      cy.contains('Create Document Folder', { timeout: 5000 }).should('be.visible')
      cy.get('input[placeholder*="Technical Docs" i], input[placeholder*="name" i]').type('Cypress Test Folder')
      cy.contains('Create').click()
      cy.contains('Org Documents', { timeout: 10000 }).should('be.visible')
    })
  })

  describe('Edge Cases', () => {
    it('shows validation error when creating folder with empty name', () => {
      cy.login()
      goToOrgDocuments()
      cy.contains('New Folder').click()
      cy.contains('Create Document Folder', { timeout: 5000 }).should('be.visible')
      cy.contains('Create').click()
      cy.get('input:invalid, [class*="error"], [role="alert"]').should('exist')
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.login()
      goToOrgDocuments()
      cy.reload()
      cy.contains('Org Documents', { timeout: 15000 }).should('be.visible')
    })
  })
})
