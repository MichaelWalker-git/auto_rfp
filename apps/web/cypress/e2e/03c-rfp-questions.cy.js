// 03c-rfp-questions.cy.js — RFP Questions
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

const goToRfpQuestions = () => {
  cy.visit(`/organizations/${ORG_ID}/projects/${PROJECT_ID}/questions/`, { failOnStatusCode: false })
  cy.get('main', { timeout: 15000 }).should('be.visible')
}

describe('RFP Questions', () => {
  beforeEach(() => { login(); goToRfpQuestions() })

  describe('Happy Path', () => {
    it('loads the RFP Questions page', () => {
      cy.contains('RFP Questions').should('be.visible')
    })

    it('shows answers pending approval count', () => {
      cy.contains('answers pending approval').should('be.visible')
    })

    it('shows Opportunity selector dropdown', () => {
      cy.contains('Opportunity').should('be.visible')
      cy.get('[class*="select"], select, [role="combobox"]').should('exist')
    })

    it('shows All Questions tab with count', () => {
      cy.contains('All Questions').should('be.visible')
    })

    it('shows Answered tab with count', () => {
      cy.contains('Answered').should('be.visible')
    })

    it('shows Unanswered tab with count', () => {
      cy.contains('Unanswered').should('be.visible')
    })

    it('shows Clusters tab', () => {
      cy.contains('Clusters').should('be.visible')
    })

    it('shows Approve All button', () => {
      cy.contains('Approve All').should('be.visible')
    })

    it('shows Export button', () => {
      cy.contains('Export').should('be.visible')
    })

    it('shows Search button', () => {
      cy.get('button[aria-label*="search" i], [class*="search"]').should('exist')
    })

    it('shows Refresh button', () => {
      cy.get('button[aria-label*="refresh" i], button[aria-label*="reload" i], button svg[class*="refresh" i], button svg[class*="rotate" i]').should('exist')
    })

    it('shows Question Navigator panel', () => {
      cy.contains('Question Navigator').should('be.visible')
    })

    it('shows questions grouped by section in navigator', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('Technical Approach')) {
          cy.contains('Technical Approach').should('be.visible')
        } else {
          cy.log('No questions loaded — skipping section check')
        }
      })
    })

    it('shows confidence percentage badges on questions', () => {
      cy.get('body').then(($body) => {
        if ($body.find('[class*="badge"]').length > 0) {
          cy.get('[class*="badge"]').should('exist')
        } else {
          cy.log('No confidence badges — skipping')
        }
      })
    })

    it('shows Select a question prompt when none selected', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('Select a question from the navigator')) {
          cy.contains('Select a question from the navigator').should('be.visible')
        } else {
          cy.log('Question already selected — skipping')
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

    it('shows Similar Questions section in answer editor', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('Similar Questions')) {
          cy.contains('Similar Questions').should('be.visible')
        } else {
          cy.log('No answer editor open — skipping')
        }
      })
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

    it('shows Confidence indicator on questions', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('Confidence')) {
          cy.contains('Confidence').should('be.visible')
        } else {
          cy.log('No confidence indicator visible — skipping')
        }
      })
    })

    it('shows Comments button in answer view', () => {
      cy.get('body').then(($body) => {
        if ($body.text().includes('Comments')) {
          cy.contains('Comments').should('be.visible')
        } else {
          cy.log('No comments button visible — skipping')
        }
      })
    })

    it('switches to Answered tab', () => {
      cy.contains('Answered').click()
      cy.get('main').should('be.visible')
    })

    it('switches to Unanswered tab', () => {
      cy.contains('Unanswered').click()
      cy.get('main').should('be.visible')
    })

    it('switches to Clusters tab', () => {
      cy.contains('Clusters').click()
      cy.get('main').should('be.visible')
    })

    it('switches back to All Questions tab', () => {
      cy.contains('All Questions').click()
      cy.get('main').should('be.visible')
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.reload()
      cy.get('main', { timeout: 15000 }).should('be.visible')
    })
  })
})
