const axios = require('axios');
require('dotenv').config();

class HubSpotClient {
  constructor() {
    this.baseURL = 'https://api.hubapi.com';
    this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
    this.loadTokenFromDB(); // 🔥 ADD THIS LINE
  }

  // 🔥 NEW METHOD - Load token from YOUR MongoDB
  async loadTokenFromDB() {
    try {
      const mongoose = require('mongoose');
      const HubSpotSync = require('./models/hubspotSync'); // Adjust path
      
      const tokenRecord = await HubSpotSync.findOne({ 
        type: 'oauth_token',
        status: 'success'
      }).sort({ updatedAt: -1 });
      
      if (tokenRecord && tokenRecord.accessToken) {
        this.accessToken = tokenRecord.accessToken;
        console.log('✅ Token loaded from MongoDB');
        return true;
      }
    } catch (error) {
      console.log('Token load failed (not critical):', error.message);
    }
  }

  // Update getClient to auto-load token
  async getClient() {
    // Try loading token if none exists
    if (!this.accessToken) {
      await this.loadTokenFromDB();
    }
    
    if (!this.accessToken) {
      throw new Error('No HubSpot token. Run OAuth first.');
    }
    
    return axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

module.exports = new HubSpotClient();
