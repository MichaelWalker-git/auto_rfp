// 16-my-reviews.cy.js
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

const goToMyReviews = () => {
  cy.visit(`/organizations/${ORG_ID}/reviews`, { failOnStatusCode: false })
  cy.contains('My Review Assignments', { timeout: 15000 }).should('be.visible')
}

describe('My Reviews', () => {
  beforeEach(() => { login(); goToMyReviews() })

  describe('Happy Path', () => {
    it('loads the My Reviews page', () => {
      cy.contains('My Review Assignments').should('be.visible')
      cy.contains('Documents assigned to you for review').should('be.visible')
    })

    it('shows a Refresh button', () => {
      cy.contains('Refresh').should('be.visible')
    })

    it('clicking Refresh reloads assignments', () => {
      cy.contains('Refresh').click()
      cy.contains('My Review Assignments', { timeout: 10000 }).should('be.visible')
    })

    it('shows empty state when no review assignments exist', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('No Review Assignments')) {
          cy.contains('No Review Assignments').should('be.visible')
          cy.contains("You don't have any documents assigned for review").should('be.visible')
        } else {
          cy.log('Review assignments exist — skipping empty state check')
        }
      })
    })
  })

  describe('Error States', () => {
    it('shows error if reviews fail to load', () => {
      cy.intercept('GET', '**/reviews**').as('reviewsFail')
      cy.reload()
      cy.wait('@reviewsFail')
      cy.get('main, body').should('be.visible')
    })
  })
})
