/**
 * Firebase Functions Entry Point
 * Wraps the Express app for deployment on Firebase Cloud Functions
 */

import * as functions from 'firebase-functions/v1';

// Load environment variables from .env.yaml for Firebase Functions
// This must be done before importing the app
import * as path from 'path';
import * as fs from 'fs';

// Try to load .env.yaml if it exists
const envPath = path.join(__dirname, '.env.yaml');
if (fs.existsSync(envPath)) {
  const yaml = require('js-yaml');
  const envConfig = yaml.load(fs.readFileSync(envPath, 'utf8'));
  Object.keys(envConfig).forEach(key => {
    if (!process.env[key]) {
      process.env[key] = String(envConfig[key]);
    }
  });
}

// Now import the app after environment variables are loaded
import app from './src/index';

// Export the Express app as a Firebase Cloud Function (v1 - more stable)
// This makes the entire Express API available at the /api endpoint
export const api = functions
  .runWith({
    timeoutSeconds: 540,
    memory: '1GB',
  })
  .https.onRequest(app);
