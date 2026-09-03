// 03b-opportunity-detail.cy.js — Opportunity Detail View (tabbed layout, ADR 0001)
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'
const PROJECT_ID = '51651b52-8c6f-4489-806e-7e2605481e83'
const OPP_ID = '60f2607b-526b-46a0-b26e-b9c97c7ee6c4'
const OPP_URL = `/organizations/${ORG_ID}/projects/${PROJECT_ID}/opportunities/${OPP_ID}/`

const goToOpportunity = () => {
  cy.visit(OPP_URL, { failOnStatusCode: false })
  cy.get('main', { timeout: 15000 }).should('be.visible')
}

// The detail page is a progress-driven tab strip (ADR 0001): each panel mounts
// only once its tab is opened, so a test must select the owning tab before
// asserting its content. Tab labels come from OPPORTUNITY_TAB_LABELS.
const openTab = (name) =>
  cy.contains('[role="tab"]', name, { timeout: 15000 }).click({ force: true })

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
      // Brief + Edit are header actions on the default Details tab.
      cy.contains('Brief').should('be.visible')
      cy.contains('Edit').should('be.visible')
    })

    it('shows the progress-driven tab strip with the always-on tabs', () => {
      cy.get('[role="tablist"]').should('be.visible')
      cy.contains('[role="tab"]', 'Details').should('exist')
      cy.contains('[role="tab"]', 'Analysis').should('exist')
      cy.contains('[role="tab"]', 'RFP docs').should('exist')
      cy.contains('[role="tab"]', 'Compliance details').should('exist')
      cy.contains('[role="tab"]', 'Outcome').should('exist')
    })

    it('shows Opportunity Analysis section on the Analysis tab', () => {
      openTab('Analysis')
      cy.contains('Opportunity Analysis').should('be.visible')
      cy.get('body').then(($body) => {
        if ($body.text().includes('Analyze Opportunity')) {
          cy.contains('Analyze Opportunity').should('be.visible')
        }
      })
    })

    it('shows Solicitation Documents section with Upload button on the Details tab', () => {
      openTab('Details')
      cy.contains('Solicitation Documents').should('be.visible')
      cy.get('button').contains('Upload').should('be.visible')
      cy.get('body').then(($body) => {
        if ($body.text().includes('Re-extract All')) {
          cy.contains('Re-extract All').should('be.visible')
        }
        if ($body.text().includes('Completed')) {
          cy.contains('Completed').should('exist')
        }
      })
    })

    it('shows RFP Documents section with Generate and Export on the RFP docs tab', () => {
      openTab('RFP docs')
      cy.get('#tabpanel-rfp-documents', { timeout: 15000 }).within(() => {
        cy.contains('RFP Documents').should('be.visible')
        cy.contains('Generate').should('be.visible')
        cy.contains('Export').should('be.visible')
      })
      cy.get('#tabpanel-rfp-documents').then(($panel) => {
        if ($panel.text().includes('No RFP documents yet')) {
          cy.contains('No RFP documents yet').should('be.visible')
        }
      })
    })

    it('shows Generation Context (Details) and Compliance Report (Compliance details)', () => {
      openTab('Details')
      cy.contains('Generation Context').should('be.visible')
      openTab('Compliance details')
      cy.get('#tabpanel-compliance', { timeout: 15000 }).within(() => {
        cy.contains('Compliance Report').should('be.visible')
      })
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
      // Still on the Details tab after cancelling.
      cy.contains('Solicitation Documents').should('be.visible')
    })

    it('opens and cancels Generate Documents dialog', () => {
      openTab('RFP docs')
      cy.get('#tabpanel-rfp-documents', { timeout: 15000 })
        .contains('button', /^Generate$/).should('be.visible').click({ force: true })
      cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible')
      cy.get('[role="dialog"]').contains('Generate Documents').should('be.visible')
      cy.get('[role="dialog"]').contains('Select document types to generate').should('be.visible')
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Cover Letter').should('be.visible')
        cy.contains('Executive Summary').should('be.visible')
        cy.contains('Technical Proposal').should('be.visible')
        cy.contains('Past Performance').should('be.visible')
        cy.contains('Select all').should('be.visible')
      })
      cy.get('[role="dialog"]').contains('Cancel').click()
      cy.get('#tabpanel-rfp-documents').should('be.visible')
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
