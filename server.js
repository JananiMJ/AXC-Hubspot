const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const HubSpotClient = require('./hubspotClient');
const HubSpotSync = require('./models/hubspotSync'); // YOUR EXISTING MODEL
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// Health Check
app.get('/health', async (req, res) => {
  try {
    const hubspotTest = await HubSpotClient.testConnection();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      mongodb: mongoose.connection.readyState === 1 ? '✅ Connected' : '❌ Failed',
      hubspot: hubspotTest.success ? '✅ Connected' : '❌ Auth Required'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// OAuth Flow
app.get('/api/hubspot/oauth/authorize', (req, res) => {
  const authUrl = `https://app.hubspot.com/oauth/authorize?` +
    `client_id=${process.env.HUBSPOT_CLIENT_ID}&` +
    `scope=crm.objects.contacts.read%20crm.objects.contacts.write%20crm.objects.deals.read%20crm.objects.deals.write&` +
    `redirect_uri=${encodeURIComponent(process.env.HUBSPOT_REDIRECT_URI)}`;
  res.redirect(authUrl);
});

app.get('/api/hubspot/oauth/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const axios = require('axios');
    const tokenResponse = await axios.post('https://api.hubapi.com/oauth/v1/token', {
      grant_type: 'authorization_code',
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
      code
    });

    // SAVE TOKEN TO YOUR EXISTING MODEL
    await HubSpotSync.create({
      type: 'oauth_token',
      accessToken: tokenResponse.data.access_token,
      refreshToken: tokenResponse.data.refresh_token,
      expiresAt: new Date(Date.now() + (tokenResponse.data.expires_in * 1000))
    });

    HubSpotClient.setAccessToken(tokenResponse.data.access_token);
    
    res.json({ 
      success: true, 
      message: '✅ OAuth completed! Token saved to MongoDB.',
      next: 'Test: /api/hubspot/test-connection'
    });
  } catch (error) {
    res.status(400).json({ error: 'OAuth failed', details: error.response?.data });
  }
});

// Test Connection
app.get('/api/hubspot/test-connection', async (req, res) => {
  const result = await HubSpotClient.testConnection();
  res.json(result);
});

// 🔥 MAIN WEBHOOK - Axcelerate → HubSpot Deals (COMPLETE)
app.post('/api/hubspot/webhook', async (req, res) => {
  try {
    console.log('🎯 [WEBHOOK RECEIVED] Payload:', JSON.stringify(req.body, null, 2));
    
    // Extract enrollment data (flexible for Axcelerate formats)
    const enrollmentData = extractEnrollmentData(req.body);
    
    if (!enrollmentData.isValid) {
      console.error('❌ [VALIDATION FAILED]', enrollmentData.errors);
      return res.status(400).json({
        success: false,
        error: 'Missing required enrollment fields',
        fields: enrollmentData.errors,
        received: req.body
      });
    }

    console.log('✅ [PARSED DATA]', enrollmentData);

    // Check duplicate (using YOUR model)
    const existing = await HubSpotSync.findOne({ 
      enrollmentId: enrollmentData.enrollmentId,
      type: 'enrollment_to_deal'
    });
    
    if (existing?.status === 'success') {
      console.log('⏭️ [DUPLICATE SKIPPED]', enrollmentData.enrollmentId);
      return res.json({ 
        success: true, 
        message: 'Already processed',
        enrollmentId: enrollmentData.enrollmentId,
        dealId: existing.dealId
      });
    }

    // Create HubSpot Deal
    const dealId = await HubSpotClient.createDeal(
      enrollmentData.studentEmail,
      {
        courseName: enrollmentData.courseName,
        courseAmount: enrollmentData.courseAmount
      }
    );

    // SAVE TO YOUR EXISTING MODEL (hubspotSync)
    const syncRecord = await HubSpotSync.findOneAndUpdate(
      { enrollmentId: enrollmentData.enrollmentId, type: 'enrollment_to_deal' },
      {
        type: 'enrollment_to_deal',
        enrollmentId: enrollmentData.enrollmentId,
        dealId: dealId,
        contactId: enrollmentData.contactId || null,
        studentEmail: enrollmentData.studentEmail,
        studentName: enrollmentData.studentName,
        courseName: enrollmentData.courseName,
        courseAmount: enrollmentData.courseAmount,
        utmSource: enrollmentData.utmSource,
        status: 'success'
      },
      { upsert: true, new: true }
    );

    console.log('🎉 [SUCCESS] Deal created:', dealId, 'Enrollment:', enrollmentData.enrollmentId);
    
    res.json({
      success: true,
      message: '✅ Enrollment synced to HubSpot Deal',
      enrollmentId: enrollmentData.enrollmentId,
      dealId: dealId,
      syncId: syncRecord._id
    });

  } catch (error) {
    console.error('💥 [WEBHOOK ERROR]', error.message);
    
    // Log error to YOUR model
    if (enrollmentData?.enrollmentId) {
      await HubSpotSync.findOneAndUpdate(
        { enrollmentId: enrollmentData.enrollmentId, type: 'enrollment_to_deal' },
        {
          status: 'error',
          error: error.message,
          retryCount: { $inc: 1 }
        },
        { upsert: true }
      );
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 🔥 FLEXIBLE DATA EXTRACTION for Axcelerate payloads
function extractEnrollmentData(payload) {
  return {
    enrollmentId: payload.id || 
                 payload.enrollmentId || 
                 payload.data?.id || 
                 payload.eventId ||
                 payload.enrolment_id ||
                 payload.properties?.enrolment_id,
    
    studentEmail: payload.email || 
                 payload.student?.email || 
                 payload.contact?.email || 
                 payload.data?.student?.email ||
                 payload.properties?.email ||
                 payload.properties?.student_email,
    
    studentName: payload.student?.name || 
                payload.contact?.name || 
                payload.data?.student?.name ||
                `${payload.properties?.firstname || ''} ${payload.properties?.lastname || ''}`.trim() ||
                'Unknown Student',
    
    courseName: payload.course?.name || 
               payload.product?.name || 
               payload.data?.course?.name ||
               payload.properties?.course_name ||
               payload.properties?.course_name ||
               'Unknown Course',
    
    courseAmount: parseFloat(payload.amount) || 
                 parseFloat(payload.course?.price) || 
                 parseFloat(payload.data?.course?.price) ||
                 parseFloat(payload.properties?.amount) ||
                 parseFloat(payload.properties?.course_amount) || 
                 0,
    
    contactId: payload.contactId || payload.data?.contact?.id,
    
    utmSource: payload.utm_source || payload.properties?.utm_source,
    utmMedium: payload.utm_medium || payload.properties?.utm_medium,
    utmCampaign: payload.utm_campaign || payload.properties?.utm_campaign,
    
    enrollmentDate: payload.created_at || payload.date || payload.timestamp || new Date().toISOString(),
    
    isValid: !!(payload.id || payload.enrollmentId || payload.enrolment_id) && 
             (payload.email || payload.student?.email || payload.properties?.email) &&
             (payload.course?.name || payload.properties?.course_name),
    
    errors: []
  };
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server');
  mongoose.connection.close(() => {
    process.exit(0);
  });
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║     PMV HubSpot Integration API Server Started            ║
╠════════════════════════════════════════════════════════════╣
║ Port: ${PORT}                                              ║
║ Environment: ${process.env.NODE_ENV || 'development'}      ║
║ Domain: ${process.env.DOMAIN || 'localhost:3000'}          ║
║ Webhook: ${process.env.DOMAIN ? `https://${process.env.DOMAIN}/api/hubspot/webhook` : 'http://localhost:3000/api/hubspot/webhook'} ║
╚════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
