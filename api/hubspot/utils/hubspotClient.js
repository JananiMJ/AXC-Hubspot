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

  async createDeal(dealData) {
    try {
      const response = await this.getClient().post('/crm/v3/objects/deals', { properties: dealData });
      return { success: true, dealId: response.data.id };
    } catch (error) {
      console.error('Deal creation error:', error.message);
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
}

module.exports = new HubSpotClient();