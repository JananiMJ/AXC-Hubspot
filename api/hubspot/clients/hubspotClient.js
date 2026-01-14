const axios = require('axios');
require('dotenv').config();

class HubSpotClient {
  constructor() {
    this.baseURL = 'https://api.hubapi.com';
    this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  }

  // Get axios client with auth headers
  getClient() {
    return axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // Set access token
  setAccessToken(token) {
    this.accessToken = token;
    process.env.HUBSPOT_ACCESS_TOKEN = token;
  }

  // Get headers for requests
  getHeaders() {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  // Create a deal in HubSpot
  async createDeal(contactId, dealData) {
    try {
      console.log('[Deal Creation] Starting deal creation for:', dealData.courseName);

      // Calculate close date (30 days from now)
      const closeDate = new Date();
      closeDate.setDate(closeDate.getDate() + 30);
      const closeDateStr = closeDate.toISOString().split('T')[0];

      // Extract course code
      const courseCode = dealData.courseCode || 'UNKNOWN-COURSE';
      const contactName = dealData.contactName || 'Unknown';
      
      // Create deal name: "John Doe – JS-101"
      const dealName = `${contactName} – ${courseCode}`;

      // Prepare deal properties
      const dealProperties = {
        dealname: dealName,
        amount: String(Math.round((dealData.courseAmount || 0) * 100)), // Convert to cents
        dealstage: 'send_enrollment_details',
        pipeline: 'b2c_pipeline',
        closedate: closeDateStr,
      };

      console.log('[Deal Creation] Properties:', dealProperties);
      console.log('[Deal Creation] Contact ID:', contactId);

      // Create deal
      const dealResponse = await axios.post(
        'https://api.hubapi.com/crm/v3/objects/deals',
        {
          properties: dealProperties,
        },
        {
          headers: this.getHeaders(),
        }
      );

      const dealId = dealResponse.data.id;
      console.log('[Deal Created] Deal ID:', dealId);

      // Now associate the deal with the contact
      try {
        await axios.put(
          `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/contacts`,
          [
            {
              id: contactId,
              type: 'deal_to_contact',
            },
          ],
          {
            headers: this.getHeaders(),
          }
        );
        console.log('[Deal Associated] Deal linked to contact');
      } catch (assocError) {
        console.log('[Deal Association Warning] Could not associate (non-critical):', 
          assocError.response?.data?.message
        );
        // Don't throw - deal was created successfully
      }

      return dealId;
    } catch (error) {
      console.error('[Deal Creation Error] Status:', error.response?.status);
      console.error('[Deal Creation Error] Message:', error.response?.data?.message);
      console.error('[Deal Creation Error] Details:', error.response?.data);
      throw new Error(`Failed to create deal: ${error.response?.data?.message || error.message}`);
    }
  }

  // Test HubSpot connection
  async testConnection() {
    try {
      const response = await this.getClient().get('/crm/v3/objects/contacts?limit=1');
      return { success: true, message: 'Connected', contactsCount: response.data.total || 0 };
    } catch (error) {
      console.error('[Test Connection Error]:', error.message);
      return { success: false, error: 'Connection failed' };
    }
  }

  // NEW: Get available pipelines
  async getPipelines() {
    try {
      const response = await axios.get(
        `${this.baseURL}/crm/v3/objects/deals/pipelines`,
        { headers: this.getHeaders() }
      );

      console.log('[Available Pipelines]:', 
        response.data.results.map(p => ({ id: p.id, label: p.label }))
      );

      return response.data.results;
    } catch (error) {
      console.error('[Error fetching pipelines]:', error.message);
      throw error;
    }
  }

  // NEW: Get pipeline stages
  async getPipelineStages(pipelineId) {
    try {
      const response = await axios.get(
        `${this.baseURL}/crm/v3/objects/deals/pipelines/${pipelineId}/stages`,
        { headers: this.getHeaders() }
      );

      console.log('[Available Stages]:', 
        response.data.results.map(s => ({ id: s.id, label: s.label }))
      );

      return response.data.results;
    } catch (error) {
      console.error('[Error fetching stages]:', error.message);
      throw error;
    }
  }
}

module.exports = new HubSpotClient();
