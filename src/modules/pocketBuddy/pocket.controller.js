exports.processTransaction = async (req, res) => {
  try {
    const { userId, vendor, amount, transactionType } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({ success: false, message: 'Missing userId or amount' });
    }

    // TODO: Later, we will use meal.service.js to check if they have enough budget left.
    // For now, we mock the ledger update.

    console.log(`Processing ${transactionType} of $${amount} at ${vendor} for ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Transaction recorded successfully',
      data: {
        newBalance: 45.00, // Mocked balance after a $5 deduction from a $50 budget
        alert: amount > 15 ? "High spend detected!" : null
      }
    });

  } catch (error) {
    console.error('PocketBuddy Error:', error);
    res.status(500).json({ success: false, message: 'Server Error processing transaction' });
  }
};