const mongoose = require('mongoose');

const hubSpotSyncSchema = new mongoose.Schema({
  type: { type: String, enum: ['oauth_token', 'enrollment_to_deal'], index: true },
  accessToken: String,
  refreshToken: String,
  expiresAt: Date,
  enrollmentId: { type: String, index: true },
  dealId: { type: String, index: true },
  contactId: String,
  studentEmail: { type: String, index: true },
  studentName: String,
  studentFirstName: String,  // ✅ NEW
  studentLastName: String,   // ✅ NEW
  courseName: String,
  courseCode: String,        // ✅ NEW - IMPORTANT
  courseAmount: Number,
  utmSource: String,
  utmMedium: String,
  utmCampaign: String,
  pipeline: String,          // ✅ NEW - store pipeline used
  dealStage: String,         // ✅ NEW - store stage used
  status: { type: String, enum: ['pending', 'success', 'error'], index: true },
  error: mongoose.Schema.Types.Mixed,
  retryCount: { type: Number, default: 0 },
}, { timestamps: true, collection: 'hubspot_sync' });

module.exports = mongoose.model('HubSpotSync', hubSpotSyncSchema);
