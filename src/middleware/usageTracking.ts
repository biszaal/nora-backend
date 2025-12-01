import { Request, Response, NextFunction } from 'express';

// Usage tracking types
export interface Usage {
  date: string;
  textMessages: number;
  voiceMessages: number;
  screenshotAnalysis: number;
  scamDetections: number;
  totalCost: number;
}

// In-memory storage for now (replace with Firebase/database in production)
const usageStore: Map<string, Usage> = new Map();

// Cost constants (in GBP)
const COSTS = {
  GPT35_TEXT: 0.008,
  GPT4O_TEXT: 0.025,
  WHISPER_VOICE: 0.031,
  GPT4O_VISION: 0.045,
};

// Tier limits
const TIER_LIMITS = {
  free: {
    maxMessagesPerDay: 20,
    maxImageAnalysisPerDay: 0,
  },
  premium: {
    maxMessagesPerDay: -1, // Unlimited (soft limit at 500/month)
    maxImageAnalysisPerDay: -1,
  },
  family: {
    maxMessagesPerDay: -1,
    maxImageAnalysisPerDay: -1,
  },
};

/**
 * Get usage key for today
 */
function getUsageKey(userId: string): string {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return `${userId}:${today}`;
}

/**
 * Get today's usage for a user
 */
export function getTodayUsage(userId: string): Usage {
  const key = getUsageKey(userId);
  const existing = usageStore.get(key);

  if (existing) {
    return existing;
  }

  // Create new usage record for today
  const newUsage: Usage = {
    date: new Date().toISOString().split('T')[0],
    textMessages: 0,
    voiceMessages: 0,
    screenshotAnalysis: 0,
    scamDetections: 0,
    totalCost: 0,
  };

  usageStore.set(key, newUsage);
  return newUsage;
}

/**
 * Increment usage counter
 */
export function incrementUsage(
  userId: string,
  type: 'text' | 'voice' | 'screenshot' | 'scam',
  tier: 'free' | 'premium' | 'family'
): void {
  const usage = getTodayUsage(userId);

  // Determine cost based on type and tier
  let cost = 0;
  if (type === 'text') {
    usage.textMessages++;
    cost = tier === 'free' ? COSTS.GPT35_TEXT : COSTS.GPT4O_TEXT;
  } else if (type === 'voice') {
    usage.voiceMessages++;
    cost = COSTS.WHISPER_VOICE;
  } else if (type === 'screenshot') {
    usage.screenshotAnalysis++;
    cost = COSTS.GPT4O_VISION;
  } else if (type === 'scam') {
    usage.scamDetections++;
    cost = COSTS.GPT4O_VISION;
  }

  usage.totalCost += cost;

  // Update storage
  const key = getUsageKey(userId);
  usageStore.set(key, usage);
}

/**
 * Middleware to check usage quota before processing request
 */
export function checkUsageQuota(
  type: 'text' | 'voice' | 'screenshot' | 'scam'
) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get user context from request
      const userContext = req.body.userContext || {};
      const tier = userContext.tier || 'free';
      const userId = req.body.userId || 'anonymous';

      // Get today's usage
      const usage = getTodayUsage(userId);

      // Check limits for free tier
      if (tier === 'free') {
        const limits = TIER_LIMITS.free;

        // Check text/voice message limit
        if (type === 'text' || type === 'voice') {
          const totalMessages = usage.textMessages + usage.voiceMessages;
          if (totalMessages >= limits.maxMessagesPerDay) {
            return res.status(429).json({
              error: 'Daily limit reached',
              upgradePrompt: true,
              limit: limits.maxMessagesPerDay,
              current: totalMessages,
              message: `You've reached your daily limit of ${limits.maxMessagesPerDay} messages. Upgrade to Premium for unlimited conversations!`,
            });
          }
        }

        // Check image analysis limit (should be 0 for free)
        if (type === 'screenshot' || type === 'scam') {
          return res.status(403).json({
            error: 'Premium feature',
            requiresPremium: true,
            message: `${type === 'screenshot' ? 'Screenshot Analysis' : 'Scam Detection'} is a Premium feature. Upgrade to access this feature!`,
          });
        }
      }

      // Track this request
      incrementUsage(userId, type, tier);

      // Add usage info to request for logging
      (req as any).usage = usage;
      (req as any).usageType = type;

      next();
    } catch (error) {
      console.error('Usage quota check error:', error);
      // Don't block request on error
      next();
    }
  };
}

/**
 * Middleware to add usage stats to response
 */
export function addUsageStats(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);

  res.json = function (data: any) {
    const userId = req.body.userId || 'anonymous';
    const tier = req.body.userContext?.tier || 'free';
    const usage = getTodayUsage(userId);
    const limits = TIER_LIMITS[tier as keyof typeof TIER_LIMITS];

    // Add usage stats to response
    const responseWithStats = {
      ...data,
      usage: {
        today: {
          messages: usage.textMessages + usage.voiceMessages,
          limit: limits.maxMessagesPerDay === -1 ? 'unlimited' : limits.maxMessagesPerDay,
          remaining: limits.maxMessagesPerDay === -1
            ? 'unlimited'
            : Math.max(0, limits.maxMessagesPerDay - (usage.textMessages + usage.voiceMessages)),
        },
        cost: usage.totalCost.toFixed(4),
      },
    };

    return originalJson(responseWithStats);
  };

  next();
}
