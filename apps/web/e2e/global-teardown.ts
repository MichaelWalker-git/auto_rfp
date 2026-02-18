import { test as teardown } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const authFile = path.join(__dirname, '.auth/user.json');

teardown('cleanup auth state', async () => {
  // Optionally clean up auth file after tests
  // Uncomment if you want to force re-authentication each run
  // if (fs.existsSync(authFile)) {
  //   fs.unlinkSync(authFile);
  // }
  console.log('🧹 Test cleanup complete');
});
