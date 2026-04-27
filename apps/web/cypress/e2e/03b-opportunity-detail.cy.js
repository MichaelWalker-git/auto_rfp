// 03b-opportunity-detail.cy.js — Opportunity Detail View
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'
const PROJECT_ID = '51651b52-8c6f-4489-806e-7e2605481e83' // Generic Project
const OPP_ID = '60f2607b-526b-46a0-b26e-b9c97c7ee6c4'
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

describe('Opportunity Detail', () => {
  beforeEach(() => { login(); goToOpportunity() })

  describe('Happy Path', () => {
    it('loads the opportunity detail page', () => {
      cy.get('main').should('be.visible')
      cy.contains('Back to Opportunities').should('be.visible')
    })

    it('shows opportunity title', () => {
      cy.get('h1, h2, [class*="title"]').should('exist')
    })

    it('shows status badge', () => {
      cy.contains(/Submitted|No Bid|Identified|Won|Lost|Pending/i).should('exist')
    })

    it('shows MANUAL_UPLOAD or source tag', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('MANUAL_UPLOAD')) {
          cy.contains('MANUAL_UPLOAD').should('be.visible')
        } else {
          cy.log('Not a manual upload — skipping')
        }
      })
    })

    it('shows Posted date', () => {
      cy.contains(/Posted|Due/i).should('exist')
    })

    it('shows Assigned to dropdown', () => {
      cy.contains(/Assigned|Unassigned/i).should('exist')
    })

    it('shows Brief and Edit buttons', () => {
      cy.contains('Brief').should('be.visible')
      cy.contains('Edit').should('be.visible')
    })

    it('shows Jump To navigation tabs', () => {
      cy.contains('Analysis').should('be.visible')
      cy.contains('Solicitations').should('be.visible')
      cy.contains('RFP Documents').should('be.visible')
      cy.contains('Submission').should('be.visible')
      cy.contains('Post-Award').should('be.visible')
    })

    it('shows Opportunity Analysis section', () => {
      cy.contains('Opportunity Analysis').should('be.visible')
    })

    it('shows Analyze Opportunity button when no analysis exists', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('Analyze Opportunity')) {
          cy.contains('Analyze Opportunity').should('be.visible')
        } else {
          cy.log('Analysis already present — skipping')
        }
      })
    })

    it('shows Solicitation Documents section', () => {
      cy.contains('Solicitation Documents').should('be.visible')
    })

    it('shows Upload button in Solicitation Documents', () => {
      cy.get('button').contains('Upload').should('be.visible')
    })

    it('opens Upload Question Files dialog', () => {
      cy.get('button').contains('Upload').first().click()
      cy.contains('Upload Question Files', { timeout: 5000 }).should('be.visible')
      cy.contains('Select Documents').should('exist')
      cy.contains('Drop files here').should('exist')
      cy.contains('browse').should('exist')
    })

    it('shows supported file formats in Upload dialog', () => {
      cy.get('button').contains('Upload').first().click()
      cy.contains('Upload Question Files', { timeout: 5000 }).should('be.visible')
      cy.contains('PDF').should('exist')
      cy.contains('DOCX').should('exist')
      cy.contains('Max 50 MB per file').should('exist')
    })

    it('shows Start Processing button in Upload dialog', () => {
      cy.get('button').contains('Upload').first().click()
      cy.contains('Upload Question Files', { timeout: 5000 }).should('be.visible')
      cy.contains('Start Processing').should('be.visible')
    })

    it('cancels Upload Question Files dialog', () => {
      cy.get('button').contains('Upload').first().click()
      cy.contains('Upload Question Files', { timeout: 5000 }).should('be.visible')
      cy.contains('Cancel').click()
      cy.contains('Opportunity Analysis').should('be.visible')
    })

    it('shows Re-extract All when solicitation doc exists', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('Re-extract All')) {
          cy.contains('Re-extract All').should('be.visible')
        } else {
          cy.log('No existing solicitation docs — skipping')
        }
      })
    })

    it('shows Completed badge on processed solicitation documents', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('Completed')) {
          cy.contains('Completed').should('be.visible')
        } else {
          cy.log('No completed docs — skipping')
        }
      })
    })

    it('shows RFP Documents section', () => {
      cy.contains('RFP Documents').should('be.visible')
    })

    it('shows Generate button in RFP Documents', () => {
      cy.contains('Generate').should('be.visible')
    })

    it('shows Export button in RFP Documents', () => {
      cy.contains('Export').should('be.visible')
    })

    it('shows No RFP documents yet empty state', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('No RFP documents yet')) {
          cy.contains('No RFP documents yet').should('be.visible')
        } else {
          cy.log('RFP documents exist — skipping empty state check')
        }
      })
    })

    it('opens Generate Documents dialog', () => {
      cy.contains('Generate').click()
      cy.contains('Generate Documents', { timeout: 5000 }).should('be.visible')
      cy.contains('Select document types to generate').should('be.visible')
    })

    it('shows document type options in Generate Documents dialog', () => {
      cy.contains('Generate').click()
      cy.contains('Generate Documents', { timeout: 5000 }).should('be.visible')
      cy.contains('Cover Letter').should('be.visible')
      cy.contains('Executive Summary').should('be.visible')
      cy.contains('Technical Proposal').should('be.visible')
      cy.contains('Past Performance').should('be.visible')
    })

    it('shows Required labels on required document types', () => {
      cy.contains('Generate').click()
      cy.contains('Generate Documents', { timeout: 5000 }).should('be.visible')
      cy.contains('Required').should('be.visible')
    })

    it('shows Select all and Select required buttons', () => {
      cy.contains('Generate').click()
      cy.contains('Generate Documents', { timeout: 5000 }).should('be.visible')
      cy.contains('Select all').should('be.visible')
      cy.contains('Select required').should('be.visible')
    })

    it('shows page count on document types', () => {
      cy.contains('Generate').click()
      cy.contains('Generate Documents', { timeout: 5000 }).should('be.visible')
      cy.contains('pages').should('be.visible')
    })

    it('cancels Generate Documents dialog', () => {
      cy.contains('Generate').click()
      cy.contains('Generate Documents', { timeout: 5000 }).should('be.visible')
      cy.contains('Cancel').click()
      cy.contains('RFP Documents').should('be.visible')
    })

    it('shows Generation Context section', () => {
      cy.contains('Generation Context').should('be.visible')
    })

    it('shows Submission & Compliance section', () => {
      cy.contains('Submission & Compliance').should('be.visible')
    })

    it('shows Compliance Report', () => {
      cy.contains('Compliance Report').should('be.visible')
    })

    it('opens Edit mode for the opportunity', () => {
      cy.contains('Edit').click()
      cy.contains('Title').should('be.visible')
      cy.contains('Save').should('be.visible')
      cy.contains('Cancel').should('be.visible')
    })

    it('cancels Edit mode without saving', () => {
      cy.contains('Edit').click()
      cy.contains('Cancel').click()
      cy.contains('Back to Opportunities').should('be.visible')
    })

    it('navigates back to Opportunities list', () => {
      cy.contains('Back to Opportunities').click()
      cy.contains('Opportunities', { timeout: 10000 }).should('be.visible')
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.reload()
      cy.get('main', { timeout: 15000 }).should('be.visible')
    })
  })
})
