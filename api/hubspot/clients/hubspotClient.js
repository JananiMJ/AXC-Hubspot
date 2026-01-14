const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

class HubSpotClient {
  constructor() {
    this.baseURL = 'https://api.hubapi.com';
    this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
    
    // Initialize connection and load token
    this.init();
  }

  async init() {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      await this.loadTokenFromDB();
    } catch (error) {
      console.log('HubSpotClient init warning:', error.message);
    }
  }

  // 🔥 Load token from YOUR MongoDB hubspotSync model
  async loadTokenFromDB() {
    try {
      const HubSpotSync = require('./models/hubspotSync');
      
      const tokenRecord = await HubSpotSync.findOne({ 
        type: 'oauth_token',
        status: 'success'
      }).sort({ updatedAt: -1 });
      
      if (tokenRecord && tokenRecord.accessToken) {
        this.accessToken = tokenRecord.accessToken;
        console.log('✅ [HubSpotClient] Token loaded from MongoDB');
        return true;
      } else {
        console.log('⚠️ [HubSpotClient] No token in DB. Run OAuth first.');
      }
    } catch (error) {
      console.log('Token load failed:', error.message);
      return false;
    }
  }

  getClient() {
    if (!this.accessToken) {
      throw new Error('No HubSpot access token. Complete OAuth first: /api/hubspot/oauth/authorize');
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
    console.log('✅ Token updated');
  }

  // 🔥 FIXED: Correct dealstage for YOUR HubSpot account
  async createDeal(contactId, dealData) {
    try {
      console.log('[Deal Creation] Starting for:', dealData.courseName);
      
      const closeDate = new Date();
      closeDate.setDate(closeDate.getDate() + 30);
      const closeDateStr = closeDate.toISOString().split('T')[0];

    const dealProperties = {
  dealname: dealData.courseName || 'Course Enrollment',
  amount: String(Math.round((dealData.courseAmount || 199) * 100)),
  dealstage: 'appointmentscheduled',  // ✅ BACK TO WORKING DEFAULT STAGE
  closedate: closeDateStr
};


      console.log('[Deal Creation] Properties:', dealProperties);
      console.log('[Deal Creation] Contact ID:', contactId);

      // Create deal
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

      // Associate with contact (if exists)
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
          console.log('[✅ Deal Associated] to contact:', contactId);
        } catch (assocError) {
          console.log('[⚠️ Association skipped]:', assocError.response?.data?.message || assocError.message);
        }
      }

      return dealId;
    } catch (error) {
      console.error('[Deal Creation ERROR] Status:', error.response?.status);
      console.error('[Deal Creation ERROR] Details:', error.response?.data);
      throw new Error(`Failed to create deal: ${error.response?.data?.message || error.message}`);
    }
  }

  async testConnection() {
    try {
      // Ensure token is loaded
      if (!this.accessToken) {
        await this.loadTokenFromDB();
      }
      
      if (!this.accessToken) {
        return { 
          success: false, 
          error: 'No token found. Visit: /api/hubspot/oauth/authorize first',
          tokenStatus: 'missing'
        };
      }

      const response = await this.getClient().get('/crm/v3/objects/contacts?limit=1');
      return { 
        success: true, 
        message: '✅ HubSpot Connected!',
        tokenStatus: 'working',
        contactsCount: response.data.total || 0,
        tokenPreview: this.accessToken.substring(0, 20) + '...'
      };
    } catch (error) {
      console.error('[Test Connection ERROR]:', error.response?.data || error.message);
      return { 
        success: false, 
        error: 'Connection failed',
        details: error.response?.data?.message || error.message,
        tokenStatus: this.accessToken ? 'invalid' : 'missing'
      };
    }
  }
}

module.exports = new HubSpotClient();
