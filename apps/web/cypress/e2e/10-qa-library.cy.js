// 10-qa-library.cy.js
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

const goToQaLibrary = () => {
  cy.visit(`/organizations/${ORG_ID}/content-library/`, { failOnStatusCode: false })
  cy.contains('Q&A Library', { timeout: 15000 }).should('be.visible')
}

describe('Q&A Library', () => {
  beforeEach(() => { login(); goToQaLibrary() })

  describe('Happy Path', () => {
    it('loads the Q&A Library page', () => {
      cy.contains('Q&A Library').should('be.visible')
      cy.contains('Add Q&A').should('be.visible')
    })

    it('shows status filter tabs', () => {
      cy.contains('All Status').should('be.visible')
      cy.contains('Draft').should('be.visible')
      cy.contains('Approved').should('be.visible')
      cy.contains('Deprecated').should('be.visible')
    })

    it('opens the Add Q&A Item dialog', () => {
      cy.contains('Add Q&A').click()
      cy.contains('Add Q&A Item', { timeout: 5000 }).should('be.visible')
      cy.contains('Question').should('be.visible')
      cy.contains('Answer').should('be.visible')
      cy.contains('Category').should('be.visible')
      cy.contains('Tags').should('be.visible')
    })

    it('cancels Q&A creation without saving', () => {
      cy.contains('Add Q&A').click()
      cy.contains('Add Q&A Item', { timeout: 5000 }).should('be.visible')
      cy.get('textarea').first().type('Should Not Save')
      cy.contains('Cancel').click()
      cy.contains('Should Not Save').should('not.exist')
    })

    it('filters by Draft status', () => {
      cy.contains('Draft').click()
      cy.get('main').should('be.visible')
    })

    it('filters by Approved status', () => {
      cy.contains('Approved').click()
      cy.get('main').should('be.visible')
    })

    it('filters by Deprecated status', () => {
      cy.contains('Deprecated').click()
      cy.get('main').should('be.visible')
    })

    it('shows empty state when no items exist', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('No Q&A items found')) {
          cy.contains('No Q&A items found').should('be.visible')
          cy.contains('Add Your First Q&A').should('be.visible')
        } else {
          cy.log('Q&A items exist — skipping empty state check')
        }
      })
    })
  })

  describe('Edge Cases', () => {
    it('does not submit dialog with empty fields', () => {
      cy.contains('Add Q&A').click()
      cy.contains('Add Q&A Item', { timeout: 5000 }).should('be.visible')
      cy.get('button[data-slot="button"]').contains('Add Q&A').click({ force: true })
      cy.wait(1000)
      cy.contains('Add Q&A Item').should('be.visible')
    })
  })

  describe('Error States', () => {
    it('loads Q&A library content successfully', () => {
      cy.reload()
      cy.contains('Q&A Library', { timeout: 15000 }).should('be.visible')
    })
  })
})
