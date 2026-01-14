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

// ===== Webhook Routes =====
router.post('/webhook', hubspotController.createDealFromWebhook);


router.get('/pipelines', async (req, res) => {
  const HubSpotClient = require('../clients/hubspotClient');
  const pipelines = await HubSpotClient.getPipelines();
  res.json({ success: true, pipelines });
});

router.get('/pipelines/:pipelineId/stages', async (req, res) => {
  const HubSpotClient = require('../clients/hubspotClient');
  const stages = await HubSpotClient.getPipelineStages(req.params.pipelineId);
  res.json({ success: true, stages });
});


module.exports = router;
