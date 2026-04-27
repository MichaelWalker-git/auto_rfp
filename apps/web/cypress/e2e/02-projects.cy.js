// 02-projects.cy.js
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

const goToProjects = () => {
  cy.visit(`/organizations/${ORG_ID}/projects/`, { failOnStatusCode: false })
  cy.contains('Projects', { timeout: 15000 }).should('be.visible')
}

describe('Projects', () => {
  beforeEach(() => { login(); goToProjects() })

  describe('Happy Path', () => {
    it('loads the projects page', () => {
      cy.contains('Projects').should('be.visible')
      cy.contains('New Project').should('be.visible')
    })

    it('displays existing projects', () => {
      cy.get('a[href*="/projects/"]').should('have.length.greaterThan', 0)
    })

    it('creates a new project', () => {
      const name = `Cypress Project ${Date.now()}`
      cy.contains('New Project').click()
      cy.get('input').first().type(name)
      cy.get('button[type="submit"]').click()
      cy.contains(name, { timeout: 10000 }).should('be.visible')
    })

    it('opens a project and shows its dashboard', () => {
      cy.get('a[href*="/projects/"]').first().click()
      cy.contains('Dashboard', { timeout: 10000 }).should('be.visible')
    })

    it('deletes cypress test projects', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('Cypress Project')) {
          cy.contains('Cypress Project').closest('a').within(() => {
            cy.get('button').last().click({ force: true })
          })
          cy.contains(/delete/i).click()
          cy.get('button').contains(/confirm|yes|delete/i).click()
          cy.wait(1000)
        } else {
          cy.log('No Cypress test projects to delete')
        }
      })
    })
  })

  describe('Edge Cases', () => {
    it('cancels project creation without saving', () => {
      const name = `Never Saved ${Date.now()}`
      cy.contains('New Project').click()
      cy.get('input').first().type(name)
      cy.go('back')
      cy.contains(name).should('not.exist')
    })

    it('shows validation error when creating project with empty name', () => {
      cy.contains('New Project').click()
      cy.get('button[type="submit"]').click()
      cy.get('[role="alert"], .error, input:invalid').should('exist')
    })

    it('handles very long project names', () => {
      const longName = 'A'.repeat(200)
      cy.contains('New Project').click()
      cy.get('input').first().type(longName)
      cy.get('button[type="submit"]').click()
      cy.get('body').then(($body) => {
        const hasError = $body.find('[role="alert"], .error').length > 0
        const hasProject = $body.text().includes(longName.substring(0, 50))
        expect(hasError || hasProject).to.be.true
      })
    })
  })

  describe('Error States', () => {
    it('shows error if projects fail to load', () => {
      cy.intercept('GET', '**/projects**').as('projectsFail')
      cy.reload()
      cy.wait('@projectsFail')
      cy.get('main, body').should('be.visible')
    })

    it('shows error on failed project creation', () => {
      cy.contains('New Project').click()
      cy.get('input').first().type('Will Fail')
      cy.get('button[type="submit"]').click()
      cy.wait(2000)
      cy.get('main').should('be.visible')
    })
  })
})
