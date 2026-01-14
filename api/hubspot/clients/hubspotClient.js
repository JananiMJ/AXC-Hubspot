const axios = require('axios');
const HubSpotSync = require('./models/hubspotSync'); // YOUR MODEL
require('dotenv').config();

class HubSpotClient {
  constructor() {
    this.baseURL = 'https://api.hubapi.com';
    this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  }

  // Load token from YOUR MongoDB model
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

  async setAccessToken(token) {
    this.accessToken = token;
    process.env.HUBSPOT_ACCESS_TOKEN = token;
    console.log('✅ HubSpot token set');
  }

  // YOUR ORIGINAL createDeal METHOD (PERFECT)
  async createDeal(studentEmail, dealData) {
    try {
      console.log('[Deal Creation] Starting for:', dealData.courseName, 'Student:', studentEmail);
      
      // Find or create contact
      let contactId = await this.findOrCreateContact(studentEmail);
      
      // Calculate close date
      const closeDate = new Date();
      closeDate.setDate(closeDate.getDate() + 30);
      const closeDateStr = closeDate.toISOString().split('T')[0];

      const dealProperties = {
        dealname: `${dealData.courseName} - Enrollment`,
        amount: String(Math.round(dealData.courseAmount * 100)), // HubSpot expects cents
        dealstage: 'negotiation',
        closedate: closeDateStr,
        course_name: dealData.courseName,
        student_email: studentEmail
      };

      console.log('[Deal Properties]:', dealProperties);

      const dealResponse = await this.getClient().post('/crm/v3/objects/deals', {
        properties: dealProperties
      });

      const dealId = dealResponse.data.id;
      console.log('[Deal Created] ID:', dealId);

      // Associate deal with contact
      try {
        await this.getClient().put(
          `/crm/v4/objects/deals/${dealId}/associations/contacts`,
          [{ id: contactId, type: 'deal_to_contact' }]
        );
        console.log('[Deal Associated] Linked to contact:', contactId);
      } catch (assocError) {
        console.warn('[Association Warning]:', assocError.response?.data?.message);
      }

      return dealId;
    } catch (error) {
      console.error('[Deal Error] Status:', error.response?.status);
      console.error('[Deal Error] Message:', error.response?.data?.message);
      throw new Error(`Deal creation failed: ${error.response?.data?.message || error.message}`);
    }
  }

  async findOrCreateContact(email) {
    try {
      // Search existing contact
      const searchResponse = await this.getClient().get(
        `/crm/v3/objects/contacts/search`,
        { params: { 
          filterGroups: [{ 
            filters: [{ 
              propertyName: 'email', 
              operator: 'EQ', 
              value: email 
            }] 
          }] 
        }}
      );
      
      if (searchResponse.data.total > 0) {
        return searchResponse.data.results[0].id;
      }
    } catch (searchError) {
      console.log('Contact search failed, creating new:', searchError.message);
    }

    // Create new contact
    const contactResponse = await this.getClient().post('/crm/v3/objects/contacts', {
      properties: { email }
    });
    
    return contactResponse.data.id;
  }

  async testConnection() {
    try {
      // Try to load token first
      const hasToken = await this.loadAccessToken();
      if (!hasToken && !this.accessToken) {
        return { 
          success: false, 
          error: 'No OAuth token found. Visit /api/hubspot/oauth/authorize first',
          solution: 'Complete OAuth flow'
        };
      }
      
      const response = await this.getClient().get('/crm/v3/objects/contacts?limit=1');
      return { 
        success: true, 
        message: '✅ HubSpot connected successfully!', 
        contactsCount: response.data.total || 0 
      };
    } catch (error) {
      return { 
        success: false, 
        error: 'Authentication failed',
        details: error.response?.data?.message || error.message,
        solution: '1. Check OAuth token 2. Verify HubSpot app permissions'
      };
    }
  }
}

module.exports = new HubSpotClient();
