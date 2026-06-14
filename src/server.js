require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./core/db');
const AcademicEvent = require('./sharedModels/AcademicEvent.model');
const alertScheduler = require('./core/alertScheduler');
const { protect } = require('./core/authMiddleware');

// Initialize App
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ extended: true }));

// Health Check Route
app.get('/', (req, res) => {
  res.status(200).json({ status: 'CampusOS API is running normally.' });
});

// --- Mount All Routes Here ---
// Public auth routes (register/login). /auth/me is protected internally.
app.use('/api/v1/auth', require('./modules/authEngine/auth.routes'));

// All feature routes require a valid JWT. `protect` populates req.user.
app.use('/api/v1/overrides', protect, require('./modules/overrideEngine/override.routes'));
app.use('/api/v1/pocket', protect, require('./modules/pocketBuddy/pocket.routes'));
app.use('/api/v1/empathy', protect, require('./modules/empathyMesh/empathy.routes'));
app.use('/api/v1/community', protect, require('./modules/communityEngine/community.routes'));
app.use('/api/v1/retrieval', protect, require('./modules/retrievalEngine/retrieval.routes'));
app.use('/api/v1/transit', protect, require('./modules/transitEngine/transit.routes'));
app.use('/api/v1/presence', protect, require('./modules/presenceEngine/presence.routes'));
app.use('/api/v1/routine', protect, require('./modules/routineEngine/routine.routes'));

// --- Bootstrapper Function ---
const bootstrapAlarms = async () => {
  try {
    const now = new Date();
    // Find all events that have not happened yet
    const upcomingEvents = await AcademicEvent.find({ date: { $gt: now } });
    
    console.log(`[Bootstrap] Found ${upcomingEvents.length} upcoming events. Rearming alarms...`);
    upcomingEvents.forEach(event => {
      alertScheduler.scheduleEventAlert(event);
    });
  } catch (error) {
    console.error('[Bootstrap] Failed to rearm alarms:', error);
  }
};

// Start Server and Connect DB
const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // 1. Connect to MongoDB first
  await connectDB(); 
  
  // 2. Once DB is connected, fetch events and set alarms
  await bootstrapAlarms(); 
});