const express = require('express');
const router = express.Router();
const { submitVote, listScheduleEvents, submitEventVote, listAlerts } = require('./community.controller');
const {
  createNode,
  listMyNodes,
  listAllNodes,
  joinNode,
  leaveNode,
  listNodeMembers,
} = require('./node.controller');

// --- Alerts (mess / wellness) ---
router.post('/vote', submitVote);
router.get('/alerts', listAlerts);

// --- Academic event consensus ---
router.get('/events', listScheduleEvents);
router.post('/events/vote', submitEventVote);

// --- Multi-Tiered Community Graph (nodes) ---
router.post('/nodes', createNode);
router.get('/nodes', listMyNodes);
router.get('/nodes/all', listAllNodes);
router.post('/nodes/:nodeId/join', joinNode);
router.post('/nodes/:nodeId/leave', leaveNode);
router.get('/nodes/:nodeId/members', listNodeMembers);

module.exports = router;
