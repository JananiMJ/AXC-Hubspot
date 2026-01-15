const axios = require('axios');
const qs = require('qs');
const HubSpotClient = require('../clients/hubspotClient');
const HubSpotSync = require('../models/hubspotSync');
const ContactMapping = require('../models/contactMapping');
const mongoose = require('mongoose');
// ============================================
// OAUTH ROUTES
// ============================================

exports.authorizeOAuth = (req, res) => {
  try {
    const scopes = 'crm.objects.contacts.read crm.objects.contacts.write crm.objects.deals.read crm.objects.deals.write';
    const redirectUri = process.env.HUBSPOT_REDIRECT_URI;
    const clientId = process.env.HUBSPOT_CLIENT_ID;
    const state = Math.random().toString(36).substring(7);

    const authUrl = `https://app.hubspot.com/oauth/authorize?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`;

    console.log('[OAuth Flow] Redirecting to HubSpot:', state);
    res.redirect(authUrl);

  } catch (err) {
    console.error('[OAuth Error]', err.message);
    res.status(500).json({
      error: 'Failed to initiate OAuth',
      details: err.message,
    });
  }
};

exports.oauthCallback = async (req, res) => {
  try {
    const { code, error, state } = req.query;

    if (error) {
      return res.status(400).json({
        error: 'OAuth authorization denied',
        details: error
      });
    }

    if (!code) {
      return res.status(400).json({
        error: 'No authorization code received'
      });
    }

    const data = qs.stringify({
      grant_type: 'authorization_code',
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
      code: code,
    });

    const tokenResponse = await axios.post(
      'https://api.hubapi.com/oauth/v1/token',
      data,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    HubSpotClient.setAccessToken(access_token);

    await HubSpotSync.findOneAndUpdate(
      { type: 'oauth_token' },
      {
        type: 'oauth_token',
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: new Date(Date.now() + expires_in * 1000),
        status: 'success',
      },
      { upsert: true, new: true }
    );

    console.log('[OAuth Success] Token obtained and saved');

    res.json({
      success: true,
      message: 'OAuth connection successful!',
      accessToken: access_token.substring(0, 10) + '...',
      expiresIn: expires_in,
    });

  } catch (err) {
    console.error('[OAuth Error]', err.response?.data || err.message);
    res.status(500).json({
      error: 'OAuth token exchange failed',
      details: err.response?.data || err.message,
    });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const syncRecord = await HubSpotSync.findOne({ type: 'oauth_token' });

    if (!syncRecord || !syncRecord.refreshToken) {
      return res.status(401).json({
        error: 'No refresh token found. Please re-authorize.',
      });
    }

    const data = qs.stringify({
      grant_type: 'refresh_token',
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      refresh_token: syncRecord.refreshToken,
    });

    const tokenResponse = await axios.post(
      'https://api.hubapi.com/oauth/v1/token',
      data,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    HubSpotClient.setAccessToken(access_token);

    await HubSpotSync.findByIdAndUpdate(syncRecord._id, {
      accessToken: access_token,
      refreshToken: refresh_token || syncRecord.refreshToken,
      expiresAt: new Date(Date.now() + expires_in * 1000),
    });

    console.log('[Token Refresh Success]');

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      expiresIn: expires_in,
    });

  } catch (err) {
    console.error('[Token Refresh Error]', err.response?.data || err.message);
    res.status(500).json({
      error: 'Token refresh failed',
      details: err.response?.data || err.message,
    });
  }
};

// ============================================
// CONNECTION TEST
// ============================================

exports.testConnection = async (req, res) => {
  try {
    const result = await HubSpotClient.testConnection();

    if (result.success) {
      return res.json({
        success: true,
        message: 'HubSpot connection verified!',
        details: result,
      });
    } else {
      return res.status(401).json({
        success: false,
        error: 'Authentication failed - ensure OAuth is completed',
        details: result.error,
      });
    }

  } catch (err) {
    console.error('[Test Connection Error]', err.message);
    res.status(500).json({
      error: 'Connection test failed',
      details: err.message,
    });
  }
};

// ============================================
// CONTACT MAPPING - CREATE & GET
// ============================================

exports.createContactMapping = async (req, res) => {
  try {
    console.log('📝 [Mapping Request Received]:', JSON.stringify(req.body, null, 2));

    const { axcContactId, hubspotContactId, email, firstName, lastName } = req.body;

    // Validate required fields
    if (!axcContactId || !hubspotContactId) {
      console.error('❌ [Validation Error] Missing required fields');
      return res.status(400).json({
        error: 'Required fields: axcContactId, hubspotContactId',
        received: req.body
      });
    }

    // Convert to string and trim
    const axcId = String(axcContactId).trim();
    const hubId = String(hubspotContactId).trim();

    console.log('🔍 [Normalized IDs]:', { axcId, hubId });

    // Check database connection
    console.log('📡 [Database Connection]:', mongoose.connection.readyState === 1 ? 'Connected' : 'Not connected');

    // Check if mapping already exists
    console.log('🔎 [Checking existing mapping]...');
    const existingMapping = await ContactMapping.findOne({ axcContactId: axcId });
    
    if (existingMapping) {
      console.log('🔄 [Existing mapping found]:', existingMapping);
    } else {
      console.log('✨ [No existing mapping - will create new]');
    }

    // Create or update mapping
    console.log('💾 [Saving to database]...');
    const mapping = await ContactMapping.findOneAndUpdate(
      { axcContactId: axcId },
      {
        axcContactId: axcId,
        hubspotContactId: hubId,
        email: email || null,
        firstName: firstName || null,
        lastName: lastName || null,
        updatedAt: new Date()
      },
      { 
        upsert: true, 
        new: true,
        runValidators: false
      }
    );

    console.log('✅ [Mapping Saved to Database]:', {
      _id: mapping._id,
      axcContactId: mapping.axcContactId,
      hubspotContactId: mapping.hubspotContactId,
      firstName: mapping.firstName,
      lastName: mapping.lastName,
      email: mapping.email
    });

    // Verify it was saved
    const verifyMapping = await ContactMapping.findOne({ axcContactId: axcId });
    console.log('🔐 [Verification - Read Back from DB]:', verifyMapping ? 'SUCCESS' : 'FAILED');

    res.json({
      success: true,
      message: 'Contact mapping created successfully',
      mapping: {
        _id: mapping._id,
        axcContactId: mapping.axcContactId,
        hubspotContactId: mapping.hubspotContactId,
        firstName: mapping.firstName,
        lastName: mapping.lastName,
        email: mapping.email
      }
    });

  } catch (err) {
    console.error('❌ [Mapping Error]', err.message);
    console.error('[Stack]', err.stack);
    res.status(500).json({
      error: 'Failed to create mapping',
      details: err.message,
      name: err.name
    });
  }
};

exports.getContactMapping = async (req, res) => {
  try {
    const { axcContactId } = req.params;
    const axcId = String(axcContactId).trim();

    console.log('🔍 [Looking up mapping]:', axcId);

    const mapping = await ContactMapping.findOne({ axcContactId: axcId });

    if (!mapping) {
      return res.status(404).json({
        error: `No mapping found for: ${axcId}`,
        axcContactId: axcId,
        allMappings: await ContactMapping.find({})
      });
    }

    res.json({
      success: true,
      mapping
    });

  } catch (err) {
    console.error('[Get Mapping Error]', err.message);
    res.status(500).json({
      error: 'Failed to get mapping',
      details: err.message
    });
  }
};

// ============================================
// WEBHOOK: CREATE DEAL FROM AXCELERATE
// ============================================

exports.createDealFromWebhook = async (req, res) => {
  try {
    console.log('🎯 [RAW AXCELERATE PAYLOAD]:', JSON.stringify(req.body, null, 2));

    const rawPayload = req.body;

    // Extract data from Axcelerate payload
    const enrollmentId = rawPayload.messageId || `axc-enroll-${Date.now()}`;
    const qualificationCode = rawPayload.message?.enrolment?.class?.qualification?.code || 'UNKNOWN-COURSE';
    const rawContactId = rawPayload.message?.enrolment?.student?.contactId;
    
    // Convert to string and trim
    const axcContactId = String(rawContactId || '').trim();

    console.log('✅ [EXTRACTED FROM AXCELERATE]:', {
      enrollmentId,
      qualificationCode,
      rawContactId,
      axcContactId
    });

    // Validate
    if (!axcContactId || axcContactId === 'undefined' || axcContactId === 'null' || axcContactId === '') {
      console.error('❌ Could not extract contactId from Axcelerate payload');
      
      return res.status(400).json({
        error: 'Missing student.contactId in Axcelerate webhook',
        hint: 'Axcelerate payload must have: message.enrolment.student.contactId',
        receivedPayload: rawPayload
      });
    }

    // Look up in mapping table
    console.log('🔍 [Searching mapping for]:', axcContactId);
    const mapping = await ContactMapping.findOne({ axcContactId: axcContactId });

    if (!mapping) {
      console.error('❌ No mapping found for:', axcContactId);
      
      // Show all mappings for debugging
      const allMappings = await ContactMapping.find({});
      console.log('📋 [All mappings in database]:', allMappings.map(m => ({ axcContactId: m.axcContactId, hubspotContactId: m.hubspotContactId })));

      return res.status(404).json({
        error: `No mapping found for Axcelerate contact: ${axcContactId}`,
        axcContactId: axcContactId,
        hint: `First, create mapping by sending POST to /api/hubspot/mapping with: {"axcContactId": "${axcContactId}", "hubspotContactId": "YOUR_HUBSPOT_ID", "email": "EMAIL", "firstName": "FIRST", "lastName": "LAST"}`,
        allMappings: allMappings.map(m => ({ axcContactId: m.axcContactId, hubspotContactId: m.hubspotContactId }))
      });
    }

    console.log('✅ [MAPPING FOUND]:', {
      axcContactId: mapping.axcContactId,
      hubspotContactId: mapping.hubspotContactId,
      firstName: mapping.firstName,
      lastName: mapping.lastName
    });

    // Get contact info from mapping
    const hubspotContactId = mapping.hubspotContactId;
    const contactName = `${mapping.firstName || ''} ${mapping.lastName || ''}`.trim() || 'Unknown';
    const studentEmail = mapping.email || 'unknown@example.com';

    console.log('✅ [CONTACT INFO]:', {
      hubspotContactId,
      contactName,
      studentEmail,
      axcContactId
    });

    // Create deal in HubSpot
    const dealData = {
      enrollmentId,
      contactId: hubspotContactId,
      contactName: contactName,
      courseCode: qualificationCode,
      courseName: qualificationCode,
      courseAmount: 0,
      studentEmail: studentEmail
    };

    console.log('✅ [DEAL DATA]:', dealData);

    const dealId = await HubSpotClient.createDeal(hubspotContactId, dealData);

    // Save sync record
    await HubSpotSync.create({
      type: 'enrollment_to_deal',
      enrollmentId: enrollmentId,
      dealId: dealId,
      contactId: hubspotContactId,
      studentEmail: studentEmail,
      studentName: contactName,
      courseName: qualificationCode,
      status: 'success',
    }).catch(dbErr => console.error('Failed to save sync:', dbErr));

    console.log('🎉 [SUCCESS]:', {
      enrollmentId,
      dealId,
      dealName: `${contactName} – ${qualificationCode}`,
      studentEmail,
      hubspotContactId,
      axcContactId
    });

    res.json({
      success: true,
      message: 'Deal created successfully',
      dealId,
      dealName: `${contactName} – ${qualificationCode}`,
      axcContactId
    });

  } catch (err) {
    console.error('[Webhook Error]', err.message);
    
    res.status(500).json({
      error: 'Failed to create deal',
      details: err.message
    });
  }
};
function mapHubSpotStageToAxcStatus(hubspotStage) {
  const stageMap = {
    // HubSpot → Axcelerate status mapping
    'send_enrollment_details': 'Tentative',      // Initial stage
    '1032873244': 'Tentative',                   // Send Enrollment Details (by ID)
    'appointmentscheduled': 'In Progress',       // If using default pipeline
    'presentationscheduled': 'In Progress',
    'qualifiedtobuy': 'In Progress',
    'decisionmakerboughtin': 'Confirmed',        // Deal moving forward
    'closedwon': 'Confirmed',                    // Deal won
    'closedlost': 'Cancelled',                   // Deal lost
  };

  return stageMap[hubspotStage] || 'Tentative';
}

/**
 * Update Axcelerate enrollment status via API
 */
async function updateAxcelerateEnrollmentStatus(enrollmentId, newStatus) {
  try {
    console.log('📤 [Updating Axcelerate]:', { enrollmentId, newStatus });

    // You'll need to implement this based on Axcelerate API
    // This is a placeholder that shows the structure
    
    const axcApiUrl = process.env.AXCELERATE_API_URL || 'https://api.axcelerate.com.au';
    const axcApiKey = process.env.AXCELERATE_API_KEY;

    if (!axcApiKey) {
      console.warn('⚠️ AXCELERATE_API_KEY not set - cannot update');
      return { 
        success: false, 
        message: 'Axcelerate API key not configured' 
      };
    }

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

    console.log('✅ [Axcelerate Update Success]:', response.data);

    return {
      success: true,
      message: 'Enrollment status updated in Axcelerate',
      data: response.data
    };

  } catch (err) {
    console.error('❌ [Axcelerate API Error]', err.response?.data || err.message);
    return {
      success: false,
      error: err.response?.data?.message || err.message
    };
  }
}
module.exports = exports;
