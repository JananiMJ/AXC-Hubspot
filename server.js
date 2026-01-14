const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000; // Render uses 10000, not 3000

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// MongoDB Connection (Render compatible)
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Error:', err.message));
}

// YOUR EXISTING ROUTES STRUCTURE
app.use('/api/hubspot', require('./api/hubspot/routes/hubspotRoutes'));

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'PMV HubSpot Integration API is running',
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? '✅ Connected' : '❌ Disconnected',
    domain: process.env.DOMAIN || 'localhost'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'PMV HubSpot Integration API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      oauth: {
        authorize: '/api/hubspot/oauth/authorize',
        callback: '/api/hubspot/oauth/callback'
      },
      webhook: '/api/hubspot/webhook',
      test: '/api/hubspot/test-connection'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║     PMV HubSpot Integration API Server Started            ║
╠════════════════════════════════════════════════════════════╣
║ Port: ${PORT}                                              ║
║ Environment: ${process.env.NODE_ENV || 'development'}      ║
║ Domain: ${process.env.DOMAIN || 'localhost'}               ║
║ Health Check: ${process.env.DOMAIN ? `https://${process.env.DOMAIN}/health` : `http://localhost:${PORT}/health`} ║
╚════════════════════════════════════════════════════════════╝
  `);
});
