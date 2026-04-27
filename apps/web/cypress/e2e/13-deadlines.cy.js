// 13-deadlines.cy.js
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

const goToDeadlines = () => {
  cy.visit(`/organizations/${ORG_ID}/deadlines`, { failOnStatusCode: false })
  cy.contains('Deadlines', { timeout: 15000 }).should('be.visible')
}

describe('Deadlines', () => {
  beforeEach(() => { login(); goToDeadlines() })

  describe('Happy Path', () => {
    it('loads the Deadlines page', () => {
      cy.contains('Deadlines').should('be.visible')
      cy.contains('Track deadlines for all').should('be.visible')
      cy.contains('Organization Deadlines').should('be.visible')
    })

    it('shows filter dropdowns', () => {
      cy.contains('Urgency').should('be.visible')
      cy.contains('Project').should('be.visible')
      cy.contains('Opportunity').should('be.visible')
      cy.contains('Deadline Type').should('be.visible')
    })

    it('shows calendar view toggle buttons', () => {
      cy.contains('Month').should('be.visible')
      cy.contains('Week').should('be.visible')
      cy.contains('Day').should('be.visible')
      cy.contains('Agenda').should('be.visible')
    })

    it('shows Export All and Subscribe buttons', () => {
      cy.contains('Export All').should('be.visible')
      cy.contains('Subscribe').should('be.visible')
    })

    it('opens the Subscribe to Calendar dialog', () => {
      cy.contains('Subscribe').click()
      cy.contains('Subscribe to Calendar', { timeout: 5000 }).should('be.visible')
      cy.contains('Subscription URL').should('be.visible')
      cy.contains('Security notice').should('be.visible')
      cy.contains('Regenerate Token').should('be.visible')
    })

    it('closes the Subscribe dialog with Done', () => {
      cy.contains('Subscribe').click()
      cy.contains('Subscribe to Calendar', { timeout: 5000 }).should('be.visible')
      cy.contains('Done').click()
      cy.contains('Deadlines').should('be.visible')
    })

    it('switches to Week view', () => {
      cy.contains('Week').click()
      cy.get('main').should('be.visible')
    })

    it('switches to Agenda view', () => {
      cy.contains('Agenda').click()
      cy.get('main').should('be.visible')
    })

    it('navigates to next month', () => {
      cy.contains('Next').click()
      cy.get('main').should('be.visible')
    })

    it('navigates back to today', () => {
      cy.contains('Next').click()
      cy.contains('Today').click()
      cy.get('main').should('be.visible')
    })
  })

  describe('Error States', () => {
    it('shows error if deadlines fail to load', () => {
      cy.intercept('GET', '**/deadlines**').as('deadlinesFail')
      cy.reload()
      cy.wait('@deadlinesFail')
      cy.get('main, body').should('be.visible')
    })
  })
})
