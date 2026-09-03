// 09b-org-documents-doc-crud.cy.js
//
// Exercises the Org Documents download/rename/delete hardening work
// (docs/org-documents-improvement) end-to-end against the deployed Dev
// backend (AWS account "Dev" — API Gateway/Lambda/DynamoDB/S3/Pinecone),
// while the frontend runs locally.
//
// Run it with the Next.js dev server up (it already points at Dev via
// apps/web/.env.local) and Cypress pointed at that server instead of the
// default Amplify Dev deployment:
//
//   cd apps/web
//   pnpm dev &                       # frontend on http://localhost:3000
//   CYPRESS_BASE_URL=http://localhost:3000 \
//   CYPRESS_USER_EMAIL=<admin test user email> \
//   CYPRESS_USER_PASSWORD=<admin test user password> \
//   pnpm exec cypress run --spec cypress/e2e/09b-org-documents-doc-crud.cy.js
//
// This creates and deletes real documents (S3 objects, DynamoDB rows,
// Pinecone chunks) in the Dev environment under a dedicated "Cypress Test
// Folder" knowledge base. The suite cleans up everything it creates; the
// folder itself is also covered by cypress/e2e/99-cleanup-deletions.cy.js.

const ORG_ID = '6227a27b-744e-42f2-aad6-af72450bd17b'
const FOLDER_NAME = 'Cypress Test Folder'

const RUN_ID = Date.now()
const DOC_NAME = `cypress-doc-${RUN_ID}.txt`
const DOC_NAME_2 = `cypress-doc-${RUN_ID}-b.txt`
// No extension on purpose — rename does not enforce a file extension (D-4).
const RENAMED_DOC_NAME = `Cypress Renamed Doc ${RUN_ID}`

const makeFile = (fileName) => ({
  contents: Cypress.Buffer.from(`Cypress e2e test document — ${fileName}`),
  fileName,
  mimeType: 'text/plain',
  lastModified: Date.now(),
})

const goToOrgDocuments = () => {
  cy.visit(`/organizations/${ORG_ID}/knowledge-base/`, { failOnStatusCode: false })
  cy.contains('Org Documents', { timeout: 15000 }).should('be.visible')
}

const openTestFolder = () => {
  goToOrgDocuments()
  cy.get('body').then(($body) => {
    if (!$body.text().includes(FOLDER_NAME)) {
      cy.contains('New Folder').click()
      cy.contains('Create Document Folder', { timeout: 5000 }).should('be.visible')
      cy.get('input[placeholder*="Technical Docs" i], input[placeholder*="name" i]').type(FOLDER_NAME)
      cy.contains('Create').click()
      cy.contains('Org Documents', { timeout: 10000 }).should('be.visible')
      cy.contains(FOLDER_NAME, { timeout: 10000 }).should('be.visible')
    }
  })
  cy.contains(FOLDER_NAME, { timeout: 10000 }).click()
  cy.contains(/upload documents/i, { timeout: 15000 }).should('be.visible')
}

const docCard = (name) => cy.contains(name, { timeout: 20000 }).closest('[data-slot="card"]')

describe('Org Documents — Document CRUD (deployed Dev backend)', () => {
  before(() => {
    cy.login()
    openTestFolder()
  })

  describe('Upload', () => {
    it('uploads two documents', () => {
      cy.intercept('POST', '**/document/create-document*').as('createDocument')
      cy.intercept('POST', '**/document/start-document-pipeline*').as('startPipeline')

      cy.contains(/upload documents/i).click()
      cy.contains('Upload Documents', { timeout: 5000 }).should('be.visible')

      cy.get('#file-upload').selectFile([makeFile(DOC_NAME), makeFile(DOC_NAME_2)], { force: true })
      cy.contains(/Upload \(2\)/).click()

      cy.wait(['@createDocument', '@startPipeline', '@createDocument', '@startPipeline'], { timeout: 30000 })
      cy.contains('Upload Queue (2/2)', { timeout: 30000 }).should('be.visible')
      cy.contains('Close').click()

      docCard(DOC_NAME).should('be.visible')
      docCard(DOC_NAME_2).should('be.visible')
    })
  })

  describe('Rename', () => {
    it('rejects an empty name', () => {
      docCard(DOC_NAME).find('button[aria-label^="Rename"]').click()
      cy.get('[data-testid="document-name-input"]').clear()
      cy.get('[data-testid="document-name-input"]').type('{enter}')
      cy.get('[data-testid="document-name-error"]').should('contain.text', 'required')
      cy.get('[data-testid="document-name-input"]').type('{esc}')
      docCard(DOC_NAME).should('be.visible')
    })

    it('renames the document (extension not required)', () => {
      cy.intercept('PATCH', '**/document/edit-document*').as('editDocument')

      docCard(DOC_NAME).find('button[aria-label^="Rename"]').click()
      cy.get('[data-testid="document-name-input"]').clear()
      cy.get('[data-testid="document-name-input"]').type(`${RENAMED_DOC_NAME}{enter}`)

      cy.wait('@editDocument').its('response.statusCode').should('eq', 200)
      docCard(RENAMED_DOC_NAME).should('be.visible')
      cy.contains(DOC_NAME).should('not.exist')
    })

    it('rejects renaming to a name already used in the folder (409)', () => {
      cy.intercept('PATCH', '**/document/edit-document*').as('editDocument')

      docCard(RENAMED_DOC_NAME).find('button[aria-label^="Rename"]').click()
      cy.get('[data-testid="document-name-input"]').clear()
      cy.get('[data-testid="document-name-input"]').type(`${DOC_NAME_2}{enter}`)

      cy.wait('@editDocument').its('response.statusCode').should('eq', 409)
      cy.get('[data-testid="document-name-error"]').should('be.visible')
      cy.get('[data-testid="document-name-input"]').type('{esc}')

      docCard(RENAMED_DOC_NAME).should('be.visible')
    })
  })

  describe('Download', () => {
    it('requests a signed download URL for the current name', () => {
      cy.intercept('GET', '**/document/download*').as('downloadDocument')

      docCard(RENAMED_DOC_NAME).find(`button[aria-label="Download ${RENAMED_DOC_NAME}"]`).click()

      cy.wait('@downloadDocument').then(({ response }) => {
        expect(response.statusCode).to.eq(200)
        expect(response.body).to.have.property('url').that.is.a('string').and.is.not.empty
        expect(response.body.fileName).to.eq(RENAMED_DOC_NAME)
      })
    })
  })

  describe('Delete', () => {
    it('deletes both documents', () => {
      cy.intercept('DELETE', '**/document/delete-document*').as('deleteDocument')

      docCard(RENAMED_DOC_NAME).find('button[aria-label="Delete"]').click()
      cy.contains('Confirm Deletion', { timeout: 5000 }).should('be.visible')
      cy.contains(RENAMED_DOC_NAME).should('be.visible')
      cy.get('button').contains('Delete').click()
      cy.wait('@deleteDocument').its('response.statusCode').should('be.oneOf', [200, 204])
      cy.contains(RENAMED_DOC_NAME).should('not.exist')

      docCard(DOC_NAME_2).find('button[aria-label="Delete"]').click()
      cy.contains('Confirm Deletion', { timeout: 5000 }).should('be.visible')
      cy.get('button').contains('Delete').click()
      cy.wait('@deleteDocument').its('response.statusCode').should('be.oneOf', [200, 204])
      cy.contains(DOC_NAME_2).should('not.exist')
    })
  })
})
