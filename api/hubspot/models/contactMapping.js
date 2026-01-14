const mongoose = require('mongoose');

const contactMappingSchema = new mongoose.Schema({
  axcContactId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  hubspotContactId: {
    type: String,
    required: true,
    index: true
  },
  email: {
    type: String,
    default: null
  },
  firstName: {
    type: String,
    default: null
  },
  lastName: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('ContactMapping', contactMappingSchema);
