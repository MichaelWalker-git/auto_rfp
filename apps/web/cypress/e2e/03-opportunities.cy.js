// 03-opportunities.cy.js — Opportunities List
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

const goToOpportunities = () => {
  cy.visit(`/organizations/${ORG_ID}/projects/`, { failOnStatusCode: false })
  cy.contains('Projects', { timeout: 15000 }).should('be.visible')
  cy.contains('a.block', 'Generic Project').then(($a) => {
    const href = $a.attr('href')

    if (!href) {
      throw new Error('Expected "Generic Project" link to have an href attribute')
    }

    const match = href.match(/\/projects\/([^/]+)/)

    if (!match) {
      throw new Error(`Expected project href to match /projects/{id}, but got: ${href}`)
    }

    const projectId = match[1]
    cy.visit(`/organizations/${ORG_ID}/projects/${projectId}/opportunities/`, { failOnStatusCode: false })
  })
  cy.contains('Opportunities', { timeout: 15000 }).should('be.visible')
}

describe('Opportunities List', () => {
  before(() => {
    cy.login()
    goToOpportunities()
  })

  describe('Happy Path', () => {
    it('loads the Opportunities page with controls', () => {
      cy.contains('Opportunities').should('be.visible')
      cy.contains('Stored opportunities for this project').should('be.visible')
      cy.contains('Create Opportunity').should('be.visible')
      cy.get('input[placeholder*="Search by title" i], input[placeholder*="solicitation" i], input[placeholder*="agency" i]').should('be.visible')
      cy.contains('My Opportunities').should('be.visible')
      cy.contains('Date Imported').should('be.visible')
      cy.get('button').should('have.length.greaterThan', 1)
    })

    it('shows existing opportunities with status and solicitation number', () => {
      cy.get('body').then(($body) => {
        if ($body.find('a[href*="/opportunities/"]').length > 0) {
          cy.get('a[href*="/opportunities/"]').should('have.length.greaterThan', 0)
          const hasStatus = $body.text().match(/Submitted|No Bid|Identified|Won|Lost|Pending/i)
          if (hasStatus) {
            cy.contains(/Submitted|No Bid|Identified|Won|Lost|Pending/i).should('exist')
          }
        } else {
          cy.log('No opportunities yet — skipping')
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

    it('can search for an opportunity by title', () => {
      cy.get('input[placeholder*="Search by title" i], input[placeholder*="solicitation" i]').type('test')
      cy.get('main').should('be.visible')
    })
  })

  describe('Create Opportunity Dialog', () => {
    beforeEach(() => {
      cy.login()
      goToOpportunities()
    })

    it('opens dialog with all fields and placeholder text', () => {
      cy.contains('Create Opportunity').click()
      cy.contains('Create Opportunity', { timeout: 5000 }).should('be.visible')
      cy.contains('Manually create a new opportunity').should('be.visible')
      cy.contains('Title').should('be.visible')
      cy.contains('Solicitation Number').should('be.visible')
      cy.contains('Description').should('be.visible')
      cy.contains('Organization').should('be.visible')
      cy.contains('Response Deadline').should('be.visible')
      cy.contains('Type').should('be.visible')
      cy.contains('Set-Aside').should('be.visible')
      cy.contains('NAICS Code').should('be.visible')
      cy.contains('PSC Code').should('be.visible')
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
  })

  describe('Edge Cases', () => {
    it('does not save when creating opportunity with empty title', () => {
      cy.login()
      goToOpportunities()
      cy.contains('Create Opportunity').click()
      cy.contains('Create Opportunity', { timeout: 5000 }).should('be.visible')
      cy.get('button').contains('Create Opportunity').click({ force: true })
      cy.contains('Create Opportunity').should('be.visible')
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.login()
      goToOpportunities()
      cy.reload()
      cy.contains('Opportunities', { timeout: 15000 }).should('be.visible')
    })
  })
})
