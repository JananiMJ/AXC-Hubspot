const express = require('express');
const router = express.Router();
const hubspotController = require('../controllers/hubspotController');

console.log('✅ Controller loaded:', Object.keys(hubspotController));

router.get('/oauth/authorize', hubspotController.authorizeOAuth);
router.get('/oauth/callback', hubspotController.oauthCallback);
router.post('/oauth/refresh', hubspotController.refreshToken);
router.get('/test-connection', hubspotController.testConnection);
router.post('/webhook', hubspotController.createDealFromWebhook);

// NEW: Pipelines Discovery
router.get('/pipelines', async (req, res) => {
  try {
    const HubSpotClient = require('../clients/hubspotClient');
    console.log('[Pipelines] Fetching...');
    const pipelines = await HubSpotClient.getPipelines();
    res.json({ success: true, pipelines });
  } catch (error) {
    console.error('[Pipelines Error]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// NEW: Pipeline Stages
router.get('/pipelines/:pipelineId/stages', async (req, res) => {
  try {
    const HubSpotClient = require('../clients/hubspotClient');
    const stages = await HubSpotClient.getPipelineStages(req.params.pipelineId);
    res.json({ success: true, stages });
  } catch (error) {
    console.error('[Stages Error]', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
