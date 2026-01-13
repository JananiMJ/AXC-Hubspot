const express = require('express');
const router = express.Router();

// Import controller functions
const hubspotController = require('../controllers/hubspotController');

// Test the import
console.log('Controller loaded:', Object.keys(hubspotController));

// ===== OAuth Routes =====
// Step 1: User clicks "Connect with HubSpot" button
router.get('/oauth/authorize', hubspotController.authorizeOAuth);

// Step 2: HubSpot redirects back here with authorization code
router.get('/oauth/callback', hubspotController.oauthCallback);

// Step 3: Refresh access token (when it expires)
router.post('/oauth/refresh', hubspotController.refreshToken);

// ===== Connection Test Route =====
// Verify that HubSpot connection is working
router.get('/test-connection', hubspotController.testConnection);

// ===== Webhook Routes =====
// Receive enrollment data from Axcelerate and create HubSpot deal
router.post('/webhook', hubspotController.createDealFromWebhook);

module.exports = router;
