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
    
    /* ✅ IMPROVED PARSING */
    const enrollmentData = {
      enrollmentId: req.body.id || 
                   req.body.enrollmentId || 
                   req.body.data?.id || 
                   req.body.properties?.enrollment_id ||
                   req.body.enrolment_id ||
                   `axc-enroll-${Date.now()}`,
      
      studentEmail: req.body.email || 
                   req.body.student?.email || 
                   req.body.contact?.email || 
                   req.body.properties?.email ||
                   req.body.properties?.student_email ||
                   req.body.data?.student?.email ||
                   'student@example.com',
      
      studentFirstName: req.body.student?.firstName ||
                       req.body.student?.first_name ||
                       req.body.contact?.firstName ||
                       req.body.firstName ||
                       req.body.properties?.firstname ||
                       req.body.data?.student?.firstName ||
                       'Student',
      
      studentLastName: req.body.student?.lastName ||
                      req.body.student?.last_name ||
                      req.body.contact?.lastName ||
                      req.body.lastName ||
                      req.body.properties?.lastname ||
                      req.body.data?.student?.lastName ||
                      'User',

      /* ✅ CRITICAL: Course Code */
      courseCode: req.body.course?.code ||
                 req.body.course?.id ||
                 req.body.product?.code ||
                 req.body.product?.id ||
                 req.body.courseCode ||
                 req.body.course_code ||
                 req.body.data?.course?.code ||
                 req.body.properties?.course_code ||
                 req.body.productId ||
                 'COURSE-001',

      /* ✅ Course Name (for reference) */
      courseName: req.body.course?.name || 
                 req.body.product?.name || 
                 req.body.data?.course?.name ||
                 req.body.properties?.course_name ||
                 req.body.properties?.course?.name ||
                 req.body.course?.title ||
                 'Course Enrollment',
      
      courseAmount: parseFloat(req.body.amount) || 
                   parseFloat(req.body.course?.price) || 
                   parseFloat(req.body.properties?.amount) || 
                   parseFloat(req.body.properties?.course_amount) ||
                   0
    };

    console.log('✅ [PARSED DATA]:', enrollmentData);

    // Check duplicate
    const existingSync = await HubSpotSync.findOne({ 
      enrollmentId: enrollmentData.enrollmentId 
    });
    
    if (existingSync && existingSync.status === 'success') {
      console.log('⏭️ [DUPLICATE SKIPPED]:', enrollmentData.enrollmentId);
      return res.json({ 
        success: true, 
        message: 'Already processed',
        enrollmentId: enrollmentData.enrollmentId,
        dealId: existingSync.dealId 
      });
    }

    // Create/find contact with FULL NAME
    const contactResult = await createOrGetContact({
      email: enrollmentData.studentEmail,
      firstName: enrollmentData.studentFirstName,
      lastName: enrollmentData.studentLastName,
      fullName: `${enrollmentData.studentFirstName} ${enrollmentData.studentLastName}`
    });

    if (!contactResult.success) {
      console.error('❌ Contact failed:', contactResult.error);
    }

    const contactId = contactResult.contactId || null;

    /* ✅ CRITICAL: Pass courseCode to createDeal */
    const dealId = await HubSpotClient.createDeal(contactId, {
      courseCode: enrollmentData.courseCode,  // ✅ MUST PASS THIS
      courseName: enrollmentData.courseName,
      courseAmount: enrollmentData.courseAmount
    });

    // Save to database
    await HubSpotSync.create({
      type: 'enrollment_to_deal',
      enrollmentId: enrollmentData.enrollmentId,
      dealId: dealId,
      contactId: contactId,
      studentEmail: enrollmentData.studentEmail,
      studentName: `${enrollmentData.studentFirstName} ${enrollmentData.studentLastName}`,
      courseName: enrollmentData.courseName,
      courseCode: enrollmentData.courseCode,  // ✅ STORE THIS TOO
      courseAmount: enrollmentData.courseAmount,
      status: 'success'
    });

    console.log('🎉 [SUCCESS] Enrollment → Deal:', {
      enrollmentId: enrollmentData.enrollmentId,
      dealId: dealId,
      dealName: `${enrollmentData.studentFirstName} ${enrollmentData.studentLastName} – ${enrollmentData.courseCode}`,
      studentEmail: enrollmentData.studentEmail
    });

    res.json({
      success: true,
      message: '✅ Enrollment synced to HubSpot Deal',
      enrollmentId: enrollmentData.enrollmentId,
      dealId: dealId,
      studentEmail: enrollmentData.studentEmail,
      dealName: `${enrollmentData.studentFirstName} ${enrollmentData.studentLastName} – ${enrollmentData.courseCode}`
    });

  } catch (error) {
    console.error('💥 [WEBHOOK ERROR]:', error.message);
    
    try {
      await HubSpotSync.create({
        type: 'enrollment_to_deal',
        enrollmentId: req.body.id || req.body.enrollmentId || 'unknown',
        studentEmail: req.body.email || 'unknown',
        status: 'error',
        error: error.message
      });
    } catch (dbError) {
      console.error('Database log failed:', dbError.message);
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      receivedPayload: req.body
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
