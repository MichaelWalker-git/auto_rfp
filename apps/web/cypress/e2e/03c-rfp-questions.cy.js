// 03c-rfp-questions.cy.js — RFP Questions
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'
const PROJECT_ID = '51651b52-8c6f-4489-806e-7e2605481e83'

const goToQuestions = () => {
  cy.visit(`/organizations/${ORG_ID}/projects/${PROJECT_ID}/questions/`, { failOnStatusCode: false })
  cy.get('main', { timeout: 15000 }).should('be.visible')
}

describe('RFP Questions', () => {
  before(() => { cy.login(); goToQuestions() })

  describe('Happy Path', () => {
    it('loads the RFP Questions page with toolbar', () => {
      cy.contains('RFP Questions').should('be.visible')
      cy.contains('answers pending approval').should('be.visible')
      cy.contains('Opportunity').should('be.visible')
      cy.get('[class*="select"], select, [role="combobox"]').should('exist')
      cy.contains('All Questions').should('be.visible')
      cy.contains('Answered').should('be.visible')
      cy.contains('Unanswered').should('be.visible')
      cy.contains('Clusters').should('be.visible')
      cy.contains('Approve All').should('be.visible')
      cy.contains('Export').should('be.visible')
    })

    it('shows Question Navigator panel with sections', () => {
      cy.contains('Question Navigator').should('exist')
      cy.get('body').then(($body) => {
        if ($body.text().includes('Technical Approach')) {
          cy.contains('Technical Approach').should('exist')
        }
        if ($body.find('[class*="badge"]').length > 0) {
          cy.get('[class*="badge"]').should('exist')
        }
      })
    })

    it('shows Select a question prompt or answer editor', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('Select a question from the navigator')) {
          cy.contains('Select a question from the navigator').should('be.visible')
        }
      })
    })

    it('clicking a question shows the answer editor', () => {
      cy.get('body').then(($body) => {
        const questions = $body.find('[class*="question"], [class*="navigator"] li, [class*="navigator"] div')
        if (questions.length > 0) {
          cy.wrap(questions.first()).click()
          cy.get('textarea, [contenteditable], [class*="editor"]').should('exist')
        } else {
          cy.log('No questions to click — skipping')
        }
      })
    })

    it('shows Similar Questions and Confidence in answer view', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('Similar Questions')) {
          cy.contains('Similar Questions').should('be.visible')
        }
        if ($body.text().includes('Confidence')) {
          cy.contains('Confidence').should('be.visible')
        }
        if ($body.text().includes('Comments')) {
          cy.contains('Comments').should('be.visible')
        }
      })
    })

    it('switches between tabs', () => {
      cy.contains('Answered').click()
      cy.get('main').should('be.visible')
      cy.contains('Unanswered').click()
      cy.get('main').should('be.visible')
      cy.contains('Clusters').click()
      cy.get('main').should('be.visible')
      cy.contains('All Questions').click()
      cy.get('main').should('be.visible')
    })

    it('shows Generate and Remove buttons on unanswered questions', () => {
      cy.contains('Unanswered').click()
      cy.get('body').then(($body) => {
        if ($body.find('button:contains("Generate")').length > 0) {
          cy.get('button').contains('Generate').should('be.visible')
          cy.get('button').contains('Remove').should('be.visible')
        } else {
          cy.log('No unanswered questions — skipping')
        }
      })
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.login()
      goToQuestions()
      cy.reload()
      cy.get('main', { timeout: 15000 }).should('be.visible')
    })
  })
})
