const axios = require('axios');
const HubSpotSync = require('./models/hubspotSync');
require('dotenv').config();

class HubSpotClient {
  constructor() {
    this.baseURL = 'https://api.hubapi.com';
    this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  }

  async loadAccessToken() {
    try {
      const tokenRecord = await HubSpotSync.findOne({ 
        type: 'oauth_token', 
        status: 'success' 
      }).sort({ updatedAt: -1 }).limit(1);
      
      if (tokenRecord && tokenRecord.accessToken && 
          (!tokenRecord.expiresAt || tokenRecord.expiresAt > new Date())) {
        this.accessToken = tokenRecord.accessToken;
        return true;
      }
    } catch (error) {
      console.error('Token load error:', error);
    }
    return false;
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

  async setAccessToken(token) {
    this.accessToken = token;
    process.env.HUBSPOT_ACCESS_TOKEN = token;
    console.log('✅ HubSpot token set');
  }

  async createDeal(studentEmail, dealData) {
    try {
      console.log('[Deal Creation] Student:', studentEmail, 'Course:', dealData.courseName);
      
      // Find or create contact
      let contactId = await this.findOrCreateContact(studentEmail);
      
      const closeDate = new Date();
      closeDate.setDate(closeDate.getDate() + 30);
      const closeDateStr = closeDate.toISOString().split('T')[0];

      const dealProperties = {
        dealname: `${dealData.courseName} - Enrollment`,
        amount: String(Math.round(dealData.courseAmount * 100)),
        dealstage: 'negotiation',
        closedate: closeDateStr,
        course_name: dealData.courseName,
        student_email: studentEmail
      };

      const dealResponse = await this.getClient().post('/crm/v3/objects/deals', {
        properties: dealProperties
      });

      const dealId = dealResponse.data.id;
      console.log('[Deal Created] ID:', dealId);

      // Associate with contact
      try {
        await this.getClient().put(
          `/crm/v4/objects/deals/${dealId}/associations/contacts`,
          [{ id: contactId, type: 'deal_to_contact' }]
        );
      } catch (assocError) {
        console.warn('Association warning:', assocError.response?.data?.message);
      }

      return dealId;
    } catch (error) {
      console.error('[Deal Error]:', error.response?.data?.message);
      throw new Error(`Deal creation failed: ${error.response?.data?.message || error.message}`);
    }
  }

  async findOrCreateContact(email) {
    try {
      const searchResponse = await this.getClient().get('/crm/v3/objects/contacts/search', {
        params: { 
          filterGroups: [{ 
            filters: [{ propertyName: 'email', operator: 'EQ', value: email }] 
          }] 
        }
      });
      
      if (searchResponse.data.total > 0) {
        return searchResponse.data.results[0].id;
      }
    } catch (searchError) {
      console.log('Creating new contact');
    }

    const contactResponse = await this.getClient().post('/crm/v3/objects/contacts', {
      properties: { email }
    });
    
    return contactResponse.data.id;
  }

  async testConnection() {
    try {
      await this.loadAccessToken();
      if (!this.accessToken) {
        return { success: false, error: 'No OAuth token. Visit /api/hubspot/oauth/authorize' };
      }
      
      await this.getClient().get('/crm/v3/objects/contacts?limit=1');
      return { success: true, message: '✅ HubSpot connected!' };
    } catch (error) {
      return { 
        success: false, 
        error: 'Authentication failed',
        details: error.response?.data?.message || error.message 
      };
    }
  }
}

module.exports = new HubSpotClient();
