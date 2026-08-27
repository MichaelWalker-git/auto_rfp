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

// This suite runs against the DEPLOYED site (see `baseUrl` in cypress.config.ts),
// which on a PR is still whatever is currently on `develop` — the PR's own build is
// never served here. So an assertion that only holds after this branch ships can
// never go green on this PR; it would have to be merged first, then pass. Any
// assertion touching copy this branch changes therefore has to accept BOTH the old
// and the new wording, and the branch-specific behaviour is pinned by the component
// tests instead (components/opportunities/__tests__/SearchOpportunityForm.test.tsx
// and ProjectSearchOpportunitiesPage.test.tsx), which do run against this code.
//
// before: "Search SAM.gov, DIBBS, and HigherGov — results import directly…"
//  after: "Search SAM.gov and HigherGov. Importing pulls the solicitation…"
const PAGE_DESCRIPTION = /Search SAM\.gov(,| and)/i
// before: placeholder="Keywords, solicitation number, technology area…"
//  after: placeholder="Title contains… (SAM.gov matches notice titles only)"
const KEYWORD_INPUT = 'input[placeholder*="Title contains" i], input[placeholder*="Keywords" i]'
// The page now has a Radix "Search" TAB (a <button role="tab">) above the form,
// so a bare cy.contains('button', 'Search') matches the tab first and clicking
// it is a no-op — the search never fires. The form's real Search button is the
// only type="submit" button, so scope to that.
const SEARCH_BUTTON = 'button[type="submit"]'

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
    // SAM.gov is the default provider both before and after this branch, so the
    // SAM.gov filters below (NAICS, set-aside, closing date) render either way.
    it('loads the Search Opportunities page with all controls', () => {
      cy.contains('Search Opportunities').should('be.visible')
      cy.contains(PAGE_DESCRIPTION).should('be.visible')
      cy.get(KEYWORD_INPUT).should('be.visible')
      cy.contains(SEARCH_BUTTON, 'Search').should('be.visible')
      cy.contains('Saved Searches').should('be.visible')
      cy.contains('NAICS').should('be.visible')
      cy.contains('Set-aside').should('be.visible')
      cy.contains('Closing date').should('be.visible')
      cy.contains('Ready to search').should('be.visible')
    })

    // The provider list itself is NOT asserted here. "DIBBS is absent" is true only
    // of this branch, and this suite hits the deployed `develop` build (see the note
    // above), where DIBBS is still offered — so asserting it here fails until after
    // merge. It is covered against this code by
    // SearchOpportunityForm.test.tsx → 'DIBBS is not offered as a provider', which
    // also pins that stale ?source=DIBBS / ?source=all URLs coerce to SAM.gov.
    it('opens the NAICS and set-aside filters', () => {
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
      cy.get(KEYWORD_INPUT)
        .type('document')
      cy.contains(SEARCH_BUTTON, 'Search').click()
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

      cy.get(KEYWORD_INPUT)
        .type('document')
      cy.contains(SEARCH_BUTTON, 'Search').click()
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
