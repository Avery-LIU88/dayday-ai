// Business cadence is separate from bounded Worker requests within one run.
export const deliveryPolicy = {
  timezone: 'Asia/Shanghai', startHour: 21,
  dailyCategories: ['hot', 'activities'], episodePollMinutes: 30,
  maxMessageBytes: 12000, messagesPerRequest: 3, minSendIntervalMs: 1000,
  leaseMs: 600000, episodeLookbackDays: 7,
};
