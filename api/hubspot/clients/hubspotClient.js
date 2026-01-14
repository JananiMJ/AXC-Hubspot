const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const HubSpotClient = require('./hubspotClient');
const enrollmentSchema = require('./models/Enrollment');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Health check
app.get('/health', async (req, res) => {
  try {
    const hubspotTest = await HubSpotClient.testConnection();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      hubspot: hubspotTest.success ? '✅ Connected' : '❌ Failed',
      mongodb: mongoose.connection.readyState === 1 ? '✅ Connected' : '❌ Failed'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// OAuth endpoints
app.get('/api/hubspot/oauth/authorize', (req, res) => {
  const authUrl = `https://app.hubspot.com/oauth/authorize?client_id=${process.env.HUBSPOT_CLIENT_ID}&scope=crm.objects.contacts.read crm.objects.deals.write crm.objects.contacts.write&redirect_uri=${encodeURIComponent(process.env.HUBSPOT_REDIRECT_URI)}`;
  res.redirect(authUrl);
});

app.get('/api/hubspot/oauth/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const tokenResponse = await axios.post('https://api.hubapi.com/oauth/v1/token', {
      grant_type: 'authorization_code',
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
      code
    });
    
    await HubSpotClient.setAccessToken(tokenResponse.data.access_token);
    res.json({ success: true, message: '✅ OAuth completed! Token saved to MongoDB.' });
  } catch (error) {
    res.status(400).json({ error: 'OAuth failed', details: error.response?.data });
  }
});

// Test connection
app.get('/api/hubspot/test-connection', async (req, res) => {
  const result = await HubSpotClient.testConnection();
  res.json(result);
});

// 🔥 MAIN WEBHOOK - Axcelerate Enrollment → HubSpot Deal
app.post('/api/hubspot/webhook', async (req, res) => {
  try {
    console.log('🎯 [WEBHOOK RECEIVED] Raw payload:', JSON.stringify(req.body, null, 2));
    
    // Flexible field mapping for Axcelerate webhook
    const enrollmentData = extractEnrollmentData(req.body);
    
    if (!enrollmentData.isValid) {
      console.error('❌ [VALIDATION FAILED]', enrollmentData.errors);
      return res.status(400).json({
        success: false,
        error: 'Missing required enrollment data',
        received: req.body,
        errors: enrollmentData.errors
      });
    }

    console.log('✅ [VALIDATED DATA]', enrollmentData);

    // Check for duplicate (idempotency)
    const existing = await enrollmentSchema.findOne({ 
      enrollmentId: enrollmentData.enrollmentId 
    });
    
    if (existing) {
      console.log('⏭️ [DUPLICATE SKIPPED]', enrollmentData.enrollmentId);
      return res.json({ 
        success: true, 
        message: 'Already processed',
        enrollmentId: enrollmentData.enrollmentId 
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

    // Save to MongoDB
    const enrollment = new enrollmentSchema({
      enrollmentId: enrollmentData.enrollmentId,
      studentEmail: enrollmentData.studentEmail,
      studentName: enrollmentData.studentName,
      courseName: enrollmentData.courseName,
      courseAmount: enrollmentData.courseAmount,
      hubspotDealId: dealId,
      processedAt: new Date()
    });
    await enrollment.save();

    console.log('🎉 [SUCCESS] Deal created:', dealId);
    
    res.json({
      success: true,
      message: '✅ Enrollment synced to HubSpot Deal',
      enrollmentId: enrollmentData.enrollmentId,
      dealId: dealId
    });

  } catch (error) {
    console.error('💥 [WEBHOOK ERROR]', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Extract enrollment data from various Axcelerate payload formats
function extractEnrollmentData(payload) {
  return {
    enrollmentId: payload.id || 
                 payload.enrollmentId || 
                 payload.data?.id || 
                 payload.eventId,
    
    studentEmail: payload.email || 
                 payload.student?.email || 
                 payload.contact?.email || 
                 payload.data?.student?.email ||
                 payload.properties?.email,
    
    studentName: payload.student?.name || 
                payload.contact?.name || 
                payload.data?.student?.name ||
                payload.properties?.firstname + ' ' + payload.properties?.lastname ||
                'Unknown Student',
    
    courseName: payload.course?.name || 
               payload.product?.name || 
               payload.data?.course?.name ||
               payload.properties?.course_name ||
               'Unknown Course',
    
    courseAmount: parseFloat(payload.amount) || 
                 parseFloat(payload.course?.price) || 
                 parseFloat(payload.data?.course?.price) ||
                 parseFloat(payload.properties?.amount) || 
                 0,
    
    enrollmentDate: payload.date || 
                   payload.created_at || 
                   payload.timestamp || 
                   new Date().toISOString(),
    
    isValid: !!(payload.id || payload.enrollmentId) && 
             (payload.email || payload.student?.email) && 
             (payload.course?.name || payload.product?.name),
    
    errors: []
  };
}

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║     PMV HubSpot Integration API Server Started            ║
╠════════════════════════════════════════════════════════════╣
║ Port: ${PORT}                                              ║
║ Environment: ${process.env.NODE_ENV || 'development'}      ║
║ Domain: ${process.env.DOMAIN || 'localhost'}               ║
║ API Root: ${process.env.DOMAIN ? `https://${process.env.DOMAIN}` : 'http://localhost:3000'} ║
║ Health Check: ${process.env.DOMAIN ? `https://${process.env.DOMAIN}/health` : 'http://localhost:3000/health'} ║
╚════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
