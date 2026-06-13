const schedule = require('node-schedule');

exports.scheduleEventAlert = (event) => {
  // Calculate exactly 30 minutes before the event starts
  const alertTime = new Date(event.date.getTime() - 30 * 60000);

  // If the alert time is already in the past, don't schedule it
  if (alertTime < new Date()) {
    console.log(`[Scheduler] Skipped: Alert time for ${event.eventName} has already passed.`);
    return;
  }

  console.log(`[Scheduler] Alarm set for ${alertTime.toLocaleTimeString()} -> Event: ${event.eventName}`);

  // Schedule the job and label it with the unique Database ID
  schedule.scheduleJob(event._id.toString(), alertTime, () => {
    console.log(`\n[PUSH NOTIFICATION TRIGGERED] -> User: ${event.userId}`);
    console.log(`Payload: "Leave in 30 mins for ${event.eventName} at ${event.location}!"\n`);
  });
};

exports.cancelEventAlert = (eventId) => {
  // If the user deletes or changes an event, we cancel the old alarm
  const existingJob = schedule.scheduledJobs[eventId.toString()];
  if (existingJob) {
    existingJob.cancel();
    console.log(`[Scheduler] Canceled alarm for Event ID: ${eventId}`);
  }
};