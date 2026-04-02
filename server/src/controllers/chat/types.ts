import { Response } from 'express';
import { Intent } from '../../services/intentService';
import { TierSettings } from '../../services/tierService';

/**
 * Shared context object passed between chat modules.
 * Contains all the state needed to process a single chat request.
 */
export interface ChatContext {
  // Request data
  message: string;
  provider: string;
  userId: number | undefined;
  clientNumber: string | undefined;
  conversationId: number | undefined;
  userName: string | undefined;
  isAdmin: boolean;
  userType: string | undefined;

  // SSE response
  res: Response;
  clientDisconnected: boolean;
  startTime: number;
  totalChars: number;
  responseChunks: string[];

  // AI config (from system_config)
  aiConfig: Awaited<ReturnType<typeof import('../../services/aiConfigService').getAIConfig>>;

  // Intent + classification
  intent: Intent;
  tierSettings: TierSettings | null;

  // User profile
  userProfile: any;
  chatHistory: any[];
  memoryBlocks: {
    userMemoryBlock: string;
    aiMemoryBlock: string;
    contextBlock: string;
    aiName: string;
  };
  userLearnings: any[];
  formatHints: string;
}

export interface WidgetClassification {
  widget_type: string | null;
  skip_data: boolean;
  domain: string | null;
}

export interface DataRetrievalResult {
  context: string;
  topScore: number;
  piiMapping: Record<string, string>;
}
