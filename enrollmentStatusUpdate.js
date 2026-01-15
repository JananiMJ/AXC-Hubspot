// enrollmentStatusUpdate.js
const axios = require('axios');

/**
 * Map Axcelerate enrollment status to HubSpot status values
 * Adjust the mapping based on your HubSpot dropdown options
 */
const statusMapping = {
  'active': 'Active',
  'completed': 'Completed',
  'paused': 'Paused',
  'cancelled': 'Cancelled',
  'pending': 'Pending',
  'inactive': 'Inactive',
  // Add more mappings as needed
};

/**
 * Update HubSpot contact's enrollment status
 * @param {string} enrollmentId - Axcelerate enrollment ID
 * @param {string} newStatus - New enrollment status from Axcelerate
 * @param {string} hubspotAccessToken - HubSpot API token
 * @returns {Promise<Object>} - HubSpot update response
 */
async function updateHubSpotEnrollmentStatus(enrollmentId, newStatus, hubspotAccessToken) {
  try {
    // Map the Axcelerate status to HubSpot status
    const hubspotStatus = statusMapping[newStatus.toLowerCase()];
    
    if (!hubspotStatus) {
      throw new Error(`Unknown status mapping for: ${newStatus}`);
    }

    // Step 1: Find the HubSpot contact by enrollment ID
    // Assuming you store enrollment ID in a custom HubSpot property
    const searchUrl = 'https://api.hubapi.com/crm/v3/objects/contacts/search';
    
    const searchPayload = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'enrollment_id', // Your custom HubSpot field
              operator: 'EQ',
              value: enrollmentId,
            },
          ],
        },
      ],
      properties: ['enrollment_status', 'enrollment_id'],
    };

    const searchResponse = await axios.post(searchUrl, searchPayload, {
      headers: {
        'Authorization': `Bearer ${hubspotAccessToken}`,
        'Content-Type': 'application/json',
      },
    });

    // Step 2: Extract the contact ID from search results
    if (!searchResponse.data.results || searchResponse.data.results.length === 0) {
      throw new Error(`No HubSpot contact found with enrollment ID: ${enrollmentId}`);
    }

    const contactId = searchResponse.data.results[0].id;

    // Step 3: Update the enrollment status in HubSpot
    const updateUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`;
    
    const updatePayload = {
      properties: {
        enrollment_status: hubspotStatus, // Your custom HubSpot dropdown field
      },
    };

    const updateResponse = await axios.patch(updateUrl, updatePayload, {
      headers: {
        'Authorization': `Bearer ${hubspotAccessToken}`,
        'Content-Type': 'application/json',
      },
    });

    console.log(`✅ Successfully updated HubSpot contact ${contactId} with status: ${hubspotStatus}`);
    return updateResponse.data;

  } catch (error) {
    console.error('❌ Error updating HubSpot enrollment status:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = {
  updateHubSpotEnrollmentStatus,
  statusMapping,
};
