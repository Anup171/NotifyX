const DEFAULT_PREFERENCES = {
  inApp: true,
  email: false,
  push: false,
  quietHours: { enabled: false, startHour: 22, endHour: 7 },
  mutedTypes: [],
};

const NOTIFICATION_TYPES = ['like', 'comment', 'follow', 'mention'];

module.exports = { DEFAULT_PREFERENCES, NOTIFICATION_TYPES };
