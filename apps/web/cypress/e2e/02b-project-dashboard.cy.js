// 02b-project-dashboard.cy.js — Project Dashboard
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

const goToDashboard = () => {
  cy.visit(`/organizations/${ORG_ID}/projects/`, { failOnStatusCode: false })
  cy.contains('Projects', { timeout: 15000 }).should('be.visible')
  // Extract project ID from the card href and build the dashboard URL directly
  cy.get('a.block[href*="/projects/"]').first().then(($a) => {
    const href = $a.attr('href')
    const match = href.match(/\/projects\/([^/]+)/)
    const projectId = match[1]
    cy.visit(`/organizations/${ORG_ID}/projects/${projectId}/dashboard/`, { failOnStatusCode: false })
  })
  cy.get('main', { timeout: 15000 }).should('be.visible')
}

describe('Project Dashboard', () => {
  beforeEach(() => {
    login()
    goToDashboard()
  })

  describe('Happy Path', () => {
    it('loads the project dashboard', () => {
      cy.contains('Dashboard').should('be.visible')
      cy.get('main').should('be.visible')
    })

    it('shows the project name and description', () => {
      cy.get('main').should('be.visible')
      cy.get('h1, h2, [class*="title"]').should('exist')
    })

    it('shows Created and Updated dates', () => {
      cy.contains('Created').should('exist')
      cy.contains('Updated').should('exist')
    })

    it('shows Opportunities metric card', () => {
      cy.contains('Opportunities').should('be.visible')
    })

    it('shows Executive Briefs metric card', () => {
      cy.contains('Executive Briefs').should('be.visible')
    })

    it('shows Questions metric card', () => {
      cy.contains('Questions').should('be.visible')
    })

    it('shows RFP Documents metric card', () => {
      cy.contains('RFP Documents').should('be.visible')
    })

    it('shows Outcomes metric card', () => {
      cy.contains('Outcomes').should('be.visible')
    })

    it('shows Solicitation Documents metric card', () => {
      cy.contains('Solicitation Documents').should('be.visible')
    })

    it('shows Quick Actions section', () => {
      cy.contains('Quick Actions').should('be.visible')
    })

    it('shows all four Quick Action buttons', () => {
      cy.contains('View Opportunities').should('be.visible')
      cy.contains('Executive Brief').should('be.visible')
      cy.contains('Answer Questions').should('be.visible')
      cy.contains('Project Settings').should('be.visible')
    })

    it('navigates to Opportunities via View Opportunities quick action', () => {
      cy.contains('View Opportunities').click()
      cy.contains('Opportunities', { timeout: 10000 }).should('be.visible')
    })

    it('navigates to Project Settings via quick action', () => {
      cy.contains('Project Settings').click()
      cy.contains('Project Settings', { timeout: 10000 }).should('be.visible')
    })

    it('shows sidebar navigation links', () => {
      cy.contains('Search Opportunities').should('be.visible')
      cy.contains('Opportunities').should('be.visible')
      cy.contains('Executive Briefs').should('be.visible')
      cy.contains('Q&A Engagement Tools').should('be.visible')
      cy.contains('Questions').should('be.visible')
      cy.contains('Settings').should('be.visible')
    })

    it('navigates to Opportunities via sidebar', () => {
      cy.contains('Opportunities').click()
      cy.contains('Opportunities', { timeout: 10000 }).should('be.visible')
    })

    it('navigates to Questions via sidebar', () => {
      cy.contains('Questions').click()
      cy.get('main', { timeout: 10000 }).should('be.visible')
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.reload()
      cy.contains('Dashboard', { timeout: 15000 }).should('be.visible')
    })
  })
})
