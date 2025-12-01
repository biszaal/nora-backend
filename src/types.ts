/**
 * User tier types for NoraAI
 */
export type UserTier = 'free' | 'premium';

/**
 * Feature flags based on tier
 */
export interface TierFeatures {
  // AI Model
  useAdvancedModel: boolean; // gpt-4 vs gpt-3.5-turbo

  // Premium Features
  screenshotAnalysis: boolean;
  scamDetection: boolean;
  emergencyFeatures: boolean;
  quickActions: boolean;
  familyPortal: boolean;

  // Limits
  maxMessagesPerDay: number;
  maxImageAnalysisPerDay: number;
}

/**
 * User context with tier information
 */
export interface UserContext {
  userId?: string;
  tier: UserTier;
  deviceType?: 'iOS' | 'Android';
  deviceModel?: string;
  osVersion?: string;
}

/**
 * Get features available for a tier
 */
export function getTierFeatures(tier: UserTier): TierFeatures {
  if (tier === 'premium') {
    return {
      useAdvancedModel: true,
      screenshotAnalysis: true,
      scamDetection: true,
      emergencyFeatures: true,
      quickActions: true,
      familyPortal: true,
      maxMessagesPerDay: -1, // unlimited
      maxImageAnalysisPerDay: -1, // unlimited
    };
  }

  // Free tier
  return {
    useAdvancedModel: false,
    screenshotAnalysis: false,
    scamDetection: false,
    emergencyFeatures: false,
    quickActions: false,
    familyPortal: false,
    maxMessagesPerDay: 50,
    maxImageAnalysisPerDay: 0,
  };
}

/**
 * Emergency contact information
 */
export interface EmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phoneNumber: string;
  isPrimary: boolean;
}

/**
 * Quick action shortcut
 */
export interface QuickAction {
  id: string;
  title: string;
  voiceCommand: string;
  steps: string[];
  category: 'call' | 'settings' | 'apps' | 'custom';
  icon: string;
  usageCount: number;
}
