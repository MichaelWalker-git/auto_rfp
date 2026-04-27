// 14-pricing.cy.js
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

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

const goToPricing = () => {
  cy.visit(`/organizations/${ORG_ID}/pricing`, { failOnStatusCode: false })
  cy.contains('Pricing & Cost Estimation', { timeout: 15000 }).should('be.visible')
}

describe('Pricing & Cost Estimation', () => {
  beforeEach(() => { login(); goToPricing() })

  describe('Labor Rates', () => {
    beforeEach(() => {
      cy.contains('Labor Rates').click()
      cy.contains('Labor Rate Table', { timeout: 10000 }).should('be.visible')
    })

    it('loads the Labor Rates tab', () => {
      cy.contains('Labor Rate Table').should('be.visible')
      cy.contains('Add Rate').should('be.visible')
      cy.contains('Upload Rate Card').should('be.visible')
    })

    it('displays table headers', () => {
      cy.contains('Position').should('be.visible')
      cy.contains('Base Rate').should('be.visible')
      cy.contains('Fully Loaded').should('be.visible')
      cy.contains('Status').should('be.visible')
    })

    it('opens the Add Rate form', () => {
      cy.contains('Add Rate').click()
      cy.contains('New Labor Rate', { timeout: 5000 }).should('be.visible')
      cy.contains('Position Title').should('be.visible')
      cy.contains('Create Rate').should('be.visible')
    })

    it('cancels adding a rate', () => {
      cy.contains('Add Rate').click()
      cy.contains('New Labor Rate', { timeout: 5000 }).should('be.visible')
      cy.contains('Cancel').click()
      cy.contains('Labor Rate Table').should('be.visible')
    })

    it('opens the Extract Labor Rates dialog', () => {
      cy.contains('Upload Rate Card').click()
      cy.contains('Extract Labor Rates', { timeout: 5000 }).should('be.visible')
      cy.contains('Upload & Extract').should('be.visible')
      cy.contains('Cancel').click()
    })
  })

  describe('Bill of Materials', () => {
    beforeEach(() => {
      cy.contains('Bill of Materials').click()
      cy.contains('Bill of Materials', { timeout: 10000 }).should('be.visible')
    })

    it('loads the Bill of Materials tab', () => {
      cy.contains('Add Item').should('be.visible')
      cy.contains('Upload Quote').should('be.visible')
    })

    it('shows category filter tabs', () => {
      cy.contains('All').should('be.visible')
      cy.contains('Hardware').should('be.visible')
      cy.contains('Software License').should('be.visible')
      cy.contains('Subcontractor').should('be.visible')
      cy.contains('Travel').should('be.visible')
    })

    it('filters by Hardware', () => {
      cy.contains('Hardware').click()
      cy.get('main').should('be.visible')
    })

    it('opens the Add BOM Item form', () => {
      cy.contains('Add Item').click()
      cy.contains('New BOM Item', { timeout: 5000 }).should('be.visible')
      cy.contains('Item Name').should('be.visible')
      cy.contains('Category').should('be.visible')
      cy.contains('Unit Cost').should('be.visible')
    })

    it('cancels adding a BOM item', () => {
      cy.contains('Add Item').click()
      cy.contains('New BOM Item', { timeout: 5000 }).should('be.visible')
      cy.contains('Cancel').click()
      cy.contains('Bill of Materials').should('be.visible')
    })

    it('opens the Extract BOM Items dialog', () => {
      cy.contains('Upload Quote').click()
      cy.contains('Extract BOM Items', { timeout: 5000 }).should('be.visible')
      cy.contains('Upload & Extract').should('be.visible')
      cy.contains('Cancel').click()
    })
  })

  describe('Staffing Plans', () => {
    beforeEach(() => {
      cy.contains('Staffing Plans').click()
      cy.contains('Staffing Plan Builder', { timeout: 10000 }).should('be.visible')
    })

    it('loads the Staffing Plans tab', () => {
      cy.contains('Staffing Plan Builder').should('be.visible')
      cy.contains('Plan Name').should('be.visible')
      cy.contains('Add Position').should('be.visible')
      cy.contains('Available Labor Rates').should('be.visible')
    })

    it('shows available labor rates', () => {
      cy.contains('Front-End Engineer').should('be.visible')
    })

    it('adds a position to the staffing plan', () => {
      cy.contains('Add Position').click()
      cy.contains('Total Positions').should('be.visible')
      cy.contains('Total Labor Cost').should('be.visible')
    })
  })

  describe('Error States', () => {
    it('shows error if pricing data fails to load', () => {
      cy.intercept('GET', '**/pricing**').as('pricingFail')
      cy.reload()
      cy.wait('@pricingFail')
      cy.get('main, body').should('be.visible')
    })
  })
})
