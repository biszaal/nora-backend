/**
 * Local Development Server
 * Runs the Express app locally for development purposes
 */

import app from './index';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;

// Start server - bind to 0.0.0.0 to accept connections from network
const port = typeof PORT === 'string' ? parseInt(PORT) : PORT;
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 NoraAI API Server running on http://0.0.0.0:${port}`);
  console.log(`   Accessible at http://192.168.0.93:${port} from your network`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});
