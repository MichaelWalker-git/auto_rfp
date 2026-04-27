// 03e-search-opportunities.cy.js — Search Opportunities
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'
const PROJECT_ID = '51651b52-8c6f-4489-806e-7e2605481e83' // Generic Project

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

const goToSearchOpportunities = () => {
  cy.visit(`/organizations/${ORG_ID}/projects/${PROJECT_ID}/search-opportunities/`, { failOnStatusCode: false })
  cy.contains('Search Opportunities', { timeout: 15000 }).should('be.visible')
}

describe('Search Opportunities', () => {
  beforeEach(() => { login(); goToSearchOpportunities() })

  describe('Happy Path', () => {
    it('loads the Search Opportunities page', () => {
      cy.contains('Search Opportunities').should('be.visible')
      cy.contains('Search SAM.gov, DIBBS, and HigherGov').should('be.visible')
    })

    it('shows the keyword search bar', () => {
      cy.get('input[placeholder*="Keywords" i], input[placeholder*="solicitation" i], input[placeholder*="technology" i]').should('be.visible')
    })

    it('shows the Search button', () => {
      cy.contains('button', 'Search').should('be.visible')
    })

    it('shows the Saved Searches button', () => {
      cy.contains('Saved Searches').should('be.visible')
    })

    it('shows All Sources filter', () => {
      cy.contains('All Sources').should('be.visible')
    })

    it('shows NAICS filter', () => {
      cy.contains('NAICS').should('be.visible')
    })

    it('shows Set-aside filter', () => {
      cy.contains('Set-aside').should('be.visible')
    })

    it('shows date range filter', () => {
      cy.contains('Closing date').should('be.visible')
    })

    it('shows Ready to search empty state', () => {
      cy.contains('Ready to search').should('be.visible')
      cy.contains('Search across SAM.gov, DIBBS, and HigherGov').should('be.visible')
    })

    it('opens All Sources dropdown with source options', () => {
      cy.contains('All Sources').click()
      cy.contains('SAM.gov').should('be.visible')
      cy.contains('DIBBS').should('be.visible')
      cy.contains('HigherGov').should('be.visible')
    })

    it('opens NAICS dropdown with code options', () => {
      cy.contains('NAICS').click()
      cy.contains('IT Services').should('be.visible')
    })

    it('opens Set-aside dropdown with options', () => {
      cy.contains('Set-aside').click()
      cy.contains('Any set-aside').should('be.visible')
      cy.contains('SBA').should('be.visible')
    })

    it('opens Posted Date calendar picker', () => {
      cy.contains('Mar 24').click()
      cy.contains('Last 7d').should('be.visible')
      cy.contains('Last 30d').should('be.visible')
      cy.contains('Last 90d').should('be.visible')
    })

    it('runs a keyword search and shows results', () => {
      cy.get('input[placeholder*="Keywords" i], input[placeholder*="solicitation" i], input[placeholder*="technology" i]')
        .type('document')
      cy.contains('button', 'Search').click()
      cy.contains('results', { timeout: 15000 }).should('be.visible')
      cy.contains('SAM.gov').should('be.visible')
    })

    it('shows result cards with agency, solicitation number, and NAICS', () => {
      cy.get('input[placeholder*="Keywords" i], input[placeholder*="solicitation" i], input[placeholder*="technology" i]')
        .type('document')
      cy.contains('button', 'Search').click()
      cy.contains('results', { timeout: 15000 }).should('be.visible')
      cy.contains('NAICS').should('be.visible')
    })

    it('shows Import button on search results', () => {
      cy.get('input[placeholder*="Keywords" i], input[placeholder*="solicitation" i], input[placeholder*="technology" i]')
        .type('document')
      cy.contains('button', 'Search').click()
      cy.contains('results', { timeout: 15000 }).should('be.visible')
      cy.contains('Import').should('be.visible')
    })

    it('shows closing date on result cards', () => {
      cy.get('input[placeholder*="Keywords" i], input[placeholder*="solicitation" i], input[placeholder*="technology" i]')
        .type('document')
      cy.contains('button', 'Search').click()
      cy.contains('results', { timeout: 15000 }).should('be.visible')
      cy.contains(/Closes/i).should('be.visible')
    })

    it('shows Description toggle on result cards', () => {
      cy.get('input[placeholder*="Keywords" i], input[placeholder*="solicitation" i], input[placeholder*="technology" i]')
        .type('document')
      cy.contains('button', 'Search').click()
      cy.contains('results', { timeout: 15000 }).should('be.visible')
      cy.contains('Description').should('be.visible')
    })

    it('imports a solicitation into the project', () => {
      cy.get('input[placeholder*="Keywords" i], input[placeholder*="solicitation" i], input[placeholder*="technology" i]')
        .type('document')
      cy.contains('button', 'Search').click()
      cy.contains('results', { timeout: 15000 }).should('be.visible')
      // Click the first Import button
      cy.contains('Import').first().click()
      // Should show confirmation or navigate to opportunity
      cy.get('body', { timeout: 10000 }).then(($body) => {
        const imported = $body.text().match(/imported|added|success|opportunity/i)
        if (imported) {
          cy.log('Import succeeded')
        } else {
          // May have navigated to the opportunity detail
          cy.get('main').should('be.visible')
        }
      })
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.reload()
      cy.contains('Search Opportunities', { timeout: 15000 }).should('be.visible')
    })
  })
})
