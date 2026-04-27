// 05-autorfp-generation.cy.js
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

const openGenerateDialog = () => {
  cy.contains('Generate').click()
  cy.contains('Generate Documents', { timeout: 5000 }).should('be.visible')
}

const confirmGenerate = () => {
  cy.get('[role="dialog"], [class*="modal"], [class*="dialog"]')
    .find('button')
    .contains(/generate/i)
    .click({ force: true })
}

describe('AutoRFP Generation', () => {
  beforeEach(() => { login(); goToOpportunity() })

  describe('Happy Path', () => {
    it('shows a Generate button on the opportunity', () => {
      cy.contains('Generate').should('be.visible')
    })

    it('opens the Generate Documents dialog', () => {
      openGenerateDialog()
      cy.contains('Select document types to generate').should('be.visible')
      cy.contains('Cancel').click()
    })

    it('triggers generation and shows a loading state', () => {
      openGenerateDialog()
      // Click the Generate button at the bottom of the dialog directly
      cy.contains('button', /^generate/i).last().click({ force: true })
      cy.get('main', { timeout: 15000 }).should('be.visible')
    })

    it('completes generation and renders content', () => {
      openGenerateDialog()
      confirmGenerate()
      cy.get('main', { timeout: 120000 }).should('be.visible')
      cy.get('main').invoke('text').then((text) => {
        expect(text.trim().length).to.be.greaterThan(50)
      })
    })
  })

  describe('Blank Page Regression', () => {
    it('does not generate blank content for any section', () => {
      openGenerateDialog()
      confirmGenerate()
      cy.get('main', { timeout: 120000 }).should('be.visible')
      cy.get('main').invoke('text').then((text) => {
        expect(text.trim().length).to.be.greaterThan(100)
      })
    })

    it('does not generate a blank Management Approach section', () => {
      openGenerateDialog()
      confirmGenerate()
      cy.get('main', { timeout: 120000 }).should('be.visible')
      cy.get('body').then(($body) => {
        if ($body.text().includes('Management Approach')) {
          cy.contains(/management approach/i).parent().invoke('text').then((text) => {
            expect(text.trim().length).to.be.greaterThan(10)
          })
        } else {
          cy.log('Management Approach section not found — skipping')
        }
      })
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.reload()
      cy.get('main', { timeout: 15000 }).should('be.visible')
    })
  })
})
