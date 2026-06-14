const express = require('express');
const router = express.Router();
const { getWalletSummary, processTransaction, getMealPlan } = require('./pocket.controller');

// GET  /api/v1/pocket/summary  -> live balance, budget, meal recommendation
router.get('/summary', getWalletSummary);

// POST /api/v1/pocket/webhook  -> Amazon Pay sandbox transaction
router.post('/webhook', processTransaction);

// GET  /api/v1/pocket/meals    -> affordable meal options for remaining budget
router.get('/meals', getMealPlan);

module.exports = router;
