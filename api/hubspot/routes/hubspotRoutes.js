const express = require('express');
const router = express.Router();

// Import controller (your existing file)
const hubspotController = require('../controllers/hubspotController');

// Log controller load
console.log('Controller loaded:', Object.keys(hubspotController));

// ===== OAuth Routes =====
router.get('/oauth/authorize', hubspotController.authorizeOAuth);
router.get('/oauth/callback', hubspotController.oauthCallback);
router.post('/oauth/refresh', hubspotController.refreshToken);

// ===== Connection Test =====
router.get('/test-connection', hubspotController.testConnection);

// 🔥 FIXED WEBHOOK - Handles Axcelerate enrollment
router.post('/webhook', async (req, res) => {
  try {
    console.log('🎯 [WEBHOOK RECEIVED] Raw payload:', JSON.stringify(req.body, null, 2));
    
    // Flexible Axcelerate field mapping
    const enrollmentData = {
      enrollmentId: req.body.id || 
                   req.body.enrollmentId || 
                   req.body.data?.id || 
                   req.body.properties?.enrollment_id ||
                   req.body.enrolment_id,
      
      studentEmail: req.body.email || 
                   req.body.student?.email || 
                   req.body.contact?.email || 
                   req.body.properties?.email ||
                   req.body.properties?.student_email,
      
      studentName: req.body.student?.name || 
                  req.body.contact?.name || 
                  req.body.properties?.firstname + ' ' + (req.body.properties?.lastname || '') ||
                  'Test Student',
      
      courseName: req.body.course?.name || 
                 req.body.product?.name || 
                 req.body.data?.course?.name ||
                 req.body.properties?.course_name ||
                 'Test Course',
      
      courseAmount: parseFloat(req.body.amount) || 
                   parseFloat(req.body.course?.price) || 
                   parseFloat(req.body.properties?.amount) || 
                   199
    };

    console.log('✅ [PARSED DATA]:', enrollmentData);

    // Validate required fields
    const missingFields = [];
    if (!enrollmentData.enrollmentId) missingFields.push('enrollmentId');
    if (!enrollmentData.studentEmail) missingFields.push('studentEmail');
    if (!enrollmentData.courseName) missingFields.push('courseName');
    
    if (missingFields.length > 0) {
      console.error('❌ [MISSING FIELDS]:', missingFields);
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`,
        received: req.body
      });
    }

    // Check duplicate using YOUR hubspotSync model
    const HubSpotSync = require('../../../models/hubspotSync');
    const existing = await HubSpotSync.findOne({ 
      enrollmentId: enrollmentData.enrollmentId 
    });
    
    if (existing && existing.status === 'success') {
      console.log('⏭️ [DUPLICATE SKIPPED]:', enrollmentData.enrollmentId);
      return res.json({ 
        success: true, 
        message: 'Already processed',
        enrollmentId: enrollmentData.enrollmentId,
        dealId: existing.dealId 
      });
    }

    // Use YOUR existing controller (assumes it has createDealFromWebhook logic)
    const result = await hubspotController.createDealFromWebhook(enrollmentData);
    
    // Save success to YOUR model
    await HubSpotSync.create({
      type: 'enrollment_to_deal',
      enrollmentId: enrollmentData.enrollmentId,
      studentEmail: enrollmentData.studentEmail,
      studentName: enrollmentData.studentName,
      courseName: enrollmentData.courseName,
      courseAmount: enrollmentData.courseAmount,
      dealId: result.dealId,
      status: 'success'
    });

    console.log('🎉 [SUCCESS] Deal created:', result.dealId);
    res.json({ 
      success: true, 
      message: '✅ Enrollment synced to HubSpot Deal',
      enrollmentId: enrollmentData.enrollmentId,
      dealId: result.dealId 
    });

  } catch (error) {
    console.error('💥 [WEBHOOK ERROR]:', error.message);
    
    // Log error to YOUR model
    if (enrollmentData?.enrollmentId) {
      const HubSpotSync = require('../../../models/hubspotSync');
      await HubSpotSync.findOneAndUpdate(
        { enrollmentId: enrollmentData.enrollmentId },
        { status: 'error', error: error.message },
        { upsert: true }
      );
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router;
