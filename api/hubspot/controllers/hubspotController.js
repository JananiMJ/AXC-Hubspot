const axios = require('axios');
const qs = require('qs');
const HubSpotClient = require('../clients/hubspotClient');
const HubSpotSync = require('../models/hubspotSync');
const ContactMapping = require('../models/contactMapping');

// OAuth Authorization - Redirect user to HubSpot OAuth page
exports.authorizeOAuth = (req, res) => {
  try {
    const scopes = 'crm.objects.contacts.read crm.objects.contacts.write crm.objects.deals.read crm.objects.deals.write'; // Space-separated scopes
    const redirectUri = process.env.HUBSPOT_REDIRECT_URI;
    const clientId = process.env.HUBSPOT_CLIENT_ID;
    
    // Generate state for security
    const state = Math.random().toString(36).substring(7);
    
    // Build the authorization URL
    const authUrl = `https://app.hubspot.com/oauth/authorize?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`;
    
    // Store state in session/log for validation (in production, use session storage)
    console.log('[OAuth Flow] Redirecting to HubSpot:', state);
    
    // Redirect user to HubSpot OAuth server
    res.redirect(authUrl);
  } catch (err) {
    console.error('[OAuth Error]', err.message);
    res.status(500).json({
      error: 'Failed to initiate OAuth',
      details: err.message,
    });
  }
};

// OAuth Callback - Handle authorization code and exchange for access token
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
      redirectUrl: '/', // Redirect user to dashboard or home
    });
  } catch (err) {
    console.error('[OAuth Error]', err.response?.data || err.message);
    res.status(500).json({
      error: 'OAuth token exchange failed',
      details: err.response?.data || err.message,
    });
  }
};

// Test HubSpot Connection
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

// Create Deal from Webhook (Axcelerate enrollment webhook)
// 🔥 FIXED createDealFromWebhook - Handles ANY Axcelerate payload
exports.createDealFromWebhook = async (req, res) => {
  try {
    console.log('🎯 [RAW AXCELERATE PAYLOAD]:', JSON.stringify(req.body, null, 2));

    const rawPayload = req.body;

    // ✅ EXTRACT CONTACT ID - Try multiple paths
    let axcContactId = 
      rawPayload.message?.enrolment?.student?.contactId ||
      rawPayload.enrolment?.student?.contactId ||
      rawPayload.student?.contactId ||
      rawPayload.contactId;

    // Convert to string
    axcContactId = String(axcContactId).trim();

    console.log('✅ [EXTRACTED]:', {
      axcContactId,
      qualificationCode: rawPayload.message?.enrolment?.class?.qualification?.code,
      messageId: rawPayload.messageId
    });

    // Validate
    if (!axcContactId || axcContactId === 'undefined' || axcContactId === 'null') {
      console.error('❌ [ERROR] Could not extract contactId from payload');
      console.error('Payload structure:', JSON.stringify(rawPayload, null, 2));
      
      return res.status(400).json({
        error: 'Missing or invalid student.contactId in webhook',
        receivedPayload: rawPayload
      });
    }

    const enrollmentId = rawPayload.messageId || `axc-enroll-${Date.now()}`;
    const qualificationCode = rawPayload.message?.enrolment?.class?.qualification?.code || 'UNKNOWN-COURSE';

    console.log('✅ [VALIDATED DATA]:', {
      enrollmentId,
      qualificationCode,
      axcContactId
    });

    // ✅ LOOK UP IN MAPPING TABLE
    const mapping = await ContactMapping.findOne({ axcContactId });

    if (!mapping) {
      console.error('❌ [MAPPING ERROR] No mapping found for:', axcContactId);
      return res.status(404).json({
        error: `No mapping found for Axcelerate contact: ${axcContactId}. Please create mapping first.`,
        axcContactId: axcContactId,
        hint: `Create mapping with: curl -X POST https://axc-hubspot.onrender.com/api/hubspot/mapping -H "Content-Type: application/json" -d '{"axcContactId": "${axcContactId}", "hubspotContactId": "...", "firstName": "...", "lastName": "..."}'`
      });
    }

    console.log('✅ [MAPPING FOUND]:', mapping);

    const hubspotContactId = mapping.hubspotContactId;
    const contactName = `${mapping.firstName || ''} ${mapping.lastName || ''}`.trim() || 'Unknown';
    const studentEmail = mapping.email || 'unknown@example.com';

    // Create deal with real contact info
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
      dealId,
      dealName: `${contactName} – ${qualificationCode}`,
      axcContactId
    });

  } catch (err) {
    console.error('[Webhook Error]', err.message);
    
    res.status(500).json({
      error: 'Failed to create deal',
      details: err.message,
      payload: req.body
    });
  }
};

// Helper function: Create or get contact in HubSpot
async function createOrGetContact(contactData) {
  try {
    const { email, firstName, lastName, fullName } = contactData;

    // ✅ FIXED: Proper search query
    try {
      const searchResponse = await axios.post(
        `${HubSpotClient.baseURL}/crm/v3/objects/contacts/search`,
        {
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'email',
                  operator: 'EQ',
                  value: email
                }
              ]
            }
          ],
          limit: 1
        },
        { headers: HubSpotClient.getHeaders() }
      );

      if (searchResponse.data.results && searchResponse.data.results.length > 0) {
        console.log('[Found existing contact]:', searchResponse.data.results[0].id);
        return {
          success: true,
          contactId: searchResponse.data.results[0].id,
          created: false,
        };
      }
    } catch (searchErr) {
      console.log('[Search for existing contact failed, will create new]:', searchErr.message);
    }

    // ✅ FIXED: Create new contact with proper names
    const createResponse = await axios.post(
      `${HubSpotClient.baseURL}/crm/v3/objects/contacts`,
      {
        properties: {
          firstname: firstName || 'Unknown',
          lastname: lastName || 'User',
          email: email,
        },
      },
      { headers: HubSpotClient.getHeaders() }
    );

    console.log('[✅ Contact Created]:', createResponse.data.id);

    return {
      success: true,
      contactId: createResponse.data.id,
      created: true,
    };
  } catch (err) {
    console.error('❌ Contact creation error:', err.response?.data || err.message);
    return {
      success: false,
      error: err.response?.data || err.message,
    };
  }
}

// Refresh OAuth token (for token expiry)
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
}

exports.createContactMapping = async (req, res) => {
  try {
    const { axcContactId, hubspotContactId, email, firstName, lastName } = req.body;

    // Validate
    if (!axcContactId || !hubspotContactId) {
      return res.status(400).json({
        error: 'Required fields: axcContactId, hubspotContactId'
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
