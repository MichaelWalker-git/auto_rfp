describe('Smoke test — CI trigger verification', () => {
  it('loads the login page', () => {
    cy.visit('/login');
    cy.url().should('include', '/login');
  });
});
