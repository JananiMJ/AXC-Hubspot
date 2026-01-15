const axios = require('axios');
const statusMapping = {
  'active': 'Active',
  'completed': 'Completed',
  'paused': 'Paused',
  'cancelled': 'Cancelled',
  'pending': 'Pending',
  'inactive': 'Inactive',
};
async function updateHubSpotEnrollmentStatus(enrollmentId, newStatus, hubspotAccessToken) {
  try {
    const hubspotStatus = statusMapping[newStatus.toLowerCase()];
    if (!hubspotStatus) {
      throw new Error(`Unknown status mapping for: ${newStatus}`);
    }
    const searchUrl = 'https://api.hubapi.com/crm/v3/objects/contacts/search';
    const searchPayload = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'enrollment_id',
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
    if (!searchResponse.data.results || searchResponse.data.results.length === 0) {
      throw new Error(`No HubSpot contact found with enrollment ID: ${enrollmentId}`);
    }
    const contactId = searchResponse.data.results[0].id;
    const updateUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`;
    const updatePayload = {
      properties: {
        enrollment_status: hubspotStatus,
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
async function syncEnrollmentStatusToHubSpot(enrollment, hubspotAccessToken) {
  try {
    const { id: enrollmentId, status: enrollmentStatus } = enrollment;
    if (!enrollmentId || !enrollmentStatus) {
      console.warn('⚠️ Missing enrollment ID or status, skipping HubSpot sync');
      return null;
    }
    const hubspotUpdate = await updateHubSpotEnrollmentStatus(enrollmentId, enrollmentStatus, hubspotAccessToken);
    return hubspotUpdate;
  } catch (error) {
    console.error('Error syncing to HubSpot:', error.message);
    return null;
  }
}
module.exports = { updateHubSpotEnrollmentStatus, syncEnrollmentStatusToHubSpot, statusMapping };
