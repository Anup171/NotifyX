const express = require('express');
const { redis } = require('../config/redis');
const { verifyJWT } = require('../middleware/auth');

const { Notification } = require('../models');

const router = express.Router();

// GET /api/metrics — delivery statistics
router.get('/', verifyJWT, async (req, res, next) => {
  try {
    const [successStr, failedStr, dbTotal, dbUnread] = await Promise.all([
      redis.get('metrics:success'),
      redis.get('metrics:failed'),
      Notification.countDocuments({}),
      Notification.countDocuments({ status: 'unread' }),
    ]);

    const redisSuccess = parseInt(successStr || '0');
    const redisFailed  = parseInt(failedStr  || '0');

    // Use DB counts if redis is empty or smaller than DB total
    const total = Math.max(dbTotal, redisSuccess + redisFailed);
    const success = Math.max(redisSuccess, dbTotal - redisFailed);
    const failed = redisFailed;

    res.json({
      delivery: {
        total,
        success,
        failed,
        unread: dbUnread,
        successRate: total > 0 ? ((success / total) * 100).toFixed(2) : '100.00',
        failureRate: total > 0 ? ((failed  / total) * 100).toFixed(2) : '0.00',
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/metrics/series — time-series data for AreaChart
router.get('/series', verifyJWT, async (req, res, next) => {
  try {
    const range = req.query.range || '24h';
    const now = new Date();

    let labels, groupExpr, startTime;

    if (range === '1h') {
      // 60 minute buckets within last hour — group by minute
      startTime = new Date(now.getTime() - 60 * 60 * 1000);
      labels = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0') + 'm');
      groupExpr = { $minute: '$createdAt' };
    } else if (range === '7d') {
      // 7 day buckets — group by day-of-week
      startTime = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      // Build 7 labels: past 7 days in order
      labels = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(startTime.getTime() + i * 86400000);
        return dayNames[d.getDay()] + ' ' + (d.getMonth()+1) + '/' + d.getDate();
      });
      groupExpr = {
        $dateDiff: { startDate: startTime, endDate: '$createdAt', unit: 'day' }
      };
    } else if (range === '30d') {
      // 30 day buckets — group by day offset
      startTime = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      labels = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(startTime.getTime() + i * 86400000);
        return (d.getMonth()+1) + '/' + d.getDate();
      });
      groupExpr = {
        $dateDiff: { startDate: startTime, endDate: '$createdAt', unit: 'day' }
      };
    } else {
      // Default: 24h — group by hour of day
      startTime = new Date(now.getTime() - 24 * 3600 * 1000);
      labels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
      groupExpr = { $hour: '$createdAt' };
    }

    const bucketCount = labels.length;

    const agg = await Notification.aggregate([
      { $match: { createdAt: { $gte: startTime } } },
      {
        $group: {
          _id: groupExpr,
          count: { $sum: 1 },
          delivered: { $sum: { $cond: ['$delivered', 1, 0] } },
        }
      }
    ]);

    const sentMap = {}, delMap = {}, failMap = {};
    agg.forEach(item => {
      const idx = item._id;
      if (idx >= 0 && idx < bucketCount) {
        sentMap[idx] = (sentMap[idx] || 0) + item.count;
        delMap[idx]  = (delMap[idx]  || 0) + item.delivered;
        failMap[idx] = (failMap[idx] || 0) + (item.count - item.delivered);
      }
    });

    const sent      = labels.map((_, i) => sentMap[i] || 0);
    const delivered = labels.map((_, i) => delMap[i]  || 0);
    const failed    = labels.map((_, i) => failMap[i] || 0);

    res.json({ labels, sent, delivered, failed });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
