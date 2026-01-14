const express = require('express');
const router = express.Router();
const hubspotController = require('../controllers/hubspotController');

console.log('Controller loaded:', Object.keys(hubspotController));

// OAuth Routes
router.get('/oauth/authorize', hubspotController.authorizeOAuth);
router.get('/oauth/callback', hubspotController.oauthCallback);
router.post('/oauth/refresh', hubspotController.refreshToken);

// Connection Test
router.get('/test-connection', hubspotController.testConnection);

// Webhook
router.post('/webhook', hubspotController.createDealFromWebhook);

// ✅ ADD THESE PIPELINES ROUTES:
router.get('/pipelines', async (req, res) => {
  try {
    const HubSpotClient = require('../clients/hubspotClient');
    const pipelines = await HubSpotClient.getPipelines();
    res.json({ success: true, pipelines });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/pipelines/:pipelineId/stages', async (req, res) => {
  try {
    const HubSpotClient = require('../clients/hubspotClient');
    const stages = await HubSpotClient.getPipelineStages(req.params.pipelineId);
    res.json({ success: true, stages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
router.post('/mapping', hubspotController.createContactMapping);
module.exports = router;
