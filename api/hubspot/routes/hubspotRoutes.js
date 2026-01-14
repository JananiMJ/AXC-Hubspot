const express = require('express');
const router = express.Router();

const hubspotController = require('../controllers/hubspotController');

console.log('Controller loaded:', Object.keys(hubspotController));

// ===== OAuth Routes =====
router.get('/oauth/authorize', hubspotController.authorizeOAuth);
router.get('/oauth/callback', hubspotController.oauthCallback);
router.post('/oauth/refresh', hubspotController.refreshToken);

// ===== Connection Test Route =====
router.get('/test-connection', hubspotController.testConnection);

// ===== Contact Mapping Routes =====
router.post('/mapping', hubspotController.createContactMapping);
router.get('/mapping/:axcContactId', hubspotController.getContactMapping);

// ===== Webhook Routes =====
router.post('/webhook', hubspotController.createDealFromWebhook);

// ===== Pipelines Routes =====
router.get('/pipelines', async (req, res) => {
  try {
    const HubSpotClient = require('../clients/hubspotClient');
    console.log('[Pipelines] Fetching...');
    const pipelines = await HubSpotClient.getPipelines();
    console.log('[Pipelines] Found:', pipelines.length);
    res.json({ success: true, pipelines });
  } catch (error) {
    console.error('[Pipelines Error]', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get('/pipelines/:pipelineId/stages', async (req, res) => {
  try {
    const HubSpotClient = require('../clients/hubspotClient');
    const { pipelineId } = req.params;
    console.log('[Stages] Fetching for pipeline:', pipelineId);
    const stages = await HubSpotClient.getPipelineStages(pipelineId);
    console.log('[Stages] Found:', stages.length);
    res.json({ success: true, stages });
  } catch (error) {
    console.error('[Stages Error]', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
