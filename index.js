// In your main server file (index.js or server.js)
const express = require('express');
const { updateHubSpotEnrollmentStatus } = require('./enrollmentStatusUpdate');

const app = express();
app.use(express.json());

// HubSpot access token (store in environment variables)
const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

/**
 * Webhook endpoint to receive enrollment status updates from Axcelerate
 * POST /api/webhook/enrollment-status-update
 */
app.post('/api/webhook/enrollment-status-update', async (req, res) => {
  try {
    const { enrollmentId, newStatus, studentName, courseId } = req.body;

    // Validate required fields
    if (!enrollmentId || !newStatus) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: enrollmentId, newStatus',
      });
    }

    console.log(`📝 Received status update: Enrollment ${enrollmentId} → ${newStatus}`);

    // Call the HubSpot update function
    const result = await updateHubSpotEnrollmentStatus(
      enrollmentId,
      newStatus,
      HUBSPOT_ACCESS_TOKEN
    );

    // Log the successful update
    console.log(`✅ Status update completed for enrollment: ${enrollmentId}`);

    res.json({
      success: true,
      message: 'Enrollment status updated successfully in HubSpot',
      enrollmentId,
      newStatus,
      hubspotUpdate: result,
    });

  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      enrollmentId: req.body.enrollmentId,
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
