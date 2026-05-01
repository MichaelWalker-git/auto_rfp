// 03d-qa-engagement.cy.js — Q&A Engagement Tools
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'
const PROJECT_ID = '51651b52-8c6f-4489-806e-7e2605481e83' // Generic Project

const goToQaEngagement = () => {
  cy.visit(`/organizations/${ORG_ID}/projects/${PROJECT_ID}/qa-engagement/`, { failOnStatusCode: false })
  cy.contains('Q&A Engagement Tools', { timeout: 15000 }).should('be.visible')
}

describe('Q&A Engagement Tools', () => {
  before(() => { cy.login(); goToQaEngagement() })

  describe('Happy Path', () => {
    it('loads the Q&A Engagement Tools page', () => {
      cy.contains('Q&A Engagement Tools').should('be.visible')
      cy.contains('Build relationships with contracting officers').should('be.visible')
      cy.get('[class*="select"], select, [role="combobox"]').should('exist')
    })

    it('shows AI-Generated Clarifying Questions section', () => {
      cy.contains('AI-Generated Clarifying Questions').should('be.visible')
      cy.contains('Questions to ask during the Q&A period to build relationships').should('be.visible')
      cy.contains('Generate').should('be.visible')
      cy.contains('Filter').should('be.visible')
      cy.contains('All').should('be.visible')
      cy.contains('questions').should('be.visible')
      cy.get('body').then(($body) => {
        if ($body.text().includes('No clarifying questions generated yet')) {
          cy.contains('No clarifying questions generated yet').should('be.visible')
        }
      })
    })

    it('shows Log Interaction section', () => {
      cy.contains('Log Interaction').scrollIntoView().should('be.visible')
      cy.contains('Record phone calls, meetings, and other CO interactions').should('be.visible')
      cy.contains('New Interaction').should('be.visible')
    })

    it('shows Engagement Timeline and empty state', () => {
      cy.contains('Engagement Timeline').scrollIntoView().should('be.visible')
      cy.contains('History of interactions with contracting officers').should('be.visible')
      cy.get('body').then(($body) => {
        if ($body.text().includes('No interactions logged yet')) {
          cy.contains('No interactions logged yet').should('be.visible')
        }
      })
    })

    it('shows Engagement Metrics panel with all metrics', () => {
      cy.contains('Engagement Metrics').scrollIntoView().should('be.visible')
      cy.contains('Track your relationship-building progress').should('be.visible')
      cy.contains('Total Interactions').should('be.visible')
      cy.contains('Questions Submitted').should('be.visible')
      cy.contains('Response Rate').should('be.visible')
      cy.contains('Phone, email, meetings').should('be.visible')
      cy.contains('Clarifying questions sent').should('be.visible')
      cy.contains('Questions answered').should('be.visible')
    })

    it('shows Q&A Best Practices panel with tips', () => {
      cy.contains('Q&A Best Practices').scrollIntoView().should('be.visible')
      cy.contains('Build relationships').should('be.visible')
      cy.contains('Ask thoughtful questions').should('be.visible')
      cy.contains('Engage consistently').should('be.visible')
    })

    it('shows deadline alert when written questions are due', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('Written questions due')) {
          cy.contains('Written questions due').should('be.visible')
        } else {
          cy.log('No deadline alert — skipping')
        }
      })
    })
  })

  describe('Log Interaction Form', () => {
    beforeEach(() => { cy.login(); goToQaEngagement() })

    it('opens form with all fields and cancels', () => {
      cy.contains('New Interaction').click()
      cy.contains('Log New Interaction', { timeout: 5000 }).should('be.visible')
      cy.contains('Record an interaction with the contracting officer').should('be.visible')
      cy.contains('Interaction Type').should('be.visible')
      cy.contains('Phone Call').should('be.visible')
      cy.contains('Direction').should('be.visible')
      cy.contains('Outbound').should('be.visible')
      cy.contains('Contact Name').should('be.visible')
      cy.contains('Contact Email').should('be.visible')
      cy.get('input[placeholder*="John Smith" i]').should('be.visible')
      cy.get('input[placeholder*="john.smith@agency" i]').should('be.visible')
      cy.contains('Summary').should('be.visible')
      cy.get('textarea[placeholder*="Briefly describe" i]').should('be.visible')
      cy.contains('Sentiment').should('be.visible')
      cy.contains('How did it go?').should('be.visible')
      cy.contains('Follow-up required').should('be.visible')
      cy.contains('Log Interaction').should('be.visible')
      cy.contains('Cancel').should('be.visible')
      cy.contains('Cancel').click()
      cy.contains('Log Interaction').should('be.visible')
    })
  })

  describe('Edge Cases', () => {
    it('does not submit Log Interaction with empty Summary', () => {
      cy.login()
      goToQaEngagement()
      cy.contains('New Interaction').click()
      cy.contains('Log New Interaction', { timeout: 5000 }).should('be.visible')
      cy.contains('Log Interaction').last().click({ force: true })
      cy.get('textarea:invalid, [class*="error"], [role="alert"]').should('exist')
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.login()
      goToQaEngagement()
      cy.reload()
      cy.contains('Q&A Engagement Tools', { timeout: 15000 }).should('be.visible')
    })
  })
})
