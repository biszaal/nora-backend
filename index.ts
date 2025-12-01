/**
 * Firebase Functions Entry Point
 * Wraps the Express app for deployment on Firebase Cloud Functions
 */

import { onRequest } from 'firebase-functions/v2/https';

// Load environment variables from .env.yaml for Firebase Functions
// This must be done before importing the app
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Try to load .env.yaml if it exists
const envPath = path.join(__dirname, '../.env.yaml');
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

// Export the Express app as a Firebase Cloud Function
// This makes the entire Express API available at the /api endpoint
export const api = onRequest(
  {
    timeoutSeconds: 540, // 9 minutes (max for v2)
    memory: '1GiB',
    minInstances: 0,  // Scale to zero when not in use
    maxInstances: 10,
    cors: true, // Enable CORS
  },
  app
);
