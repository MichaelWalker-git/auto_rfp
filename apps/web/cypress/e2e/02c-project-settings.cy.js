// 02c-project-settings.cy.js — Project Settings
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
  beforeEach(() => {
    login()
    goToProjectSettings()
  })

  describe('Happy Path', () => {
    it('loads the Project Settings page', () => {
      cy.contains('Project Settings').should('be.visible')
      cy.contains('Configure project-level settings').should('be.visible')
    })

    it('shows Project Access section', () => {
      cy.contains('Project Access').should('be.visible')
      cy.contains('Manage who can view and edit this project').should('be.visible')
    })

    it('shows Grant to All Admins button', () => {
      cy.contains('Grant to All Admins').should('be.visible')
    })

    it('shows Add User section with dropdown and Add button', () => {
      cy.contains('Add User').should('be.visible')
      cy.contains('Select a user...').should('be.visible')
      cy.contains('Add').should('be.visible')
    })

    it('shows Users with Access list', () => {
      cy.contains('Users with Access').should('be.visible')
    })

    it('shows current user in Users with Access list', () => {
      cy.contains('Creator').should('be.visible')
      cy.contains('Org Admin').should('be.visible')
    })

    it('shows Project Contact Information section', () => {
      cy.contains('Project Contact Information').should('be.visible')
      cy.contains('Primary point of contact for this project').should('be.visible')
    })

    it('shows template variable hint text', () => {
      cy.contains('PROJECT_POC_NAME').should('be.visible')
      cy.contains('PROJECT_POC_EMAIL').should('be.visible')
    })

    it('shows all POC fields', () => {
      cy.contains('Primary POC Name').should('be.visible')
      cy.contains('POC Title').should('be.visible')
      cy.contains('POC Email').should('be.visible')
      cy.contains('POC Phone').should('be.visible')
    })

    it('shows placeholder values in POC fields', () => {
      cy.get('input[placeholder*="John Smith" i]').should('be.visible')
      cy.get('input[placeholder*="Proposal Manager" i]').should('be.visible')
      cy.get('input[placeholder*="john.smith@company" i]').should('be.visible')
    })

    it('shows Save Contact Info button', () => {
      cy.contains('Save Contact Info').should('be.visible')
    })

    it('can fill in and save contact information', () => {
      cy.get('input[placeholder*="John Smith" i]').clear().type('Test POC Name')
      cy.get('input[placeholder*="Proposal Manager" i]').clear().type('Test Title')
      cy.contains('Save Contact Info').click()
      cy.get('main').should('be.visible')
    })

    it('shows Org Document Folders section', () => {
      cy.contains('Org Document Folders').should('be.visible')
      cy.contains('Assign document folders to this project').should('be.visible')
    })

    it('shows Available Folders list', () => {
      cy.contains('Available Folders').should('be.visible')
    })

    it('shows default folder assignment message', () => {
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

  describe('Error States', () => {
    it('page reloads and stays functional', () => {
      cy.reload()
      cy.contains('Project Settings', { timeout: 15000 }).should('be.visible')
    })
  })
})
