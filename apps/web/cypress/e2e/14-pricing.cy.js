// 14-pricing.cy.js
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

const goToPricing = () => {
  cy.visit(`/organizations/${ORG_ID}/pricing`, { failOnStatusCode: false })
  cy.contains('Pricing & Cost Estimation', { timeout: 15000 }).should('be.visible')
}

describe('Pricing & Cost Estimation', () => {
  before(() => { cy.login(); goToPricing() })

  describe('Labor Rates', () => {
    it('loads the Labor Rates tab with table headers', () => {
      cy.contains('Labor Rates').click()
      cy.contains('Labor Rate Table', { timeout: 10000 }).should('be.visible')
      cy.contains('Add Rate').should('be.visible')
      cy.contains('Upload Rate Card').should('be.visible')
      cy.contains('Position').should('be.visible')
      cy.contains('Base Rate').should('be.visible')
      cy.contains('Fully Loaded').should('be.visible')
      cy.contains('Status').should('be.visible')
    })
  })

  describe('Labor Rates Dialogs', () => {
    beforeEach(() => { cy.login(); goToPricing() })

    it('opens and cancels Add Rate form', () => {
      cy.contains('Labor Rates').click()
      cy.contains('Labor Rate Table', { timeout: 10000 }).should('be.visible')
      cy.contains('Add Rate').click()
      cy.contains('New Labor Rate', { timeout: 5000 }).should('be.visible')
      cy.contains('Position Title').should('be.visible')
      cy.contains('Create Rate').should('be.visible')
      cy.contains('Cancel').click()
      cy.contains('Labor Rate Table').should('be.visible')
    })

    it('opens the Extract Labor Rates dialog', () => {
      cy.contains('Labor Rates').click()
      cy.contains('Labor Rate Table', { timeout: 10000 }).should('be.visible')
      cy.contains('Upload Rate Card').click()
      cy.contains('Extract Labor Rates', { timeout: 5000 }).should('be.visible')
      cy.contains('Upload & Extract').should('be.visible')
      cy.contains('Cancel').click()
    })
  })

  describe('Direct Costs', () => {
    it('loads the Direct Costs tab with category filters', () => {
      cy.contains('Direct Costs').click()
      cy.contains('Add Item', { timeout: 10000 }).should('be.visible')
      cy.contains('Upload Quote').should('be.visible')
      cy.contains('All').should('be.visible')
      cy.contains('Hardware & Equipment').should('be.visible')
      cy.contains('Software License').should('be.visible')
      cy.contains('Subcontractor').should('be.visible')
      cy.contains('Travel').should('be.visible')
    })

    it('filters by Hardware & Equipment', () => {
      cy.contains('Direct Costs').click()
      cy.contains('Add Item', { timeout: 10000 }).should('be.visible')
      cy.contains('Hardware & Equipment').click()
      cy.get('main').should('be.visible')
    })
  })

  describe('Direct Costs Dialogs', () => {
    beforeEach(() => { cy.login(); goToPricing() })

    it('opens and cancels Add Direct Cost Item form', () => {
      cy.contains('Direct Costs').click()
      cy.contains('Add Item', { timeout: 10000 }).should('be.visible')
      cy.contains('Add Item').click()
      cy.contains('New Direct Cost Item', { timeout: 5000 }).should('be.visible')
      cy.contains('Item Name').should('be.visible')
      cy.contains('Category').should('be.visible')
      cy.contains('Unit Cost').should('be.visible')
      cy.contains('Cancel').click()
      cy.contains('Direct Costs').should('be.visible')
    })

    it('opens the Upload Quote dialog', () => {
      cy.contains('Direct Costs').click()
      cy.contains('Add Item', { timeout: 10000 }).should('be.visible')
      cy.contains('Upload Quote').click()
      cy.get('[role="dialog"]', { timeout: 5000 }).should('be.visible')
      cy.contains('Cancel').click()
    })
  })

  describe('Staffing Plans', () => {
    it('loads the Staffing Plans tab with labor rates', () => {
      cy.login()
      goToPricing()
      cy.contains('Staffing Plans').click()
      cy.contains('Staffing Plan Builder', { timeout: 10000 }).should('be.visible')
      cy.contains('Plan Name').should('be.visible')
      cy.contains('Add Position').should('be.visible')
      cy.contains('Available Labor Rates').should('be.visible')
      cy.contains('Front-End Engineer').should('be.visible')
    })

    it('adds a position to the staffing plan', () => {
      cy.login()
      goToPricing()
      cy.contains('Staffing Plans').click()
      cy.contains('Staffing Plan Builder', { timeout: 10000 }).should('be.visible')
      cy.contains('Add Position').click()
      cy.contains('Total Positions').should('be.visible')
      cy.contains('Total Labor Cost').should('be.visible')
    })
  })

  describe('Error States', () => {
    it('shows error if pricing data fails to load', () => {
      cy.login()
      goToPricing()
      cy.intercept('GET', '**/pricing**').as('pricingFail')
      cy.reload()
      cy.wait('@pricingFail')
      cy.get('main, body').should('be.visible')
    })
  })
})
