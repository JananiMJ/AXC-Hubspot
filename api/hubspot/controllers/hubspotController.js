const axios = require('axios');
const qs = require('qs');
const HubSpotClient = require('../clients/hubspotClient');
const HubSpotSync = require('../models/hubspotSync');
const ContactMapping = require('../models/contactMapping');

// ============================================
// OAUTH ROUTES
// ============================================

// Step 1: Redirect user to HubSpot OAuth page
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

// Step 2: Handle OAuth callback and exchange code for token
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

    // Exchange authorization code for access token
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

    // Update HubSpotClient with new access token
    HubSpotClient.setAccessToken(access_token);

    // Save tokens to database for persistence
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
      redirectUrl: '/',
    });

  } catch (err) {
    console.error('[OAuth Error]', err.response?.data || err.message);
    res.status(500).json({
      error: 'OAuth token exchange failed',
      details: err.response?.data || err.message,
    });
  }
};

// Step 3: Refresh OAuth token when expired
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
// CONTACT MAPPING ENDPOINTS
// ============================================

// Create or update contact mapping
exports.createContactMapping = async (req, res) => {
  try {
    const { axcContactId, hubspotContactId, email, firstName, lastName } = req.body;

    console.log('[Mapping Request]:', { axcContactId, hubspotContactId });

    // Validate
    if (!axcContactId || !hubspotContactId) {
      return res.status(400).json({
        error: 'Required fields: axcContactId, hubspotContactId',
        received: req.body
      });
    }

    // Create or update mapping
    const mapping = await ContactMapping.findOneAndUpdate(
      { axcContactId },
      {
        axcContactId,
        hubspotContactId,
        email,
        firstName,
        lastName,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    console.log('✅ [Mapping Created/Updated]:', mapping);

    res.json({
      success: true,
      message: 'Contact mapping created successfully',
      mapping
    });

  } catch (err) {
    console.error('[Mapping Error]', err.message);
    res.status(500).json({
      error: 'Failed to create mapping',
      details: err.message
    });
  }
};

// Get contact mapping
exports.getContactMapping = async (req, res) => {
  try {
    const { axcContactId } = req.params;

    const mapping = await ContactMapping.findOne({ axcContactId });

    if (!mapping) {
      return res.status(404).json({
        error: `No mapping found for: ${axcContactId}`
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

    // ✅ EXTRACT DATA FROM AXCELERATE PAYLOAD
    const enrollmentId = rawPayload.messageId || `axc-enroll-${Date.now()}`;
    const qualificationCode = rawPayload.message?.enrolment?.class?.qualification?.code || 'UNKNOWN-COURSE';
    const axcContactId = String(rawPayload.message?.enrolment?.student?.contactId || '').trim();

    console.log('✅ [EXTRACTED FROM AXCELERATE]:', {
      enrollmentId,
      qualificationCode,
      axcContactId
    });

    // Validate
    if (!axcContactId || axcContactId === 'undefined' || axcContactId === 'null') {
      console.error('❌ Could not extract contactId from Axcelerate payload');
      
      return res.status(400).json({
        error: 'Missing student.contactId in Axcelerate webhook',
        hint: 'Axcelerate payload must have: message.enrolment.student.contactId',
        receivedPayload: rawPayload
      });
    }

    // ✅ LOOK UP IN MAPPING TABLE
    const mapping = await ContactMapping.findOne({ axcContactId });

    if (!mapping) {
      console.error('❌ No mapping found for:', axcContactId);
      
      return res.status(404).json({
        error: `No mapping found for Axcelerate contact: ${axcContactId}`,
        axcContactId: axcContactId,
        hint: `First, create mapping by sending POST to /api/hubspot/mapping with: {"axcContactId": "${axcContactId}", "hubspotContactId": "...", "email": "...", "firstName": "...", "lastName": "..."}`
      });
    }

    console.log('✅ [MAPPING FOUND]:', mapping);

    // ✅ GET HUBSPOT CONTACT INFO FROM MAPPING
    const hubspotContactId = mapping.hubspotContactId;
    const contactName = `${mapping.firstName || ''} ${mapping.lastName || ''}`.trim() || 'Unknown';
    const studentEmail = mapping.email || 'unknown@example.com';

    console.log('✅ [CONTACT INFO]:', {
      hubspotContactId,
      contactName,
      studentEmail,
      axcContactId
    });

    // ✅ CREATE DEAL IN HUBSPOT
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

    // ✅ SAVE SYNC RECORD
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

module.exports = exports;
