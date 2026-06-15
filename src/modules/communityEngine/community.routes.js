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
  getNodeBaseline,
  adoptNodeBaseline,
  getMeetupSlots,
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

// Empathy Mesh: find a shared free slot to meet a fellow member.
router.get('/nodes/:nodeId/meetup/:memberId', getMeetupSlots);

// Admin-only: update the community's baseline timetable (Academic) or menu (Mess).
router.put('/nodes/:nodeId/baseline', updateBaseline);

// Member-only: view a community's official timetable/menu, and adopt it into
// the member's personal profile (replacing their previous version).
router.get('/nodes/:nodeId/baseline', getNodeBaseline);
router.post('/nodes/:nodeId/adopt-baseline', adoptNodeBaseline);

// Mess community per-meal voting (Eatable / Leave), time-gated to the current meal.
router.get('/nodes/:nodeId/mess-vote', getMessVotes);
router.post('/nodes/:nodeId/mess-vote', castMessVote);

module.exports = router;
