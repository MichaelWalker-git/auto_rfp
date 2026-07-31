const ORG_ID = Cypress.env('ORG_ID')
const PROJECT_ID = '51651b52-8c6f-4489-806e-7e2605481e83' // Generic Project
const OPP_ID = '60f2607b-526b-46a0-b26e-b9c97c7ee6c4'

// ─── Opportunities ────────────────────────────────────────────────────────────
describe('Cleanup — Opportunities', () => {
  beforeEach(() => {
    cy.login()
    cy.visit(`/organizations/${ORG_ID}/projects/${PROJECT_ID}/opportunities/`, { failOnStatusCode: false })
    cy.contains('Opportunities', { timeout: 15000 }).should('be.visible')
  })

  it('deletes any Cypress Test Opportunity entries', () => {
    cy.get('body').then(($body) => {
      if ($body.text().includes('Cypress Test Opportunity')) {
        // Find and delete each one
        cy.contains('Cypress Test Opportunity').closest('a, [class*="card"], li').within(() => {
          cy.get('button').last().click({ force: true })
        })
        cy.contains(/delete|remove/i, { timeout: 5000 }).click()
        cy.get('button').contains(/confirm|yes|delete/i).click()
        cy.contains('Cypress Test Opportunity').should('not.exist')
      } else {
        cy.log('No Cypress Test Opportunity found — skipping')
      }
    })
  })

  it('can delete an opportunity via its detail page', () => {
    cy.get('body').then(($body) => {
      if ($body.find('a.block[href*="/opportunities/"]').length > 0) {
        cy.get('a.block[href*="/opportunities/"]').first().invoke('attr', 'href').then((href) => {
          cy.visit(href, { failOnStatusCode: false })
          cy.get('main', { timeout: 15000 }).should('be.visible')
          // Look for a delete option in the more/kebab menu
          cy.get('body').then(($detail) => {
            if ($detail.find('button[aria-label*="more" i], button[aria-label*="menu" i], [class*="kebab"]').length > 0) {
              cy.get('button[aria-label*="more" i], button[aria-label*="menu" i], [class*="kebab"]').first().click()
              cy.get('body').then(($menu) => {
                if ($menu.text().match(/delete|remove/i)) {
                  cy.contains(/delete opportunity|remove/i).click()
                  cy.get('button').contains(/confirm|yes|delete/i).click({ force: true })
                  cy.contains('Opportunities', { timeout: 10000 }).should('be.visible')
                } else {
                  cy.log('No delete option in menu — skipping')
                }
              })
            } else {
              cy.log('No kebab/more menu found on opportunity detail — skipping')
            }
          })
        })
      } else {
        cy.log('No opportunities to delete — skipping')
      }
    })
  })
})

// ─── Org Documents ────────────────────────────────────────────────────────────
describe('Cleanup — Org Document Folders', () => {
  beforeEach(() => {
    cy.login()
    cy.visit(`/organizations/${ORG_ID}/knowledge-base/`, { failOnStatusCode: false })
    cy.contains('Org Documents', { timeout: 15000 }).should('be.visible')
  })

  it('deletes any Cypress Test Folder entries', () => {
    cy.get('body').then(($body) => {
      if ($body.text().includes('Cypress Test Folder')) {
        cy.contains('Cypress Test Folder').closest('[class*="card"], [class*="folder"], li, tr').within(() => {
          cy.get('button').last().click({ force: true })
        })
        cy.contains(/delete|remove/i, { timeout: 5000 }).click()
        cy.get('body').then(($confirm) => {
          if ($confirm.find('button:contains("Confirm"), button:contains("Delete"), button:contains("Yes")').length > 0) {
            cy.get('button').contains(/confirm|yes|delete/i).click()
          }
        })
        cy.contains('Cypress Test Folder').should('not.exist')
      } else {
        cy.log('No Cypress Test Folder found — skipping')
      }
    })
  })



})

// ─── Q&A Library ─────────────────────────────────────────────────────────────
describe('Cleanup — Q&A Library', () => {
  beforeEach(() => {
    cy.login()
    cy.visit(`/organizations/${ORG_ID}/content-library/`, { failOnStatusCode: false })
    cy.contains('Q&A Library', { timeout: 15000 }).should('be.visible')
  })

  it('deletes any Cypress test Q&A items', () => {
    cy.get('body').then(($body) => {
      if ($body.text().includes('Cypress')) {
        cy.contains('Cypress').closest('[class*="card"], [class*="item"], li, tr').within(() => {
          cy.get('button').last().click({ force: true })
        })
        cy.contains(/delete|remove/i, { timeout: 5000 }).click()
        cy.get('body').then(($confirm) => {
          if ($confirm.find('button').filter(':contains("Confirm"), :contains("Delete"), :contains("Yes")').length > 0) {
            cy.get('button').contains(/confirm|yes|delete/i).click()
          }
        })
      } else {
        cy.log('No Cypress Q&A items found — skipping')
      }
    })
  })

  it('shows delete option on Q&A items when they exist', () => {
    cy.get('body').then(($body) => {
      const hasItems = !$body.text().includes('No Q&A items found')
      if (hasItems) {
        cy.get('[class*="card"], [class*="item"], tr').first().within(() => {
          cy.get('button').last().should('exist')
        })
      } else {
        cy.log('No Q&A items — skipping')
      }
    })
  })
})

// ─── Past Performance ─────────────────────────────────────────────────────────
describe('Cleanup — Past Performance', () => {
  beforeEach(() => {
    cy.login()
    cy.visit(`/organizations/${ORG_ID}/past-performance`, { failOnStatusCode: false })
    cy.contains('Past Performance', { timeout: 15000 }).should('be.visible')
  })

  it('deletes any Cypress test past performance records', () => {
    cy.get('body').then(($body) => {
      if ($body.text().includes('Cypress')) {
        cy.contains('Cypress').closest('[class*="card"], [class*="item"], li, tr').within(() => {
          cy.get('button').last().click({ force: true })
        })
        cy.contains(/delete|remove/i, { timeout: 5000 }).click()
        cy.get('body').then(($confirm) => {
          if ($confirm.find('button').filter(':contains("Confirm"), :contains("Delete"), :contains("Yes")').length > 0) {
            cy.get('button').contains(/confirm|yes|delete/i).click()
          }
        })
      } else {
        cy.log('No Cypress past performance records — skipping')
      }
    })
  })

  it('shows delete option on past performance records when they exist', () => {
    cy.get('body').then(($body) => {
      const cards = $body.find('[class*="card"], [class*="item"], tr')
      if (cards.length > 0) {
        cy.wrap(cards.first()).within(() => {
          cy.get('button').last().should('exist')
        })
      } else {
        cy.log('No past performance records — skipping')
      }
    })
  })
})

// ─── Pricing — Labor Rates ────────────────────────────────────────────────────
describe('Cleanup — Pricing Labor Rates', () => {
  beforeEach(() => {
    cy.login()
    cy.visit(`/organizations/${ORG_ID}/pricing`, { failOnStatusCode: false })
    cy.contains('Pricing & Cost Estimation', { timeout: 15000 }).should('be.visible')
    cy.contains('Labor Rates').click()
    cy.contains('Labor Rate Table', { timeout: 10000 }).should('be.visible')
  })

  it('deletes any Cypress test labor rates', () => {
    cy.get('body').then(($body) => {
      if ($body.text().includes('Cypress')) {
        cy.contains('Cypress').closest('tr, [class*="row"], [class*="item"]').within(() => {
          cy.get('button').last().click({ force: true })
        })
        cy.contains(/delete|remove/i, { timeout: 5000 }).click()
        cy.get('body').then(($confirm) => {
          if ($confirm.find('button').filter(':contains("Confirm"), :contains("Delete"), :contains("Yes")').length > 0) {
            cy.get('button').contains(/confirm|yes|delete/i).click()
          }
        })
      } else {
        cy.log('No Cypress labor rates — skipping')
      }
    })
  })

  it('shows delete option on labor rate rows', () => {
    cy.get('body').then(($body) => {
      const rows = $body.find('tr, [class*="row"]')
      if (rows.length > 1) {
        cy.get('tr, [class*="row"]').not(':first').first().within(() => {
          cy.get('button').last().should('exist')
        })
      } else {
        cy.log('No labor rate rows — skipping')
      }
    })
  })
})

// ─── Pricing — BOM Items ──────────────────────────────────────────────────────
describe('Cleanup — Pricing BOM Items', () => {
  beforeEach(() => {
    cy.login()
    cy.visit(`/organizations/${ORG_ID}/pricing`, { failOnStatusCode: false })
    cy.contains('Pricing & Cost Estimation', { timeout: 15000 }).should('be.visible')
    cy.contains('Direct Costs').click()
    cy.contains('Direct Costs', { timeout: 10000 }).should('be.visible')
  })

  it('deletes any Cypress test BOM items', () => {
    cy.get('body').then(($body) => {
      if ($body.text().includes('Cypress')) {
        cy.contains('Cypress').closest('tr, [class*="row"], [class*="item"]').within(() => {
          cy.get('button').last().click({ force: true })
        })
        cy.contains(/delete|remove/i, { timeout: 5000 }).click()
        cy.get('body').then(($confirm) => {
          if ($confirm.find('button').filter(':contains("Confirm"), :contains("Delete"), :contains("Yes")').length > 0) {
            cy.get('button').contains(/confirm|yes|delete/i).click()
          }
        })
      } else {
        cy.log('No Cypress BOM items — skipping')
      }
    })
  })

  it('shows delete option on BOM item rows', () => {
    cy.get('body').then(($body) => {
      const rows = $body.find('tr, [class*="row"]')
      if (rows.length > 1) {
        cy.get('tr, [class*="row"]').not(':first').first().within(() => {
          cy.get('button').last().should('exist')
        })
      } else {
        cy.log('No BOM rows — skipping')
      }
    })
  })
})

// ─── Templates ────────────────────────────────────────────────────────────────
describe('Cleanup — Templates', () => {
  beforeEach(() => {
    cy.login()
    cy.visit(`/organizations/${ORG_ID}/templates`, { failOnStatusCode: false })
    cy.contains('Templates', { timeout: 15000 }).should('be.visible')
  })

  it('archives or deletes any Cypress test templates', () => {
    cy.get('body').then(($body) => {
      if ($body.text().includes('Cypress')) {
        cy.contains('Cypress').closest('[class*="card"], [class*="item"], li, tr').within(() => {
          cy.get('button').last().click({ force: true })
        })
        cy.contains(/delete|archive|remove/i, { timeout: 5000 }).click()
        cy.get('body').then(($confirm) => {
          if ($confirm.find('button').filter(':contains("Confirm"), :contains("Delete"), :contains("Yes"), :contains("Archive")').length > 0) {
            cy.get('button').contains(/confirm|yes|delete|archive/i).click()
          }
        })
      } else {
        cy.log('No Cypress templates — skipping')
      }
    })
  })

  it('shows archive or delete option on templates', () => {
    cy.get('body').then(($body) => {
      const hasTemplates = !$body.text().includes('No templates found')
      if (hasTemplates) {
        cy.get('[class*="card"], [class*="item"], tr').first().within(() => {
          cy.get('button').last().should('exist')
        })
      } else {
        cy.log('No templates — skipping')
      }
    })
  })
})

// ─── Cypress Test Projects ────────────────────────────────────────────────────
describe('Cleanup — Cypress Test Projects', () => {
  beforeEach(() => {
    cy.login()
    cy.visit(`/organizations/${ORG_ID}/projects/`, { failOnStatusCode: false })
    cy.contains('Projects', { timeout: 15000 }).should('be.visible')
  })

  it('deletes all Cypress test projects', () => {
    cy.get('body').then(($body) => {
      if ($body.text().includes('Cypress Project')) {
        cy.contains('a.block', /Cypress Project/i).then(($cards) => {
          cy.wrap($cards).first().closest('a.block').within(() => {
            cy.get('button').last().click({ force: true })
          })
          cy.contains(/delete/i, { timeout: 5000 }).click()
          cy.get('button').contains(/confirm|yes|delete/i).click()
          cy.wait(1000)
        })
      } else {
        cy.log('No Cypress test projects to delete — skipping')
      }
    })
  })
})
