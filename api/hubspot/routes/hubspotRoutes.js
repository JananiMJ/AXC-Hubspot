const express = require('express');
const router = express.Router();
const axios = require('axios');

const hubspotController = require('../controllers/hubspotController');
const HubSpotSync = require('../models/hubspotSync');

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

// ===== DEAL STATUS UPDATE - SYNC TO AXCELERATE =====

router.post('/deal-status-update', async (req, res) => {
  try {
    console.log('🔄 [Deal Status Update Received]:', JSON.stringify(req.body, null, 2));

    const { dealId, dealstage, dealname } = req.body;

    // Validate input
    if (!dealId || !dealstage) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['dealId', 'dealstage'],
        received: req.body
      });
    }

    console.log('🔍 [Searching for sync record]:', dealId);

    // Find the sync record to get enrollment ID
    const syncRecord = await HubSpotSync.findOne({ dealId: String(dealId) });

    if (!syncRecord) {
      console.error('❌ No sync record found for dealId:', dealId);
      
      // Show all sync records for debugging
      const allRecords = await HubSpotSync.find({ type: 'enrollment_to_deal' });
      console.log('📋 [All sync records]:', allRecords.map(r => ({ dealId: r.dealId, enrollmentId: r.enrollmentId })));

      return res.status(404).json({
        error: `No sync record found for dealId: ${dealId}`,
        dealId: dealId,
        allDealIds: allRecords.map(r => r.dealId)
      });
    }

    console.log('✅ [Sync Record Found]:', {
      dealId: syncRecord.dealId,
      enrollmentId: syncRecord.enrollmentId,
      studentName: syncRecord.studentName
    });

    // Map HubSpot stage to Axcelerate status
    const axcStatus = mapHubSpotStageToAxcStatus(dealstage);

    console.log('📊 [Status Mapped]:', {
      hubspotStage: dealstage,
      axcelerateStatus: axcStatus
    });

    // Update Axcelerate enrollment status
    const axcUpdateResult = await updateAxcelerateEnrollmentStatus(
      syncRecord.enrollmentId,
      axcStatus
    );

    if (!axcUpdateResult.success) {
      console.warn('⚠️ [Axcelerate Update Warning]:', axcUpdateResult.error);
      return res.status(400).json({
        error: 'Failed to update Axcelerate',
        details: axcUpdateResult.error,
        hint: 'Check if AXCELERATE_API_KEY is set in environment variables'
      });
    }

    console.log('✅ [Axcelerate Updated]:', axcUpdateResult);

    res.json({
      success: true,
      message: 'Deal status synced to Axcelerate',
      dealId,
      dealstage,
      axcStatus,
      enrollmentId: syncRecord.enrollmentId,
      studentName: syncRecord.studentName,
      axcUpdateResult
    });

  } catch (err) {
    console.error('[Deal Status Update Error]', err.message);
    res.status(500).json({
      error: 'Failed to update enrollment status',
      details: err.message
    });
  }
});
