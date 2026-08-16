const express = require('express');
const Joi = require('joi');
const { Notification, User } = require('../models');
const { redis } = require('../config/redis');
const { verifyJWT } = require('../middleware/auth');
const { globalRateLimiter, perUserRateLimiter } = require('../middleware/rateLimiter');
const { getUserPreferences, inQuietHours, deliverNotification } = require('../services/notificationDelivery');

const router = express.Router();

const schema = Joi.object({
  recipientId: Joi.string().required(),
  senderId: Joi.string().required(),
  type: Joi.string().valid('like', 'comment', 'follow', 'mention', 'system').required(),
  payload: Joi.object().default({}),
  idempotencyKey: Joi.string().required(),
  priority: Joi.number().min(1).max(10).default(5),
});

const dispatch = async (data) => {
  const { recipientId, senderId, type, payload, idempotencyKey } = data;
  try {
    await deliverNotification({ recipientId, senderId, type, payload, idempotencyKey });
  } catch (err) {
    console.error('[Notify] dispatch failed:', err.message);
    redis.incr('metrics:failed').catch(() => { });
  }
};

// POST /api/notify — accept a notification, dispatch async via setImmediate
router.post('/', verifyJWT, globalRateLimiter, perUserRateLimiter, async (req, res, next) => {
  try {
    // Accept idempotencyKey from Idempotency-Key header or request body
    if (req.headers['idempotency-key'] && !req.body.idempotencyKey) {
      req.body.idempotencyKey = req.headers['idempotency-key'];
    }

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { idempotencyKey } = value;

    // Layer 1 idempotency — single Redis SET NX, cheap and high-value
    const set = await redis.set(`idem:${idempotencyKey}`, '1', 'EX', 86400, 'NX');
    if (!set) return res.status(409).json({ error: 'duplicate', message: 'Notification already queued' });

    res.status(202).json({ status: 'accepted' });

    setImmediate(() => {
      dispatch(value).catch((err) => {
        console.error('[Notify] dispatch failed:', err.message);
        redis.incr('metrics:failed').catch(() => { });
      });
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.getUserPreferences = getUserPreferences;
module.exports.inQuietHours = inQuietHours;

