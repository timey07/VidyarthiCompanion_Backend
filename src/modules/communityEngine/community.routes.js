const express = require('express');
const router = express.Router();
const { listScheduleEvents, submitEventVote, listAlerts } = require('./community.controller');
const {
  createNode,
  listMyNodes,
  listAllNodes,
  joinNode,
  joinByCode,
  leaveNode,
  approveRequest,
  listNodeMembers,
  getNodeFeed,
  postNodeUpdate,
} = require('./node.controller');

// --- Alerts (wellbeing / wellness nudges) ---
router.get('/alerts', listAlerts);

// --- Academic event consensus (Echo +1 / Flag -1) ---
router.get('/events', listScheduleEvents);
router.post('/events/vote', submitEventVote);

// --- Multi-Tiered Community Graph (nodes) ---
router.post('/nodes', createNode);
router.get('/nodes', listMyNodes);
router.get('/nodes/all', listAllNodes);
router.post('/nodes/join-by-code', joinByCode);
router.post('/nodes/:nodeId/join', joinNode);
router.post('/nodes/:nodeId/leave', leaveNode);
router.post('/nodes/:nodeId/approve', approveRequest);
router.get('/nodes/:nodeId/members', listNodeMembers);
router.get('/nodes/:nodeId/feed', getNodeFeed);
router.post('/nodes/:nodeId/updates', postNodeUpdate);

module.exports = router;
