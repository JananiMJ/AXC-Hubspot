const axios = require('axios');
require('dotenv').config();
const HubSpotSync = require('../models/hubspotSync');

class HubSpotClient {
  constructor() {
    this.baseURL = 'https://api.hubapi.com';
    this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN || null;

    console.log(
      '[HubSpotClient] Initialized with token:',
      this.accessToken ? 'Yes' : 'No'
    );
  }

  getHeaders() {
    const token = this.accessToken || process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) console.warn('[WARNING] No HubSpot access token found!');
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  setAccessToken(token) {
    this.accessToken = token;
    process.env.HUBSPOT_ACCESS_TOKEN = token;
  }

  /* =====================================================
     CREATE DEAL + SAVE ENROLMENT ↔ DEAL MAPPING
     ===================================================== */
  async createDeal(contactId, dealData) {
    try {
      console.log('[Deal Creation] Starting');

      // 🔐 REQUIRED
      if (!dealData.enrollmentId) {
        throw new Error('enrollmentId is REQUIRED to create mapping');
      }

      // Prevent duplicate deal creation
      const existing = await HubSpotSync.findOne({
        enrollmentId: String(dealData.enrollmentId),
      });

      if (existing) {
        console.log('ℹ️ Deal already exists for enrollment:', dealData.enrollmentId);
        return existing.dealId;
      }

      const closeDate = new Date();
      closeDate.setDate(closeDate.getDate() + 30);
      const closeDateStr = closeDate.toISOString().split('T')[0];

      const contactName = dealData.contactName || 'Student';
      const courseCode = dealData.courseCode || 'UNKNOWN';
      const enrollmentId = String(dealData.enrollmentId);

      const dealName = `${contactName} – ${courseCode}`;

      const dealProperties = {
        dealname: dealName,
        amount: String(Math.round((dealData.courseAmount || 0) * 100)),
        dealstage: '1032873244', // Send Enrolment Details
        pipeline: '705874836',
        closedate: closeDateStr,
      };

      const dealResponse = await axios.post(
        `${this.baseURL}/crm/v3/objects/deals`,
        { properties: dealProperties },
        { headers: this.getHeaders() }
      );

      const dealId = String(dealResponse.data.id);
      console.log('[✅ Deal Created]', dealId);

      // 🔗 Associate contact
      if (contactId) {
        await axios.put(
          `${this.baseURL}/crm/v4/objects/deals/${dealId}/associations/contacts`,
          [{ id: contactId, type: 'deal_to_contact' }],
          { headers: this.getHeaders() }
        );
      }

      // ✅ SAVE MAPPING (CRITICAL FIX)
      await HubSpotSync.create({
        type: 'enrollment_to_deal',
        dealId,
        enrollmentId,
        studentName: contactName,
        courseCode,
      });

      console.log('[✅ Mapping Saved]', { enrollmentId, dealId });

      return dealId;
    } catch (error) {
      console.error('[❌ Deal Creation Error]', error.message);
      throw error;
    }
  }

  /* =====================================================
     UPDATE DEAL STATUS ONLY (NO STAGE CHANGE)
     ===================================================== */
  async updateDealStatusOnly(dealId, statusValue) {
    try {
      await axios.patch(
        `${this.baseURL}/crm/v3/objects/deals/${dealId}`,
        {
          properties: {
            enrolment_status: statusValue,
          },
        },
        { headers: this.getHeaders() }
      );

      console.log('[✅ Deal Status Updated]', {
        dealId,
        enrolment_status: statusValue,
      });

      return true;
    } catch (error) {
      console.error(
        '[❌ HubSpot Status Update Error]',
        error.response?.data || error.message
      );
      throw error;
    }
  }

  /* =====================================================
     TEST CONNECTION
     ===================================================== */
  async testConnection() {
    try {
      const response = await axios.get(
        `${this.baseURL}/crm/v3/objects/contacts?limit=1`,
        { headers: this.getHeaders() }
      );
      return { success: true, count: response.data.total };
    } catch {
      return { success: false };
    }
  }

  async getPipelines() {
    const response = await axios.get(
      `${this.baseURL}/crm/v3/objects/deals/pipelines`,
      { headers: this.getHeaders() }
    );
    return response.data.results;
  }

  async getPipelineStages(pipelineId) {
    const response = await axios.get(
      `${this.baseURL}/crm/v3/objects/deals/pipelines/${pipelineId}/stages`,
      { headers: this.getHeaders() }
    );
    return response.data.results;
  }
}

module.exports = new HubSpotClient();
