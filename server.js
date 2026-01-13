const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    .then(() => {
      console.log('MongoDB connected successfully');
    })
    .catch((err) => {
      console.log('MongoDB connection error:', err.message);
    });
}

app.use('/api/hubspot', require('./api/hubspot/routes/hubspotRoutes'));

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'PMV HubSpot Integration API is running',
    timestamp: new Date().toISOString(),
    domain: process.env.DOMAIN,
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'PMV HubSpot Integration API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      oauth: {
        authorize: '/api/hubspot/oauth/authorize',
        callback: '/api/hubspot/oauth/callback',
      },
      webhook: '/api/hubspot/webhook',
      test: '/api/hubspot/test-connection',
    },
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
    method: req.method,
  });
});

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString(),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║     PMV HubSpot Integration API Server Started            ║
╠════════════════════════════════════════════════════════════╣
║ Port: ${PORT}                                              ║
║ Environment: ${process.env.NODE_ENV}                       ║
║ Domain: ${process.env.DOMAIN}                            ║
║ API Root: http://${process.env.DOMAIN}                    ║
║ Health Check: http://${process.env.DOMAIN}/health         ║
╚════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;