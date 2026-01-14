const axios = require('axios');
require('dotenv').config();

class HubSpotClient {
  constructor() {
    this.baseURL = 'https://api.hubapi.com';
    this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  }

  getClient() {
    if (!this.accessToken) {
      throw new Error('No HubSpot access token. Complete OAuth first.');
    }
    return axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  setAccessToken(token) {
    this.accessToken = token;
    process.env.HUBSPOT_ACCESS_TOKEN = token;
    console.log('✅ Token set');
  }

  async createDeal(contactId, dealData) {
    try {
      console.log('[Deal Creation] Starting for:', dealData.courseName);
      
      const closeDate = new Date();
      closeDate.setDate(closeDate.getDate() + 30);
      const closeDateStr = closeDate.toISOString().split('T')[0];

      const dealProperties = {
        dealname: dealData.courseName || 'Course Enrollment',
        amount: String(Math.round((dealData.courseAmount || 199) * 100)),
        dealstage: 'appointmentscheduled',
        closedate: closeDateStr
      };

      const dealResponse = await axios.post(
        'https://api.hubapi.com/crm/v3/objects/deals',
        { properties: dealProperties },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const dealId = dealResponse.data.id;
      console.log('[✅ Deal Created] ID:', dealId);

      if (contactId) {
        try {
          await axios.put(
            `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/contacts`,
            [{ id: contactId, type: 'deal_to_contact' }],
            { headers: { 'Authorization': `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' } }
          );
        } catch (assocError) {
          console.log('[⚠️ Association skipped]');
        }
      }

      return dealId;
    } catch (error) {
      console.error('[Deal Error]:', error.response?.data?.message || error.message);
      throw error;
    }
  }

  async testConnection() {
    try {
      const response = await this.getClient().get('/crm/v3/objects/contacts?limit=1');
      return { success: true, message: '✅ Connected', contactsCount: response.data.total || 0 };
    } catch (error) {
      return { success: false, error: 'Connection failed' };
    }
  }
}

module.exports = new HubSpotClient();
