/**
 * NoraAI REST API Server
 *
 * Handles:
 * - OpenAI API integration (voice chat, scam detection)
 * - Complex AI processing
 * - Step-by-step instruction generation
 * - Device-specific help
 */

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { OpenAI } from "openai";
import multer from "multer";
import fs from "fs";
import { UserTier, getTierFeatures, UserContext } from "./types";
import { checkUsageQuota, addUsageStats } from "./middleware/usageTracking";

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// OpenAI model configurable via env var
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-3.5-turbo";

// Initialize OpenAI client
// If no API key is provided, allow a development mock so the app can be tested without secrets.
const isDev = (process.env.NODE_ENV || "development") === "development";
let openai: any;

if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} else if (isDev) {
  console.warn(
    "OPENAI_API_KEY is not set — using a development mock for OpenAI. Do NOT use this in production."
  );

  // Minimal mock implementing the shape used in this file
  openai = {
    chat: {
      completions: {
        create: async (opts: any) => {
          const userMessage =
            (opts?.messages || []).slice(-1)[0]?.content || "";
          // Simple canned response — keep it short and safe for UI testing
          const reply = `MockResponse: I heard "${String(userMessage).slice(
            0,
            120
          )}" — here is a friendly demo reply explaining steps.`;
          return {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: reply,
                },
              },
            ],
          };
        },
      },
    },
  };
} else {
  console.error(
    "OPENAI_API_KEY is not set. Please set it in your environment (.env) and do NOT commit secrets to source control."
  );
  console.error(
    "If you pasted an API key into a chat or repo, rotate it now via https://platform.openai.com/account/api-keys"
  );
  // Instantiate client anyway to fail fast with clearer error from the library
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Multer configuration for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

// Middleware
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
  })
);
app.use(express.json());

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * POST /api/chat
 * Main chat endpoint - sends message to OpenAI
 */
app.post("/api/chat", checkUsageQuota('text'), addUsageStats, async (req: Request, res: Response) => {
  try {
    const { message, history, userContext } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Get user tier and features
    const tier: UserTier = userContext?.tier || 'free';
    const features = getTierFeatures(tier);

    // Select model based on tier
    const model = features.useAdvancedModel ? "gpt-4" : "gpt-3.5-turbo";

    // Build conversation history for OpenAI
    const messages = [
      {
        role: "system" as const,
        content: getSystemPrompt(userContext),
      },
      ...(history || []),
      {
        role: "user" as const,
        content: message,
      },
    ];

    // Call OpenAI with tier-appropriate model
    const completion = await openai.chat.completions.create({
      model: model,
      messages: messages,
      temperature: 0.8, // More natural and conversational
      max_tokens: 150,  // Keep responses SHORT (2-3 sentences)
    });

    const aiResponse =
      completion.choices[0]?.message?.content ||
      "I'm having trouble understanding. Could you try again?";

    // Analyze response for special cases
    const analysis = analyzeResponse(aiResponse);

    res.json({
      response: aiResponse,
      needsSteps: analysis.needsSteps,
      containsWarning: analysis.containsWarning,
      severity: analysis.severity,
    });
  } catch (error) {
    // Handle common OpenAI errors (rate limits, service unavailable)
    console.error("Error in chat endpoint:", (error as any)?.message || error);
    const status = (error as any)?.status || (error as any)?.response?.status;
    if (status === 429) {
      const retryAfter =
        (error as any)?.headers?.["retry-after"] ||
        (error as any)?.response?.headers?.["retry-after"];
      res.setHeader("Retry-After", retryAfter || "30");
      return res.status(503).json({
        error: "OpenAI rate limit exceeded. Please retry after a short pause.",
      });
    }

    res.status(500).json({
      error:
        "Sorry, I'm having trouble right now. Please try again in a moment.",
    });
  }
});

/**
 * POST /api/transcribe-voice
 * Transcribes audio using OpenAI Whisper API and processes it through chat
 */
app.post("/api/transcribe-voice", upload.single('audio'), checkUsageQuota('voice'), addUsageStats, async (req: Request, res: Response) => {
  let uploadedFilePath: string | undefined;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "Audio file is required" });
    }

    uploadedFilePath = req.file.path;
    const { history, userContext } = req.body;

    // Parse JSON strings if they were sent as strings
    const parsedHistory = typeof history === 'string' ? JSON.parse(history) : history;
    const parsedUserContext = typeof userContext === 'string' ? JSON.parse(userContext) : userContext;

    // Log file details for debugging
    const fileStats = fs.statSync(uploadedFilePath);
    console.log(`Audio file uploaded: ${uploadedFilePath}`);
    console.log(`File size: ${fileStats.size} bytes`);
    console.log(`Original filename: ${req.file.originalname}`);
    console.log(`MIME type: ${req.file.mimetype}`);

    // Check if file has content
    if (fileStats.size === 0) {
      throw new Error('Uploaded audio file is empty');
    }

    // Transcribe audio using Whisper with proper file handling
    // Read file as buffer and create a proper File object
    console.log('Calling OpenAI Whisper API...');
    const fileBuffer = fs.readFileSync(uploadedFilePath);
    const file = new File([fileBuffer], req.file.originalname || 'audio.m4a', {
      type: req.file.mimetype || 'audio/m4a',
    });

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: "whisper-1",
      language: "en",
    });
    console.log('Transcription successful:', transcription.text);

    const userMessage = transcription.text;

    // Get user tier and features
    const tier: UserTier = parsedUserContext?.tier || 'free';
    const features = getTierFeatures(tier);

    // Select model based on tier
    const model = features.useAdvancedModel ? "gpt-4" : "gpt-3.5-turbo";

    // Build conversation history for OpenAI
    const messages = [
      {
        role: "system" as const,
        content: getSystemPrompt(parsedUserContext),
      },
      ...(parsedHistory || []),
      {
        role: "user" as const,
        content: userMessage,
      },
    ];

    // Call OpenAI for chat response with tier-appropriate model
    const completion = await openai.chat.completions.create({
      model: model,
      messages: messages,
      temperature: 0.8, // More natural and conversational
      max_tokens: 150,  // Keep responses SHORT (2-3 sentences)
    });

    const aiResponse =
      completion.choices[0]?.message?.content ||
      "I'm having trouble understanding. Could you try again?";

    // Analyze response for special cases
    const analysis = analyzeResponse(aiResponse);

    // Clean up uploaded file
    fs.unlinkSync(uploadedFilePath);

    res.json({
      transcription: userMessage,
      response: aiResponse,
      needsSteps: analysis.needsSteps,
      containsWarning: analysis.containsWarning,
      severity: analysis.severity,
    });
  } catch (error) {
    // Clean up uploaded file if it exists
    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      fs.unlinkSync(uploadedFilePath);
    }

    console.error("Error in voice endpoint:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    const status = (error as any)?.status || (error as any)?.response?.status;
    if (status === 429) {
      res.setHeader("Retry-After", "30");
      return res.status(503).json({
        error: "OpenAI rate limit exceeded. Please retry after a short pause.",
      });
    }

    res.status(500).json({
      error:
        "Sorry, I'm having trouble right now. Please try again in a moment.",
    });
  }
});

/**
 * POST /api/analyze-screenshot
 * Analyzes screenshot to help user understand what to do next (PREMIUM FEATURE)
 */
app.post("/api/analyze-screenshot", upload.single('image'), checkUsageQuota('screenshot'), addUsageStats, async (req: Request, res: Response) => {
  let uploadedFilePath: string | undefined;

  try {
    const { userContext, question } = req.body;

    // Parse user context
    const parsedUserContext: UserContext = typeof userContext === 'string' ? JSON.parse(userContext) : userContext;
    const tier: UserTier = parsedUserContext?.tier || 'free';
    const features = getTierFeatures(tier);

    // Check if user has access to this feature
    if (!features.screenshotAnalysis) {
      return res.status(403).json({
        error: "Screenshot analysis is a premium feature. Please upgrade to access this feature.",
        requiresPremium: true,
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Screenshot image is required" });
    }

    uploadedFilePath = req.file.path;

    // Convert image to base64
    const imageBuffer = fs.readFileSync(uploadedFilePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    console.log(`Analyzing screenshot (${req.file.size} bytes) for user question: "${question}"`);

    // Use GPT-4 Vision to analyze the screenshot
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // Updated from deprecated gpt-4-vision-preview
      messages: [
        {
          role: "system",
          content: `You are Nora, helping an elderly person understand their phone screen.

IMPORTANT:
- Describe what you see in SIMPLE terms
- Give ONE clear action they should take next
- Be specific: "Tap the blue button that says 'Connect' in the middle of the screen"
- Keep response to 2-3 sentences maximum
- Speak warmly and encouragingly`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: question || "I'm stuck. What should I do next?",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0.7,
    });

    const analysis = response.choices[0]?.message?.content || "I'm having trouble seeing your screen. Could you try taking another photo?";

    // Clean up uploaded file
    fs.unlinkSync(uploadedFilePath);

    res.json({
      analysis: analysis,
      feature: 'screenshot-analysis',
    });
  } catch (error) {
    // Clean up uploaded file if it exists
    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      fs.unlinkSync(uploadedFilePath);
    }

    console.error("Error in screenshot analysis:", error);
    res.status(500).json({
      error: "Sorry, I had trouble analyzing your screenshot. Please try again.",
    });
  }
});

/**
 * POST /api/analyze-scam
 * Analyzes photo of suspicious message/email for scam detection (PREMIUM FEATURE)
 */
app.post("/api/analyze-scam", upload.single('image'), checkUsageQuota('scam'), addUsageStats, async (req: Request, res: Response) => {
  let uploadedFilePath: string | undefined;

  try {
    const { userContext } = req.body;

    // Parse user context
    const parsedUserContext: UserContext = typeof userContext === 'string' ? JSON.parse(userContext) : userContext;
    const tier: UserTier = parsedUserContext?.tier || 'free';
    const features = getTierFeatures(tier);

    // Check if user has access to this feature
    if (!features.scamDetection) {
      return res.status(403).json({
        error: "Scam detection is a premium feature. Please upgrade to access this feature.",
        requiresPremium: true,
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Image is required" });
    }

    uploadedFilePath = req.file.path;

    // Convert image to base64
    const imageBuffer = fs.readFileSync(uploadedFilePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    console.log(`Analyzing potential scam (${req.file.size} bytes)`);

    // Use GPT-4 Vision to analyze for scams
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // Updated from deprecated gpt-4-vision-preview
      messages: [
        {
          role: "system",
          content: `You are a security expert helping elderly people identify scams.

Analyze the message/email in the image and determine:
1. Is this SAFE, SUSPICIOUS, or DANGEROUS?
2. What are the red flags?
3. What should they do?

IMPORTANT:
- Be clear and direct
- Use simple language
- If it's a scam, say so firmly but calmly
- Give ONE specific action to take
- Keep response SHORT (3-4 sentences)`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Is this message safe? Should I be worried?",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 250,
      temperature: 0.5, // Lower temperature for consistent safety analysis
    });

    const analysis = response.choices[0]?.message?.content || "I couldn't analyze this image. Please try again.";

    // Determine severity from response
    const isSafe = /safe|legitimate|okay|fine/i.test(analysis);
    const isDangerous = /scam|fraud|dangerous|don't|never|warning/i.test(analysis);

    const severity = isSafe ? 'info' : (isDangerous ? 'danger' : 'warning');

    // Clean up uploaded file
    fs.unlinkSync(uploadedFilePath);

    res.json({
      analysis: analysis,
      severity: severity,
      isSafe: isSafe,
      isDangerous: isDangerous,
      feature: 'scam-detection',
    });
  } catch (error) {
    // Clean up uploaded file if it exists
    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      fs.unlinkSync(uploadedFilePath);
    }

    console.error("Error in scam analysis:", error);
    res.status(500).json({
      error: "Sorry, I had trouble analyzing this image. Please try again.",
    });
  }
});

/**
 * POST /api/analyze-safety
 * Analyzes message/call/email for scam detection
 */
app.post("/api/analyze-safety", async (req: Request, res: Response) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: "Content is required" });
    }

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: getScamDetectionPrompt(),
        },
        {
          role: "user",
          content: `Please analyze this for safety concerns: ${content}`,
        },
      ],
      temperature: 0.3,
    });

    const analysis = completion.choices[0]?.message?.content || "";

    res.json({
      analysis,
      isSafe: !analysis.toLowerCase().includes("warning"),
      severity: determineSeverity(analysis),
    });
  } catch (error) {
    console.error(
      "Error in safety analysis:",
      (error as any)?.message || error
    );
    const status = (error as any)?.status || (error as any)?.response?.status;
    if (status === 429) {
      res.setHeader("Retry-After", "30");
      return res.status(503).json({
        error: "OpenAI rate limit exceeded. Please retry after a short pause.",
      });
    }
    res.status(500).json({ error: "Failed to analyze safety" });
  }
});

/**
 * Generate system prompt for elder-friendly responses
 */
function getSystemPrompt(userContext?: any): string {
  const deviceInfo = userContext?.deviceType ? ` Device: ${userContext.deviceType}.` : '';

  // Optimized prompt - reduced from ~370 tokens to ~120 tokens (67% reduction)
  const basePrompt = `You are Nora, a warm tech helper for elderly users.${deviceInfo}

RULES:
- Be conversational and warm, avoid jargon
- Keep responses to 2-3 sentences max
- Give ONE step at a time, never multiple steps
- After each step, ask if it worked
- For device features (WiFi, screenshots), ask device type if unknown
- Be reassuring about scams without lecturing`;

  return basePrompt;
}

/**
 * Generate scam detection system prompt
 */
function getScamDetectionPrompt(): string {
  return `You are a security expert helping elderly people identify potential scams and fraudulent activities.

Analyze the provided content and identify:
- Phishing attempts
- Fake tech support scams
- Urgency tactics ("act now or lose access")
- Requests for personal information
- Suspicious links or phone numbers
- Impersonation of banks, government, or tech companies
- Prize/lottery scams
- Romance scams

Respond with:
1. Clear assessment (SAFE, SUSPICIOUS, or DANGEROUS)
2. Brief explanation in simple terms
3. Specific red flags you identified
4. Simple action to take

Use calm, clear language. Don't frighten them, but be firm about dangers.`;
}

/**
 * Analyze AI response for special cases
 */
function analyzeResponse(response: string) {
  const needsSteps = /\d+\.|step \d+|first,|second,|then,/i.test(response);
  const containsWarning =
    /warning|careful|scam|suspicious|don't|avoid|danger/i.test(response);

  let severity: "info" | "warning" | "danger" = "info";
  if (containsWarning) {
    if (/danger|scam|fraud|steal/i.test(response)) {
      severity = "danger";
    } else {
      severity = "warning";
    }
  }

  return { needsSteps, containsWarning, severity };
}

/**
 * Determine severity of safety analysis
 */
function determineSeverity(analysis: string): "info" | "warning" | "danger" {
  const lower = analysis.toLowerCase();
  if (
    lower.includes("dangerous") ||
    lower.includes("scam") ||
    lower.includes("fraud")
  ) {
    return "danger";
  }
  if (
    lower.includes("suspicious") ||
    lower.includes("warning") ||
    lower.includes("careful")
  ) {
    return "warning";
  }
  return "info";
}

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong" });
});

// Export the Express app for Firebase Functions or local server
export default app;
