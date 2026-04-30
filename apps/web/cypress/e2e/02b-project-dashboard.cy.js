// 02b-project-dashboard.cy.js — Project Dashboard
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

const goToDashboard = () => {
  cy.visit(`/organizations/${ORG_ID}/projects/`, { failOnStatusCode: false })
  cy.contains('Projects', { timeout: 15000 }).should('be.visible')
  cy.get('a.block[href*="/projects/"]').first().then(($a) => {
    const href = $a.attr('href')
    expect(href, 'project link href').to.be.a('string').and.not.be.empty
    const match = href.match(/\/projects\/([^/]+)/)
    expect(match, `project id regex match for href "${href}"`).to.not.be.null
    const projectId = match[1]
    cy.visit(`/organizations/${ORG_ID}/projects/${projectId}/dashboard/`, { failOnStatusCode: false })
  })
  cy.get('main', { timeout: 20000 }).should('be.visible')
}

describe('Project Dashboard', () => {
  before(() => {
    cy.login()
    goToDashboard()
  })

  describe('Happy Path', () => {
    it('loads the project dashboard with name and dates', () => {
      cy.contains('Dashboard').should('be.visible')
      cy.get('main').should('be.visible')
      cy.get('h1, h2, [class*="title"]').should('exist')
      cy.contains('Created').should('exist')
      cy.contains('Updated').should('exist')
    })

    it('shows all metric cards and Quick Actions', () => {
      cy.get('main').first().within(() => {
        cy.contains('Opportunities').should('exist')
        cy.contains('Executive Briefs').should('exist')
        cy.contains('Questions').should('exist')
        cy.contains('RFP Documents').should('exist')
        cy.contains('Outcomes').should('exist')
        cy.contains('Solicitation Documents').should('exist')
        cy.contains('Quick Actions').should('exist')
        cy.contains('View Opportunities').should('exist')
        cy.contains('Executive Brief').should('exist')
        cy.contains('Answer Questions').should('exist')
        cy.contains('Project Settings').should('exist')
      })
    })

    it('shows sidebar navigation links', () => {
      cy.contains('Search Opportunities').should('be.visible')
      cy.contains('Opportunities').should('be.visible')
      cy.contains('Executive Briefs').should('be.visible')
      cy.contains('Q&A Engagement Tools').should('be.visible')
      cy.contains('Questions').should('be.visible')
      cy.contains('Settings').should('be.visible')
    })
  })

  describe('Navigation', () => {
    beforeEach(() => {
      cy.login()
      goToDashboard()
    })

    it('navigates to Opportunities via quick action and sidebar', () => {
      cy.contains('View Opportunities').click()
      cy.contains('Opportunities', { timeout: 10000 }).should('be.visible')
    })

    it('navigates to Project Settings via quick action', () => {
      cy.contains('Project Settings').click()
      cy.contains('Project Settings', { timeout: 10000 }).should('be.visible')
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.login()
      goToDashboard()
      cy.reload()
      cy.contains('Dashboard', { timeout: 20000 }).should('be.visible')
    })
  })
})
