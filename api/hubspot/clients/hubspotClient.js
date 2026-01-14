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

      /* ✅ FIXED: Close Date */
      const closeDate = new Date();
      closeDate.setDate(closeDate.getDate() + 30);
      const closeDateStr = closeDate.toISOString().split('T')[0];

      /* ✅ FIXED: Get Contact Name - Proper error handling */
      let contactName = 'Unknown Student';
      let firstName = '';
      let lastName = '';

      if (contactId) {
        try {
          const contactResponse = await axios.get(
            `${this.baseURL}/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname`,
            { headers: this.getHeaders() }
          );

          firstName = contactResponse.data.properties.firstname?.value || '';
          lastName = contactResponse.data.properties.lastname?.value || '';

          contactName = `${firstName} ${lastName}`.trim() || 'Unknown Student';
          console.log('[✅ Contact Name Retrieved]:', contactName);
        } catch (nameErr) {
          console.log('[⚠️ Could not fetch contact name]:', nameErr.message);
          contactName = 'Unknown Student';
        }
      }

      /* ✅ FIXED: Course Code - must come from dealData */
      const courseCode = dealData.courseCode || 
                        dealData.courseName || 
                        dealData.course_code ||
                        dealData.productName ||
                        'UNKNOWN-COURSE';

      console.log('[Course Code]:', courseCode);

      /* ✅ FIXED: Deal Name Format - "FirstName LastName – CourseCode" */
      const dealName = `${contactName} – ${courseCode}`;
      console.log('[Deal Name Generated]:', dealName);

      /* ✅ FIXED: Deal Properties with correct pipeline and stage */
      const dealProperties = {
        dealname: dealName,
        amount: String(Math.round((dealData.courseAmount || 0) * 100)), // in cents
        dealstage: 'send_enrollment_details',  // ✅ CORRECT STAGE
        pipeline: 'b2c_pipeline',  // ✅ B2C PIPELINE
        closedate: closeDateStr,
      };

      console.log('[Deal Properties]:', dealProperties);

      /* Create Deal */
      const dealResponse = await axios.post(
        `${this.baseURL}/crm/v3/objects/deals`,
        { properties: dealProperties },
        { headers: this.getHeaders() }
      );

      const dealId = dealResponse.data.id;
      console.log('[✅ Deal Created] Deal ID:', dealId);

      /* Associate Contact with Deal */
      if (contactId) {
        try {
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
        } catch (assocErr) {
          console.log('[⚠️ Association failed (non-critical)]:', assocErr.message);
          // Continue - deal exists even if association fails
        }
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
