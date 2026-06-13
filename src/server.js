require('dotenv').config();
const express = require('express');
const cors = require('cors');
// const connectDB = require('./core/db');

// Initialize App
const app = express();

// Connect to Database
// connectDB(); // TODO: Uncomment once you add MONGO_URI to your .env file

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // High limit for Base64 image payloads
app.use(express.urlencoded({ extended: true }));

// Health Check Route
app.get('/', (req, res) => {
  res.status(200).json({ status: 'CampusOS API is running normally.' });
});

// Module Routes will be mounted here later
// e.g., app.use('/api/v1/overrides', require('./modules/overrideEngine/override.routes'));

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});