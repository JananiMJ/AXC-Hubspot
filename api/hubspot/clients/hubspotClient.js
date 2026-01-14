const axios = require('axios');
require('dotenv').config();

class HubSpotClient {


  constructor() {
  this.baseURL = 'https://api.hubapi.com';
  this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN || null;
  console.log('[HubSpotClient] Initialized with token:', 
    this.accessToken ? 'Yes' : 'No (will use OAuth)');
}

  

  getClient() {
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

  
  getHeaders() {
  
  const token = this.accessToken || process.env.HUBSPOT_ACCESS_TOKEN;
  
  if (!token) {
    console.warn('[WARNING] No HubSpot access token found!');
    console.warn('Make sure to:');
    console.warn('1. Complete OAuth flow: https://axc-hubspot.onrender.com/api/hubspot/oauth/authorize');
    console.warn('2. OR set HUBSPOT_ACCESS_TOKEN environment variable');
  }
  
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}


  async createDeal(contactId, dealData) {
    try {
      console.log('[Deal Creation] Starting:', dealData.courseName);
      const closeDate = new Date();
      closeDate.setDate(closeDate.getDate() + 30);
      const closeDateStr = closeDate.toISOString().split('T')[0];

      const courseCode = dealData.courseCode || 'UNKNOWN-COURSE';
      const contactName = dealData.contactName || 'Unknown';
      const dealName = `${contactName} – ${courseCode}`;

      const dealProperties = {
        dealname: dealName,
        amount: String(Math.round((dealData.courseAmount || 0) * 100)),
        dealstage: 'send_enrollment_details',
        pipeline: 'b2c_pipeline',
        closedate: closeDateStr,
      };

      const dealResponse = await axios.post(
        'https://api.hubapi.com/crm/v3/objects/deals',
        { properties: dealProperties },
        { headers: this.getHeaders() }
      );

      const dealId = dealResponse.data.id;
      try {
        await axios.put(
          `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/contacts`,
          [{ id: contactId, type: 'deal_to_contact' }],
          { headers: this.getHeaders() }
        );
      } catch (e) { console.log('[Association Warning]'); }
      return dealId;
    } catch (error) {
      throw new Error(`Failed: ${error.response?.data?.message || error.message}`);
    }
  }

  async testConnection() {
    try {
      const response = await this.getClient().get('/crm/v3/objects/contacts?limit=1');
      return { success: true, message: 'Connected', contactsCount: response.data.total || 0 };
    } catch (error) {
      return { success: false, error: 'Connection failed' };
    }
  }

  async getPipelines() {
    console.log('[getPipelines] Calling API...');
    const response = await axios.get(
      `${this.baseURL}/crm/v3/objects/deals/pipelines`,
      { headers: this.getHeaders() }
    );
    console.log('[getPipelines] Found:', response.data.results.length);
    return response.data.results;
  }

  async getPipelineStages(pipelineId) {
    console.log('[getPipelineStages] Pipeline:', pipelineId);
    const response = await axios.get(
      `${this.baseURL}/crm/v3/objects/deals/pipelines/${pipelineId}/stages`,
      { headers: this.getHeaders() }
    );
    console.log('[getPipelineStages] Found:', response.data.results.length);
    return response.data.results;
  }
}

module.exports = new HubSpotClient();
