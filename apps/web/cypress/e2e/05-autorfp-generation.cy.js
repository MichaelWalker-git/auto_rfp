// 05-autorfp-generation.cy.js — AutoRFP Document Generation
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'
const PROJECT_ID = '51651b52-8c6f-4489-806e-7e2605481e83'
const OPP_ID = '60f2607b-526b-46a0-b26e-b9c97c7ee6c4'
const OPP_URL = `/organizations/${ORG_ID}/projects/${PROJECT_ID}/opportunities/${OPP_ID}/`

const goToOpportunity = () => {
  cy.visit(OPP_URL, { failOnStatusCode: false })
  cy.get('main', { timeout: 15000 }).should('be.visible')
}

const openGenerateDialog = () => {
  cy.get('#rfp-documents', { timeout: 15000 }).scrollIntoView()
  cy.get('#rfp-documents').contains('button', /^Generate$/).should('be.visible').click({ force: true })
  cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible')
  cy.get('[role="dialog"]').contains('Generate Documents').should('be.visible')
}

describe('AutoRFP Generation', () => {
  before(() => { cy.login(); goToOpportunity() })

  describe('Happy Path', () => {
    it('shows a Generate button on the opportunity', () => {
      cy.get('#rfp-documents', { timeout: 15000 }).scrollIntoView()
      cy.get('#rfp-documents').contains('button', /^Generate$/).should('be.visible')
    })
  })

  describe('Generate Dialog', () => {
    beforeEach(() => { cy.login(); goToOpportunity() })

    it('opens dialog with document type options and controls', () => {
      openGenerateDialog()
      cy.get('[role="dialog"]').contains('Select document types to generate').should('be.visible')
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Cover Letter').should('be.visible')
        cy.contains('Executive Summary').should('be.visible')
        cy.contains('Technical Proposal').should('be.visible')
        cy.contains('Select all').should('be.visible')
        cy.contains('Select required').should('be.visible')
      })
      cy.get('[role="dialog"]').contains('Cancel').click()
    })

    it('cancels Generate Documents dialog', () => {
      openGenerateDialog()
      cy.get('[role="dialog"]').contains('Cancel').click()
      cy.get('#rfp-documents').should('be.visible')
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
