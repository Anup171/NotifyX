const { User, Notification } = require('../models');
const { redis } = require('../config/redis');
const { getIO, isOnline } = require('../socket/socketServer');
const { DEFAULT_PREFERENCES } = require('../../../shared/constants');

const getUserPreferences = async (userId) => {
  const key = `prefs:${userId}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);
  const user = await User.findOne({ userId }).select('preferences').lean();
  const prefs = user?.preferences || DEFAULT_PREFERENCES;
  await redis.set(key, JSON.stringify(prefs), 'EX', 300);
  return prefs;
};

const inQuietHours = (quietHours) => {
  if (!quietHours?.enabled) return false;
  const hour = new Date().getHours();
  const { startHour, endHour } = quietHours;
  return startHour > endHour
    ? hour >= startHour || hour < endHour
    : hour >= startHour && hour < endHour;
};

const deliverNotification = async ({ recipientId, senderId, type, payload, idempotencyKey }) => {
  const io = getIO();

  // Enforce user preferences before creating notification
  try {
    const prefs = await getUserPreferences(recipientId);
    if (!prefs.inApp) return null;
    if (prefs.mutedTypes?.includes(type)) return null;
    if (inQuietHours(prefs.quietHours)) return null;
  } catch (err) {
    console.error(`[NotificationDelivery] Preference check error for ${recipientId}: ${err.message}`);
    // Proceed with notification delivery if preference check fails
  }

  try {
    const notif = await Notification.create({
      recipientId,
      senderId,
      type,
      payload,
      idempotencyKey,
      delivered: isOnline(recipientId),
    });

    redis.incr('metrics:success').catch(() => { });

    if (io && isOnline(recipientId)) {
      io.to(recipientId).emit('notification', notif);
    }

    return notif;
  } catch (err) {
    if (err.code === 11000) return null; // Duplicate idempotencyKey
    throw err;
  }
};

module.exports = {
  getUserPreferences,
  inQuietHours,
  deliverNotification,
};
