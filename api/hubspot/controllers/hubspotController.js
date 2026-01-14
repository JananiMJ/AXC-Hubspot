const axios = require('axios');
const qs = require('qs');
const HubSpotClient = require('../clients/hubspotClient');
const HubSpotSync = require('../models/hubspotSync');

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

    // ✅ EXTRACT REAL DATA FROM AXCELERATE PAYLOAD
    const enrollmentId = rawPayload.messageId || `axc-enroll-${Date.now()}`;
    const qualificationCode = rawPayload.message?.enrolment?.class?.qualification?.code || 'UNKNOWN-COURSE';
    const studentContactId = rawPayload.message?.enrolment?.student?.contactId;

    // Validate required fields
    if (!studentContactId) {
      return res.status(400).json({
        error: 'Missing required field: student.contactId'
      });
    }

    console.log('✅ [EXTRACTED DATA]:', {
      enrollmentId,
      qualificationCode,
      studentContactId
    });

    // ✅ FETCH REAL CONTACT INFO FROM HUBSPOT
    let contactName = 'Unknown';
    let studentEmail = 'unknown@example.com';

    try {
      const contactResponse = await HubSpotClient.getClient().get(
        `/crm/v3/objects/contacts/${studentContactId}?properties=firstname,lastname,email`
      );

      const properties = contactResponse.data.properties;
      const firstName = properties.firstname || '';
      const lastName = properties.lastname || '';
      contactName = `${firstName} ${lastName}`.trim() || 'Unknown';
      studentEmail = properties.email || 'unknown@example.com';

      console.log('✅ [CONTACT INFO FROM HUBSPOT]:', {
        contactId: studentContactId,
        contactName,
        studentEmail
      });
    } catch (contactError) {
      console.warn('⚠️ [Warning] Could not fetch contact details:', contactError.message);
      // Continue with defaults - don't fail the whole request
    }

    // ✅ CREATE DEAL WITH REAL DATA
    const enrollmentData = {
      enrollmentId,
      contactId: studentContactId,
      contactName,
      courseCode: qualificationCode,
      courseName: qualificationCode,
      courseAmount: 0,
      studentEmail
    };

    console.log('✅ [FINAL ENROLLMENT DATA]:', enrollmentData);

    // Create the deal in HubSpot
    const dealId = await HubSpotClient.createDeal(studentContactId, enrollmentData);

    // Save sync record to database
    await HubSpotSync.create({
      type: 'enrollment_to_deal',
      enrollmentId: enrollmentData.enrollmentId,
      dealId: dealId,
      contactId: studentContactId,
      studentEmail: enrollmentData.studentEmail,
      studentName: enrollmentData.contactName,
      courseName: enrollmentData.courseCode,
      status: 'success',
    });

    console.log('🎉 [SUCCESS] Enrollment → Deal:', {
      enrollmentId: enrollmentData.enrollmentId,
      dealId,
      dealName: `${contactName} – ${qualificationCode}`,
      studentEmail: studentEmail,
      contactId: studentContactId
    });

    res.json({
      success: true,
      message: 'Deal created successfully',
      dealId: dealId,
      contactId: studentContactId,
      enrollmentId: enrollmentData.enrollmentId,
      dealName: `${contactName} – ${qualificationCode}`
    });

  } catch (err) {
    console.error('[Webhook Error]', err.message);

    // Log failed sync attempt
    await HubSpotSync.create({
      type: 'enrollment_to_deal',
      enrollmentId: req.body?.messageId,
      studentEmail: req.body?.message?.enrolment?.student?.email,
      status: 'error',
      error: err.message,
      retryCount: 0,
    }).catch(dbErr => console.error('Failed to log error:', dbErr));

    res.status(500).json({
      error: 'Failed to create deal',
      details: err.message,
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
