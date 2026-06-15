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
  promoteMember,
  listNodeMembers,
  getNodeFeed,
  updateBaseline,
} = require('./node.controller');
const { getMessVotes, castMessVote } = require('./messVote.controller');

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
router.post('/nodes/:nodeId/admins', promoteMember);
router.get('/nodes/:nodeId/members', listNodeMembers);
router.get('/nodes/:nodeId/feed', getNodeFeed);

// Admin-only: update the community's baseline timetable (Academic) or menu (Mess).
router.put('/nodes/:nodeId/baseline', updateBaseline);

// Mess community per-meal voting (Eatable / Leave), time-gated to the current meal.
router.get('/nodes/:nodeId/mess-vote', getMessVotes);
router.post('/nodes/:nodeId/mess-vote', castMessVote);

module.exports = router;
