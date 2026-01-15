const express = require('express');
const axios = require('axios');
require('dotenv').config();
const { syncEnrollmentStatusToHubSpot } = require('./enrollmentStatusUpdate');
const app = express();
app.use(express.json());
const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
app.post('/api/webhook/enrollment-status-update', async (req, res) => {
  try {
    const { enrollmentId, newStatus, studentName, courseId } = req.body;
    if (!enrollmentId || !newStatus) {
      return res.status(400).json({ success: false, error: 'Missing required fields: enrollmentId, newStatus' });
    }
    console.log(`📝 Received status update: Enrollment ${enrollmentId} → ${newStatus}`);
    const enrollment = { id: enrollmentId, status: newStatus, studentName, courseId };
    const result = await syncEnrollmentStatusToHubSpot(enrollment, HUBSPOT_ACCESS_TOKEN);
    console.log(`✅ Status update completed for enrollment: ${enrollmentId}`);
    res.json({ success: true, message: 'Enrollment status updated successfully in HubSpot', enrollmentId, newStatus, hubspotUpdate: result });
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    res.status(500).json({ success: false, error: error.message, enrollmentId: req.body.enrollmentId });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
