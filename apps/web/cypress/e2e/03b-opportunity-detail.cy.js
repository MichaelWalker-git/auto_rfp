// 03b-opportunity-detail.cy.js — Opportunity Detail View
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'
const PROJECT_ID = '51651b52-8c6f-4489-806e-7e2605481e83'
const OPP_ID = '60f2607b-526b-46a0-b26e-b9c97c7ee6c4'
const OPP_URL = `/organizations/${ORG_ID}/projects/${PROJECT_ID}/opportunities/${OPP_ID}/`

const goToOpportunity = () => {
  cy.visit(OPP_URL, { failOnStatusCode: false })
  cy.get('main', { timeout: 15000 }).should('be.visible')
}

describe('Opportunity Detail', () => {
  before(() => { cy.login(); goToOpportunity() })

  describe('Happy Path', () => {
    it('loads the opportunity detail page with header elements', () => {
      cy.get('main').should('be.visible')
      cy.contains('Back to Opportunities').should('be.visible')
      cy.get('h1, h2, [class*="title"]').should('exist')
      cy.contains(/Submitted|No Bid|Identified|Won|Lost|Pending/i).should('exist')
      cy.contains(/Posted|Due/i).should('exist')
      cy.contains(/Assigned|Unassigned/i).should('exist')
      cy.contains('Brief').should('be.visible')
      cy.contains('Edit').should('be.visible')
    })

    it('shows Jump To navigation tabs', () => {
      cy.scrollTo('top')
      cy.contains('Analysis').should('be.visible')
      cy.contains('Solicitations').should('be.visible')
      cy.contains('RFP Documents').should('be.visible')
      cy.contains('Submission').should('be.visible')
      cy.contains('Post-Award').should('be.visible')
    })

    it('shows Opportunity Analysis section', () => {
      cy.contains('Opportunity Analysis').scrollIntoView().should('be.visible')
      cy.get('body').then(($body) => {
        if ($body.text().includes('Analyze Opportunity')) {
          cy.contains('Analyze Opportunity').should('be.visible')
        }
      })
    })

    it('shows Solicitation Documents section with Upload button', () => {
      cy.contains('Solicitation Documents').scrollIntoView().should('be.visible')
      cy.get('button').contains('Upload').should('be.visible')
      cy.get('body').then(($body) => {
        if ($body.text().includes('Re-extract All')) {
          cy.contains('Re-extract All').scrollIntoView().should('be.visible')
        }
        if ($body.text().includes('Completed')) {
          cy.contains('Completed').should('exist')
        }
      })
    })

    it('shows RFP Documents section with Generate and Export', () => {
      cy.get('#rfp-documents').scrollIntoView().should('be.visible')
      cy.contains('Generate').should('be.visible')
      cy.contains('Export').should('be.visible')
      cy.get('body').then(($body) => {
        if ($body.text().includes('No RFP documents yet')) {
          cy.contains('No RFP documents yet').should('be.visible')
        }
      })
    })

    it('shows Generation Context and Submission sections', () => {
      cy.contains('Generation Context').scrollIntoView().should('be.visible')
      cy.contains('Submission & Compliance').scrollIntoView().should('be.visible')
      cy.contains('Compliance Report').should('be.visible')
    })
  })

  describe('Dialogs and Edit', () => {
    beforeEach(() => { cy.login(); goToOpportunity() })

    it('opens and cancels Upload Question Files dialog', () => {
      cy.contains('Solicitation Documents', { timeout: 15000 }).should('be.visible')
      cy.contains('Solicitation Documents').parent().parent().find('button').contains('Upload').click()
      cy.contains('Upload Question Files', { timeout: 10000 }).should('be.visible')
      cy.contains('Select Documents').should('exist')
      cy.contains('Drop files here').should('exist')
      cy.contains('browse').should('exist')
      cy.contains('PDF').should('exist')
      cy.contains('DOCX').should('exist')
      cy.contains('Max 50 MB per file').should('exist')
      cy.contains('Start Processing').should('be.visible')
      cy.contains('Cancel').click()
      cy.contains('Opportunity Analysis').should('be.visible')
    })

    it('opens and cancels Generate Documents dialog', () => {
      cy.get('#rfp-documents', { timeout: 15000 }).scrollIntoView()
      cy.get('#rfp-documents').contains('button', /^Generate$/).should('be.visible').click({ force: true })
      cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible')
      cy.get('[role="dialog"]').contains('Generate Documents').should('be.visible')
      cy.get('[role="dialog"]').contains('Select document types to generate').should('be.visible')
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Cover Letter').should('be.visible')
        cy.contains('Executive Summary').should('be.visible')
        cy.contains('Technical Proposal').should('be.visible')
        cy.contains('Past Performance').should('be.visible')
        cy.contains('Select all').should('be.visible')
        cy.contains('Select required').should('be.visible')
      })
      cy.get('[role="dialog"]').contains('Cancel').click()
      cy.get('#rfp-documents').should('be.visible')
    })

    it('opens and cancels Edit mode, then navigates back', () => {
      cy.contains('Edit').click()
      cy.contains('Title').should('be.visible')
      cy.contains('Save').should('be.visible')
      cy.contains('Cancel').should('be.visible')
      cy.contains('Cancel').click()
      cy.contains('Back to Opportunities').should('be.visible')
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
