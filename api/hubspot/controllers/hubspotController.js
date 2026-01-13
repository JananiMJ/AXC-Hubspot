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
exports.createDealFromWebhook = async (req, res) => {
  try {
    const {
      enrollmentId,
      studentName,
      studentEmail,
      courseName,
      courseAmount,
      utmSource,
      utmMedium,
      utmCampaign,
    } = req.body;

    // Validate required fields
    if (!enrollmentId || !studentEmail || !courseName) {
      return res.status(400).json({
        error: 'Missing required fields: enrollmentId, studentEmail, courseName',
      });
    }

    // First, create or find the contact in HubSpot
    const contactResult = await createOrGetContact({
      email: studentEmail,
      name: studentName,
    });

    if (!contactResult.success) {
      throw new Error(`Failed to create/get contact: ${contactResult.error}`);
    }

    const contactId = contactResult.contactId;

    // Then create the deal in HubSpot
    const dealData = {
      dealname: `${courseName} - ${studentName}`,
      amount: courseAmount || 0,
      closedate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).getTime(), // 30 days from now
      dealstage: 'negotiation',
      pipeline: 'default',
      associated_contact: contactId,
      utm_source: utmSource || 'direct',
      utm_medium: utmMedium || 'organic',
      utm_campaign: utmCampaign || 'axcelerate',
    };

    const dealResult = await HubSpotClient.createDeal(dealData);

    if (!dealResult.success) {
      throw new Error(`Failed to create deal: ${dealResult.error}`);
    }

    // Save sync record to database
    await HubSpotSync.create({
      type: 'enrollment_to_deal',
      enrollmentId,
      dealId: dealResult.dealId,
      contactId,
      studentEmail,
      studentName,
      courseName,
      courseAmount,
      utmSource,
      utmMedium,
      utmCampaign,
      status: 'success',
    });

    console.log(`[Webhook Success] Deal created: ${dealResult.dealId} for ${studentEmail}`);

    res.json({
      success: true,
      message: 'Deal created successfully',
      dealId: dealResult.dealId,
      contactId,
      enrollmentId,
    });
  } catch (err) {
    console.error('[Webhook Error]', err.message);
    
    // Log failed sync attempt
    await HubSpotSync.create({
      type: 'enrollment_to_deal',
      enrollmentId: req.body.enrollmentId,
      studentEmail: req.body.studentEmail,
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
    const { email, name } = contactData;

    // First, try to find existing contact by email
    try {
      const searchResponse = await HubSpotClient.getClient().get(
        `/crm/v3/objects/contacts/search`,
        {
          params: {
            limit: 1,
            after: 0,
          },
        }
      );

      // Search through results for matching email
      if (searchResponse.data.results && searchResponse.data.results.length > 0) {
        const existingContact = searchResponse.data.results.find(
          c => c.properties.email === email
        );
        if (existingContact) {
          return {
            success: true,
            contactId: existingContact.id,
            created: false,
          };
        }
      }
    } catch (searchErr) {
      console.log('Search for existing contact failed, will create new:', searchErr.message);
    }

    // If contact doesn't exist, create a new one
    const createResponse = await HubSpotClient.getClient().post(
      '/crm/v3/objects/contacts',
      {
        properties: {
          firstname: name?.split(' ')[0] || 'Unknown',
          lastname: name?.split(' ').slice(1).join(' ') || '',
          email: email,
        },
      }
    );

    return {
      success: true,
      contactId: createResponse.data.id,
      created: true,
    };
  } catch (err) {
    console.error('Contact creation error:', err.response?.data || err.message);
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