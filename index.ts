/**
 * Firebase Functions Entry Point
 * Wraps the Express app for deployment on Firebase Cloud Functions
 */

import { onRequest } from 'firebase-functions/v2/https';
import app from './src/index';

// Export the Express app as a Firebase Cloud Function
// This makes the entire Express API available at the /api endpoint
export const api = onRequest(
  {
    timeoutSeconds: 540, // 9 minutes (max for v2)
    memory: '1GiB',
    minInstances: 0,  // Scale to zero when not in use
    maxInstances: 10,
  },
  app
);
