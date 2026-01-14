const axios = require('axios');
require('dotenv').config();

class HubSpotClient {
  constructor() {
    this.baseURL = 'https://api.hubapi.com';
    this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
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

  async createDeal(contactId, dealData) {
  try {
    console.log('[Deal Creation] Starting deal creation for:', dealData.courseName);
    
    // Calculate close date (30 days from now)
    const closeDate = new Date();
    closeDate.setDate(closeDate.getDate() + 30);
    const closeDateStr = closeDate.toISOString().split('T')[0];

    // Prepare deal properties


    const dealProperties = {
  dealname: dealData.courseName || 'New Deal',
  amount: String(Math.round(dealData.courseAmount * 100)), // Convert to cents
  dealstage: 'appointmentscheduled',  // ✅ CORRECT STAGE FROM YOUR ERROR
  closedate: closeDateStr
};
    
    console.log('[Deal Creation] Properties:', dealProperties);
    console.log('[Deal Creation] Contact ID:', contactId);

    // Create deal
    const dealResponse = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/deals',
      {
        properties: dealProperties
      },
      {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
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
            type: 'deal_to_contact'
          }
        ],
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log('[Deal Associated] Deal linked to contact');
    } catch (assocError) {
      console.log('[Deal Association Warning] Could not associate (non-critical):', assocError.response?.data?.message);
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


  async testConnection() {
    try {
      const response = await this.getClient().get('/crm/v3/objects/contacts?limit=1');
      return { success: true, message: 'Connected', contactsCount: response.data.total || 0 };
    } catch (error) {
      return { success: false, error: 'Connection failed' };
    }
  }
}

module.exports = new HubSpotClient();
