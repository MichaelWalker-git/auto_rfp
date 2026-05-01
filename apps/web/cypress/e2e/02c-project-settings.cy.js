// 02c-project-settings.cy.js — Project Settings
const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'

const goToProjectSettings = () => {
  cy.visit(`/organizations/${ORG_ID}/projects/`, { failOnStatusCode: false })
  cy.contains('Projects', { timeout: 15000 }).should('be.visible')
  cy.get('a.block[href*="/projects/"]').first().then(($a) => {
    const href = $a.attr('href')
    const match = href.match(/\/projects\/([^/]+)/)
    const projectId = match[1]
    cy.visit(`/organizations/${ORG_ID}/projects/${projectId}/settings/`, { failOnStatusCode: false })
  })
  cy.contains('Project Settings', { timeout: 15000 }).should('be.visible')
}

describe('Project Settings', () => {
  before(() => {
    cy.login()
    goToProjectSettings()
  })

  describe('Happy Path', () => {
    it('loads the Project Settings page', () => {
      cy.contains('Project Settings').should('be.visible')
      cy.contains('Configure project-level settings').should('be.visible')
    })

    it('shows Project Access section with controls', () => {
      cy.contains('Project Access').should('be.visible')
      cy.contains('Manage who can view and edit this project').should('be.visible')
      cy.contains('Grant to All Admins').should('be.visible')
      cy.contains('Add User').should('be.visible')
      cy.contains('Select a user...').should('be.visible')
      cy.contains('Add').should('be.visible')
      cy.contains('Users with Access').should('be.visible')
      cy.contains('Creator').should('be.visible')
      cy.contains('Org Admin').should('be.visible')
    })

    it('shows Project Contact Information with POC fields', () => {
      cy.contains('Project Contact Information').scrollIntoView().should('be.visible')
      cy.contains('Primary point of contact for this project').should('be.visible')
      cy.contains('PROJECT_POC_NAME').should('be.visible')
      cy.contains('PROJECT_POC_EMAIL').should('be.visible')
      cy.contains('Primary POC Name').scrollIntoView().should('be.visible')
      cy.contains('POC Title').should('be.visible')
      cy.contains('POC Email').should('be.visible')
      cy.contains('POC Phone').should('be.visible')
      cy.get('input[placeholder*="John Smith" i]').should('be.visible')
      cy.get('input[placeholder*="Proposal Manager" i]').should('be.visible')
      cy.get('input[placeholder*="john.smith@company" i]').should('be.visible')
      cy.contains('Save Contact Info').scrollIntoView().should('be.visible')
    })

    it('shows Org Document Folders section', () => {
      cy.contains('Org Document Folders').scrollIntoView().should('be.visible')
      cy.contains('Assign document folders to this project').should('be.visible')
      cy.contains('Available Folders').should('be.visible')
      cy.get('body').then(($body) => {
        if ($body.text().includes('No folders assigned')) {
          cy.contains('No folders assigned').should('be.visible')
          cy.contains('All organization document folders will be used').should('be.visible')
        } else {
          cy.log('Folders are assigned — skipping default message check')
        }
      })
    })
  })

  describe('Mutations', () => {
    beforeEach(() => {
      cy.login()
      goToProjectSettings()
    })

    it('can fill in and save contact information', () => {
      cy.get('input[placeholder*="John Smith" i]').clear().type('Test POC Name')
      cy.get('input[placeholder*="Proposal Manager" i]').clear().type('Test Title')
      cy.contains('Save Contact Info').click()
      cy.get('main').should('be.visible')
    })
  })

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.login()
      goToProjectSettings()
      cy.reload()
      cy.contains('Project Settings', { timeout: 15000 }).should('be.visible')
    })
  })
})
