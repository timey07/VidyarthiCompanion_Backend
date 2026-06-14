const express = require('express');
const router = express.Router();
const {
  getWalletSummary,
  listTransactions,
  ingestTransaction,
  tagTransaction,
  getRecommendation,
  getMealPlan,
} = require('./pocket.controller');

// GET  /api/v1/pocket/summary        -> balance, budget, runway, category breakdown
router.get('/summary', getWalletSummary);

// GET  /api/v1/pocket/transactions   -> paginated transaction history
router.get('/transactions', listTransactions);

// POST /api/v1/pocket/transactions/:id/tag -> crowdsource a merchant category
router.post('/transactions/:id/tag', tagTransaction);

// POST /api/v1/pocket/ingest         -> passive ingestion (raw notification or structured)
router.post('/ingest', ingestTransaction);

// POST /api/v1/pocket/webhook        -> back-compat alias for ingest
router.post('/webhook', ingestTransaction);

// GET  /api/v1/pocket/recommendation -> wallet vs wellness (reads Mess consensus)
router.get('/recommendation', getRecommendation);

// GET  /api/v1/pocket/meals          -> affordable meal options for remaining budget
router.get('/meals', getMealPlan);

module.exports = router;
