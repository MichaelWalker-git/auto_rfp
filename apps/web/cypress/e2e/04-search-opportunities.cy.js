// 04-search-opportunities.cy.js — Search Opportunities
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'
const PROJECT_ID = '51651b52-8c6f-4489-806e-7e2605481e83' // Generic Project

const goToSearchOpportunities = () => {
  cy.visit(`/organizations/${ORG_ID}/projects/${PROJECT_ID}/search-opportunities/`, { failOnStatusCode: false })
  cy.contains('Search Opportunities', { timeout: 15000 }).should('be.visible')
}

// The search results tests must not depend on live SAM.gov / DIBBS / HigherGov
// data, which is unavailable/empty in CI (external APIs, no creds) and makes the
// "Import"-button assertions flaky. Stub the unified search endpoint with a
// deterministic result so the real results-table render path (result card +
// Import button + detail badges) is exercised regardless of provider state.
const STUBBED_OPPORTUNITY = {
  id: 'cy-stub-opp-1',
  source: 'SAM_GOV',
  solicitationNumber: 'CY-DOC-001',
  noticeId: 'cy-stub-notice-1',
  title: 'Document Management Services',
  type: 'SOLICITATION',
  postedDate: '2026-07-01',
  closingDate: '2026-08-15',
  naicsCode: '541519',
  organizationName: 'Test Agency',
  contractVehicle: null,
  setAside: 'Small Business',
  technologyArea: null,
  description: 'Stubbed opportunity for e2e determinism.',
  active: true,
  baseAndAllOptionsValue: null,
  attachmentsCount: 0,
  url: 'https://sam.gov/opp/cy-stub-opp-1',
  descriptionUrl: null,
}

const stubSearch = () => {
  cy.intercept('POST', '**/search-opportunities/search*', {
    statusCode: 200,
    body: {
      opportunities: [STUBBED_OPPORTUNITY],
      totalSamGov: 1,
      totalDibbs: 0,
      totalHigherGov: 0,
      total: 1,
      samGovError: null,
      dibbsError: null,
      higherGovError: null,
    },
  }).as('searchOpportunities')
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
    beforeEach(() => { stubSearch(); cy.login(); goToSearchOpportunities() })

    it('runs a keyword search and shows results with details', () => {
      cy.get('input[placeholder*="Keywords" i], input[placeholder*="solicitation" i], input[placeholder*="technology" i]')
        .type('document')
      cy.contains('button', 'Search').click()
      cy.wait('@searchOpportunities')
      cy.contains('results', { timeout: 15000 }).should('be.visible')
      cy.contains('SAM.gov').should('be.visible')
      cy.contains('NAICS').should('be.visible')
      cy.contains('Import').should('be.visible')
      cy.contains(/Closes/i).should('be.visible')
      cy.contains(STUBBED_OPPORTUNITY.title).should('be.visible')
      // Deliberately not asserting on the description here. This suite runs
      // against the deployed site (see `baseUrl` in cypress.config.ts), so any
      // assertion has to hold for whatever is currently on develop as well as
      // for this branch — and the two render descriptions differently: a
      // "Description" toggle before, the text inline after. Description
      // behaviour is covered by the component tests in
      // components/opportunities/__tests__/SearchOpportunityResultsTable.test.tsx.
    })

    it('imports a solicitation into the project', () => {
      cy.intercept('POST', '**/search-opportunities/import-solicitation*', {
        statusCode: 200,
        body: { imported: 1 },
      }).as('importSolicitation')

      cy.get('input[placeholder*="Keywords" i], input[placeholder*="solicitation" i], input[placeholder*="technology" i]')
        .type('document')
      cy.contains('button', 'Search').click()
      cy.wait('@searchOpportunities')
      cy.contains('results', { timeout: 15000 }).should('be.visible')
      cy.contains('button', 'Import').first().click()
      cy.wait('@importSolicitation')
      cy.get('main').should('be.visible')
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
