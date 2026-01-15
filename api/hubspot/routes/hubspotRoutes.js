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
function mapHubSpotStageToAxcStatus(hubspotStage) {
  const stageMap = {
    // HubSpot → Axcelerate status mapping
    'send_enrollment_details': 'Tentative',
    '1032873244': 'Tentative',                   // Send Enrollment Details (by ID)
    '1032873243': 'In Progress',                 // Next stage
    '1032873248': 'In Progress',
    '1032873249': 'In Progress',
    'appointmentscheduled': 'In Progress',
    'presentationscheduled': 'In Progress',
    'qualifiedtobuy': 'In Progress',
    'decisionmakerboughtin': 'Confirmed',
    'closedwon': 'Confirmed',                    // Deal won
    'closedlost': 'Cancelled',                   // Deal lost
  };

  const mappedStatus = stageMap[hubspotStage];
  
  if (!mappedStatus) {
    console.warn('⚠️ [Unknown stage]:', hubspotStage, '- defaulting to Tentative');
  }

  return mappedStatus || 'Tentative';
}

/**
 * Update Axcelerate enrollment status via API
 */
async function updateAxcelerateEnrollmentStatus(enrollmentId, newStatus) {
  try {
    console.log('📤 [Calling Axcelerate API]:', { enrollmentId, newStatus });

    const axcApiUrl = process.env.AXCELERATE_API_URL || 'https://api.axcelerate.com.au';
    const axcApiKey = process.env.AXCELERATE_API_KEY;

    if (!axcApiKey) {
      console.warn('⚠️ AXCELERATE_API_KEY not set in environment');
      return { 
        success: false, 
        error: 'Axcelerate API key not configured - set AXCELERATE_API_KEY environment variable'
      };
    }

    console.log('🔐 [Auth Header]:', `Bearer ${axcApiKey.substring(0, 10)}...`);

    const response = await axios.patch(
      `${axcApiUrl}/v1/enrollments/${enrollmentId}`,
      {
        status: newStatus
      },
      {
        headers: {
          'Authorization': `Bearer ${axcApiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ [Axcelerate API Success]:', response.data);

    return {
      success: true,
      message: 'Enrollment status updated in Axcelerate',
      data: response.data
    };

  } catch (err) {
    console.error('❌ [Axcelerate API Error]:', {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message
    });

    return {
      success: false,
      error: err.response?.data?.message || err.message,
      hint: 'Check Axcelerate API key and enrollment ID'
    };
  }
}

module.exports = router;
