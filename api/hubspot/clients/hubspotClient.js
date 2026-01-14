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
  }

  // ✅ PRODUCTION READY - Your WORKING config
  async createDeal(contactId, dealData) {
    try {
      console.log('[Deal Creation] Starting deal creation for:', dealData.courseName);
      
      const closeDate = new Date();
      closeDate.setDate(closeDate.getDate() + 30);
      const closeDateStr = closeDate.toISOString().split('T')[0];

      // ✅ PROVEN WORKING - No pipeline properties needed
      const dealProperties = {
        dealname: dealData.courseName || 'Course Enrollment',
        amount: String(Math.round((dealData.courseAmount || 199) * 100)),
        dealstage: 'appointmentscheduled',  // ✅ YOUR VALID STAGE
        closedate: closeDateStr
      };

      console.log('[Deal Creation] Properties:', dealProperties);

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
      console.log('[✅ Deal Created] Deal ID:', dealId);

      // Associate contact (non-critical)
      if (contactId) {
        try {
          await axios.put(
            `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/contacts`,
            [{ id: contactId, type: 'deal_to_contact' }],
            {
              headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
              }
            }
          );
          console.log('[✅ Deal Associated] to contact');
        } catch (assocError) {
          console.log('[⚠️ Association skipped]:', assocError.response?.data?.message);
        }
      }

      return dealId;
    } catch (error) {
      console.error('[Deal Creation Error] Status:', error.response?.status);
      console.error('[Deal Creation Error] Details:', error.response?.data);
      throw new Error(`Failed to create deal: ${error.response?.data?.message || error.message}`);
    }
  }

  async testConnection() {
    try {
      const response = await this.getClient().get('/crm/v3/objects/contacts?limit=1');
      return { 
        success: true, 
        message: '✅ Connected', 
        contactsCount: response.data.total || 0 
      };
    } catch (error) {
      return { 
        success: false, 
        error: 'Connection failed' 
      };
    }
  }
}

module.exports = new HubSpotClient();
