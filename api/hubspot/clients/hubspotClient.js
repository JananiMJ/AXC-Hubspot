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
    console.log('[Deal Creation] Starting for contact:', contactId);

    const closeDate = new Date();
    closeDate.setDate(closeDate.getDate() + 30);
    const closeDateStr = closeDate.toISOString().split('T')[0];

    // ✅ Use real contact name and course code
    const courseCode = dealData.courseCode || 'UNKNOWN-COURSE';
    const contactName = dealData.contactName || 'Unknown';
    
    // Create proper deal name: "Janani Divya – UEE62220"
    const dealName = `${contactName} – ${courseCode}`;

    console.log('[Deal Name Created]:', dealName);

    const dealProperties = {
      dealname: dealName,
      amount: String(Math.round((dealData.courseAmount || 0) * 100)),
      dealstage: '1032873244',    // Your stage ID
      pipeline: '705874836',      // Your pipeline ID
      closedate: closeDateStr,
    };

    console.log('[Deal Properties]:', dealProperties);

    const dealResponse = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/deals',
      { properties: dealProperties },
      { headers: this.getHeaders() }
    );

    const dealId = dealResponse.data.id;
    console.log('[Deal Created] ID:', dealId);

    // Associate deal with contact
    try {
      await axios.put(
        `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/contacts`,
        [{ id: contactId, type: 'deal_to_contact' }],
        { headers: this.getHeaders() }
      );
      console.log('[Deal Associated] Deal linked to contact');
    } catch (assocError) {
      console.log('[Association Warning] Could not associate:', assocError.message);
    }

    return dealId;
  } catch (error) {
    console.error('[Deal Creation Error]', error.response?.data || error.message);
    throw new Error(`Failed: ${error.response?.data?.message || error.message}`);
  }
}
async findDealByEnrolId(enrolId) {
  const response = await axios.post(
    `${this.baseURL}/crm/v3/objects/deals/search`,
    {
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'enrol_enrolment_id',
              operator: 'EQ',
              value: enrolId,
            },
          ],
        },
      ],
      properties: ['enrolment_status'],
      limit: 1,
    },
    { headers: this.getHeaders() }
  );

  return response.data.results.length
    ? response.data.results[0]
    : null;
}
async updateDealStatus(dealId, statusValue) {
  await axios.patch(
    `${this.baseURL}/crm/v3/objects/deals/${dealId}`,
    {
      properties: {
        enrolment_status: statusValue,
      },
    },
    { headers: this.getHeaders() }
  );

  console.log(`[✅ Status Updated] Deal ID: ${dealId}`);
}
async updateDealStatusOnly(dealId, statusValue) {
  try {
    await axios.patch(
      `${this.baseURL}/crm/v3/objects/deals/${dealId}`,
      {
        properties: {
          enrolment_status: statusValue
        }
      },
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('[✅ HubSpot Deal Status Updated]', {
      dealId,
      enrolment_status: statusValue
    });

    return true;
  } catch (error) {
    console.error('[❌ HubSpot Status Update Error]',
      error.response?.data || error.message
    );
    throw error;
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
