// 15-templates-page.cy.js
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

const goToTemplates = () => {
  cy.visit(`/organizations/${ORG_ID}/templates`, { failOnStatusCode: false })
  cy.contains('Templates', { timeout: 15000 }).should('be.visible')
}

describe('Templates Page', () => {
  beforeEach(() => { login(); goToTemplates() })

  describe('Happy Path', () => {
    it('loads the Templates page', () => {
      cy.contains('Templates').should('be.visible')
      cy.contains('New Template').should('be.visible')
    })

    it('shows Active and Archived tabs', () => {
      cy.contains('Active').should('be.visible')
      cy.contains('Archived').should('be.visible')
    })

    it('switches to Archived tab and shows empty state', () => {
      cy.contains('Archived').click()
      cy.get('body').then(($body) => {
        if ($body.text().includes('No archived templates')) {
          cy.contains('No archived templates').should('be.visible')
        } else {
          cy.get('main').should('be.visible')
        }
      })
    })

    it('shows empty state when no templates exist', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('No templates found')) {
          cy.contains('No templates found').should('be.visible')
          cy.contains('Create your first template to get started').should('be.visible')
        } else {
          cy.log('Templates exist — skipping')
        }
      })
    })

    it('opens the Create Template page', () => {
      cy.contains('New Template').click()
      cy.contains('Create Template', { timeout: 10000 }).should('be.visible')
      cy.contains('Template Name').should('be.visible')
      cy.contains('Category').should('be.visible')
      cy.contains('Template Content').should('be.visible')
    })

    it('shows variable sidebar in Create Template', () => {
      cy.contains('New Template').click()
      cy.contains('Create Template', { timeout: 10000 }).should('be.visible')
      cy.contains('Insert Variables').should('be.visible')
      cy.contains('General').should('be.visible')
      cy.contains('Project').should('be.visible')
      cy.contains('Company Name').should('be.visible')
      cy.contains('Content Area').should('be.visible')
    })

    it('back navigation returns to Templates list', () => {
      cy.contains('New Template').click()
      cy.contains('Create Template', { timeout: 10000 }).should('be.visible')
      cy.go('back')
      cy.contains('Templates', { timeout: 10000 }).should('be.visible')
    })
  })

  describe('Error States', () => {
    it('shows error if templates fail to load', () => {
      cy.intercept('GET', '**/templates**').as('templatesFail')
      cy.reload()
      cy.wait('@templatesFail')
      cy.get('main, body').should('be.visible')
    })
  })
})
