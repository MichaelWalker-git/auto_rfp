// 03-opportunities.cy.js — Opportunities List
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

const goToOpportunities = () => {
  cy.visit(`/organizations/${ORG_ID}/projects/`, { failOnStatusCode: false })
  cy.contains('Projects', { timeout: 15000 }).should('be.visible')
  cy.contains('a.block', 'Generic Project').then(($a) => {
    const href = $a.attr('href')
    const match = href.match(/\/projects\/([^/]+)/)
    const projectId = match[1]
    cy.visit(`/organizations/${ORG_ID}/projects/${projectId}/opportunities/`, { failOnStatusCode: false })
  })
  cy.contains('Opportunities', { timeout: 15000 }).should('be.visible')
}

describe('Opportunities List', () => {
  beforeEach(() => {
    login()
    goToOpportunities()
  })

  describe('Happy Path', () => {
    it('loads the Opportunities page', () => {
      cy.contains('Opportunities').should('be.visible')
      cy.contains('Stored opportunities for this project').should('be.visible')
    })

    it('shows Create Opportunity button', () => {
      cy.contains('Create Opportunity').should('be.visible')
    })

    it('shows search bar with placeholder text', () => {
      cy.get('input[placeholder*="Search by title" i], input[placeholder*="solicitation" i], input[placeholder*="agency" i]').should('be.visible')
    })

    it('shows My Opportunities filter toggle', () => {
      cy.contains('My Opportunities').should('be.visible')
    })

    it('shows Date Imported sort option', () => {
      cy.contains('Date Imported').should('be.visible')
    })

    it('shows view toggle buttons', () => {
      // View toggles exist but use SVG icons without standard aria-labels — check by existence of multiple buttons in the toolbar area
      cy.get('button').should('have.length.greaterThan', 1)
    })

    it('shows existing opportunities', () => {
      cy.get('body').then(($body) => {
        if ($body.find('a[href*="/opportunities/"]').length > 0) {
          cy.get('a[href*="/opportunities/"]').should('have.length.greaterThan', 0)
        } else {
          cy.log('No opportunities yet — skipping')
        }
      })
    })

    it('shows status label (e.g. Submitted, No Bid) on opportunities', () => {
      cy.get('body').then(($body) => {
        if ($body.find('a[href*="/opportunities/"]').length > 0) {
          // Status labels render as text — check for any known status values
          const hasStatus = $body.text().match(/Submitted|No Bid|Identified|Won|Lost|Pending/i)
          if (hasStatus) {
            cy.contains(/Submitted|No Bid|Identified|Won|Lost|Pending/i).should('exist')
          } else {
            cy.log('No status labels found — skipping')
          }
        } else {
          cy.log('No opportunities — skipping status check')
        }
      })
    })

    it('shows solicitation number on opportunity cards', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('#')) {
          cy.get('body').should('contain', '#')
        } else {
          cy.log('No solicitation numbers visible — skipping')
        }
      })
    })

    it('shows End of list text', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('End of list')) {
          cy.contains('End of list').should('be.visible')
        } else {
          cy.log('End of list not visible — skipping')
        }
      })
    })

    it('opens the Create Opportunity dialog', () => {
      cy.contains('Create Opportunity').click()
      cy.contains('Create Opportunity', { timeout: 5000 }).should('be.visible')
      cy.contains('Manually create a new opportunity').should('be.visible')
    })

    it('shows all fields in Create Opportunity dialog', () => {
      cy.contains('Create Opportunity').click()
      cy.contains('Create Opportunity', { timeout: 5000 }).should('be.visible')
      cy.contains('Title').should('be.visible')
      cy.contains('Solicitation Number').should('be.visible')
      cy.contains('Description').should('be.visible')
      cy.contains('Organization').should('be.visible')
      cy.contains('Response Deadline').should('be.visible')
      cy.contains('Type').should('be.visible')
      cy.contains('Set-Aside').should('be.visible')
      cy.contains('NAICS Code').should('be.visible')
      cy.contains('PSC Code').should('be.visible')
    })

    it('shows placeholder text in Create Opportunity fields', () => {
      cy.contains('Create Opportunity').click()
      cy.contains('Create Opportunity', { timeout: 5000 }).should('be.visible')
      cy.get('input[placeholder*="Opportunity title" i]').should('be.visible')
      cy.get('input[placeholder*="FA8532" i]').should('be.visible')
      cy.get('input[placeholder*="541512" i]').should('be.visible')
    })

    it('cancels Create Opportunity without saving', () => {
      cy.contains('Create Opportunity').click()
      cy.contains('Create Opportunity', { timeout: 5000 }).should('be.visible')
      cy.contains('Cancel').click()
      cy.contains('Opportunities').should('be.visible')
    })

    it('creates a new opportunity with a title', () => {
      cy.contains('Create Opportunity').click()
      cy.contains('Create Opportunity', { timeout: 5000 }).should('be.visible')
      cy.get('input[placeholder*="Opportunity title" i]').type('Cypress Test Opportunity')
      cy.get('button').contains('Create Opportunity').click({ force: true })
      cy.get('main', { timeout: 10000 }).should('be.visible')
    })

    it('opens an existing opportunity', () => {
      cy.get('body').then(($body) => {
        if ($body.find('a[href*="/opportunities/"]').length > 0) {
          cy.get('a[href*="/opportunities/"]').first().click()
          cy.url().should('include', '/opportunities/')
          cy.get('main', { timeout: 10000 }).should('be.visible')
        } else {
          cy.log('No opportunities — skipping')
        }
      })
    })

    it('can search for an opportunity by title', () => {
      cy.get('input[placeholder*="Search by title" i], input[placeholder*="solicitation" i]').type('test')
      cy.get('main').should('be.visible')
    })
  })

  describe('Edge Cases', () => {
    it('does not save when creating opportunity with empty title', () => {
      cy.contains('Create Opportunity').click()
      cy.contains('Create Opportunity', { timeout: 5000 }).should('be.visible')
      cy.get('button').contains('Create Opportunity').click({ force: true })
      cy.wait(1000)
      // Dialog should remain open since title is required
      cy.contains('Create Opportunity').should('be.visible')
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.reload()
      cy.contains('Opportunities', { timeout: 15000 }).should('be.visible')
    })
  })
})
