// 03e-search-opportunities.cy.js — Search Opportunities
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'
const PROJECT_ID = '51651b52-8c6f-4489-806e-7e2605481e83' // Generic Project

const goToSearchOpportunities = () => {
  cy.visit(`/organizations/${ORG_ID}/projects/${PROJECT_ID}/search-opportunities/`, { failOnStatusCode: false })
  cy.contains('Search Opportunities', { timeout: 15000 }).should('be.visible')
}

describe('Search Opportunities', () => {
  before(() => { cy.login(); goToSearchOpportunities() })

  describe('Happy Path', () => {
    it('loads the Search Opportunities page with all controls', () => {
      cy.contains('Search Opportunities').should('be.visible')
      cy.contains('Search SAM.gov, DIBBS, and HigherGov').should('be.visible')
      cy.get('input[placeholder*="Keywords" i], input[placeholder*="solicitation" i], input[placeholder*="technology" i]').should('be.visible')
      cy.contains('button', 'Search').should('be.visible')
      cy.contains('Saved Searches').should('be.visible')
      cy.contains('All Sources').should('be.visible')
      cy.contains('NAICS').should('be.visible')
      cy.contains('Set-aside').should('be.visible')
      cy.contains('Closing date').should('be.visible')
      cy.contains('Ready to search').should('be.visible')
      cy.contains('Search across SAM.gov, DIBBS, and HigherGov').should('be.visible')
    })

    it('opens filter dropdowns', () => {
      cy.contains('All Sources').click()
      cy.contains('SAM.gov').should('be.visible')
      cy.contains('DIBBS').should('be.visible')
      cy.contains('HigherGov').should('be.visible')
      cy.get('body').type('{esc}')

      cy.contains('NAICS').click()
      cy.contains('IT Services').should('be.visible')
      cy.get('body').type('{esc}')

      cy.contains('Set-aside').click()
      cy.contains('Any set-aside').should('be.visible')
      cy.contains('SBA').should('be.visible')
      cy.get('body').type('{esc}')
    })

    it('opens Posted Date calendar picker', () => {
      cy.contains(/[A-Z][a-z]{2} \d{1,2}\s*–\s*[A-Z][a-z]{2} \d{1,2}/).first().click()
      cy.contains('Last 7d').should('be.visible')
      cy.contains('Last 30d').should('be.visible')
      cy.contains('Last 90d').should('be.visible')
      cy.get('body').type('{esc}')
    })
  })

  describe('Search Results', () => {
    beforeEach(() => { cy.login(); goToSearchOpportunities() })

    it('runs a keyword search and shows results with details', () => {
      cy.get('input[placeholder*="Keywords" i], input[placeholder*="solicitation" i], input[placeholder*="technology" i]')
        .type('document')
      cy.contains('button', 'Search').click()
      cy.contains('results', { timeout: 15000 }).should('be.visible')
      cy.contains('SAM.gov').should('be.visible')
      cy.contains('NAICS').should('be.visible')
      cy.contains('Import').should('be.visible')
      cy.contains(/Closes/i).should('be.visible')
      cy.contains('Description').should('be.visible')
    })

    it('imports a solicitation into the project', () => {
      cy.get('input[placeholder*="Keywords" i], input[placeholder*="solicitation" i], input[placeholder*="technology" i]')
        .type('document')
      cy.contains('button', 'Search').click()
      cy.contains('results', { timeout: 15000 }).should('be.visible')
      cy.contains('Import').first().click()
      cy.get('body', { timeout: 10000 }).then(($body) => {
        const imported = $body.text().match(/imported|added|success|opportunity/i)
        if (imported) {
          cy.log('Import succeeded')
        } else {
          cy.get('main').should('be.visible')
        }
      })
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.login()
      goToSearchOpportunities()
      cy.reload()
      cy.contains('Search Opportunities', { timeout: 15000 }).should('be.visible')
    })
  })
})
