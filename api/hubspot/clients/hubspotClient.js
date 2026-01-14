const axios = require('axios');
require('dotenv').config();

class HubSpotClient {
  constructor() {
    this.baseURL = 'https://api.hubapi.com';
    this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  }

  getHeaders() {
    if (!this.accessToken) {
      throw new Error('No HubSpot access token. Complete OAuth first.');
    }
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  setAccessToken(token) {
    this.accessToken = token;
    process.env.HUBSPOT_ACCESS_TOKEN = token;
    console.log('✅ HubSpot token set');
  }

  async createDeal(contactId, dealData) {
    try {
      console.log('[Deal Creation] Started');

      /* ---------------- Close Date ---------------- */
      const closeDate = new Date();
      closeDate.setDate(closeDate.getDate() + 30);
      const closeDateStr = closeDate.toISOString().split('T')[0];

      /* ---------------- Get Contact Name ---------------- */
      let contactName = 'Student';

      if (contactId) {
        const contactResponse = await axios.get(
          `${this.baseURL}/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname`,
          { headers: this.getHeaders() }
        );

        const firstName =
          contactResponse.data.properties.firstname || '';
        const lastName =
          contactResponse.data.properties.lastname || '';

        contactName = `${firstName} ${lastName}`.trim();
      }

      /* ---------------- Course Details ---------------- */
      const courseCode =
        dealData.courseCode ||
        dealData.courseName ||
        'Course Enrollment';

      /* ---------------- Dynamic Deal Name ---------------- */
      const dealName = `${contactName} – ${courseCode}`;

      /* ---------------- Deal Properties ---------------- */
      const dealProperties = {
        dealname: dealName,
        amount: String(Math.round((dealData.courseAmount || 199) * 100)),
        dealstage: 'appointmentscheduled',
        closedate: closeDateStr,
      };

      /* ---------------- Create Deal ---------------- */
      const dealResponse = await axios.post(
        `${this.baseURL}/crm/v3/objects/deals`,
        { properties: dealProperties },
        { headers: this.getHeaders() }
      );

      const dealId = dealResponse.data.id;
      console.log('[✅ Deal Created] Deal ID:', dealId);

      /* ---------------- Associate Contact ---------------- */
      if (contactId) {
        await axios.put(
          `${this.baseURL}/crm/v4/objects/deals/${dealId}/associations/contacts`,
          [
            {
              id: contactId,
              type: 'deal_to_contact',
            },
          ],
          { headers: this.getHeaders() }
        );
        console.log('[🔗 Deal Associated with Contact]');
      }

      return dealId;
    } catch (error) {
      console.error(
        '[❌ Deal Creation Error]',
        error.response?.data || error.message
      );
      throw error;
    }
  }

  async testConnection() {
    try {
      const response = await axios.get(
        `${this.baseURL}/crm/v3/objects/contacts?limit=1`,
        { headers: this.getHeaders() }
      );

      return {
        success: true,
        message: '✅ HubSpot Connected',
        totalContacts: response.data.total || 0,
      };
    } catch (error) {
      return {
        success: false,
        error: '❌ HubSpot connection failed',
      };
    }
  }
}

module.exports = new HubSpotClient();
