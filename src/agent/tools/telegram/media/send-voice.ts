/**
 * telegram_send_voice - Send voice messages with optional TTS
 *
 * Two modes:
 * 1. voicePath: Send existing audio file
 * 2. text: Generate speech using TTS, then send
 */

import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import { unlinkSync } from "fs";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import {
  generateSpeech,
  EDGE_VOICES,
  PIPER_VOICES,
  type TTSProvider,
} from "../../../../services/tts.js";
import { GROQ_TTS_VOICES } from "../../../../providers/groq/GroqTTSProvider.js";
import { validateReadPath, WorkspaceSecurityError } from "../../../../workspace/index.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

interface SendVoiceParams {
  chatId: string;
  voicePath?: string;
  text?: string;
  voice?: string;
  ttsProvider?: TTSProvider;
  rate?: string;
  duration?: number;
  waveform?: number[];
  caption?: string;
  replyToId?: number;
}

export const telegramSendVoiceTool: Tool = {
  name: "telegram_send_voice",
  description:
    "Send a voice message. Either provide voicePath for an existing file, or text for TTS generation. Uses the configured TTS provider and voice from settings. Available providers: piper, edge, openai, elevenlabs, groq.",

  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID to send the voice message to",
    }),
    voicePath: Type.Optional(
      Type.String({
        description: "Local file path to voice/audio file (OGG, MP3). Use this OR text.",
      })
    ),
    text: Type.Optional(
      Type.String({
        description: "Text to convert to speech using TTS. Use this OR voicePath.",
      })
    ),
    voice: Type.Optional(
      Type.String({
        description:
          "TTS voice override. If omitted, uses the voice configured in settings. For Edge TTS: 'en-us-male', 'fr-fr-female', etc. For Groq: 'autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy'.",
      })
    ),
    ttsProvider: Type.Optional(
      Type.String({
        description:
          "TTS provider override (uses configured default if omitted): 'piper', 'edge', 'openai', 'elevenlabs', or 'groq'",
        enum: ["piper", "edge", "openai", "elevenlabs", "groq"],
      })
    ),
    rate: Type.Optional(
      Type.String({
        description: "Speech rate adjustment (e.g., '+20%' faster, '-10%' slower). Edge TTS only.",
      })
    ),
    duration: Type.Optional(
      Type.Number({
        description: "Duration in seconds (optional, auto-detected)",
      })
    ),
    waveform: Type.Optional(
      Type.Array(Type.Number(), {
        description: "Voice waveform visualization data (optional)",
      })
    ),
    caption: Type.Optional(
      Type.String({
        description: "Optional caption/text to accompany the voice message",
      })
    ),
    replyToId: Type.Optional(
      Type.Number({
        description: "Optional message ID to reply to",
      })
    ),
  }),
};

export const telegramSendVoiceExecutor: ToolExecutor<SendVoiceParams> = async (
  params,
  context
): Promise<ToolResult> => {
  let generatedFile: string | null = null;

  try {
    const {
      chatId,
      voicePath,
      text,
      voice,
      ttsProvider,
      rate,
      duration,
      waveform,
      caption,
      replyToId,
    } = params;

    // Validate: need either voicePath or text
    if (!voicePath && !text) {
      return {
        success: false,
        error: "Must provide either 'voicePath' (audio file) or 'text' (for TTS)",
      };
    }

    let audioPath = voicePath;
    let usedVoice = voice;
    let usedProvider = ttsProvider;

    // Validate voicePath if provided (before TTS)
    if (voicePath) {
      try {
        const validatedPath = validateReadPath(voicePath);
        audioPath = validatedPath.absolutePath;
      } catch (error) {
        if (error instanceof WorkspaceSecurityError) {
          return {
            success: false,
            error: `Security Error: ${error.message}. Voice files must be in your workspace (downloads/ or uploads/).`,
          };
        }
        throw error;
      }
    }

    // TTS mode: generate speech from text
    if (text && !voicePath) {
      // Determine effective provider: use groq if configured and no explicit provider given
      const groqConfig = context.config?.groq;
      const groqApiKey =
        groqConfig?.api_key ??
        (context.config?.agent.provider === "groq" ? context.config?.agent.api_key : undefined);

      const provider: TTSProvider = (ttsProvider as TTSProvider) ?? (groqApiKey ? "groq" : "piper");

      // Resolve voice: for Groq, the configured tts_voice always takes priority over
      // any caller-supplied voice to ensure user settings are respected.
      let resolvedVoice: string | undefined;

      if (provider === "groq" && groqConfig?.tts_voice) {
        // Config voice wins for Groq — ensures user's voice setting is always honored
        resolvedVoice = groqConfig.tts_voice;
      } else if (voice) {
        if (provider === "groq") {
          // No config voice set — use caller-supplied voice (case-insensitive match)
          const groqVoiceMatch = (GROQ_TTS_VOICES as readonly string[]).find(
            (v) => v.toLowerCase() === voice.toLowerCase()
          );
          resolvedVoice = groqVoiceMatch ?? voice;
        } else if (provider === "piper" && voice.toLowerCase() in PIPER_VOICES) {
          resolvedVoice = voice.toLowerCase();
        } else if (voice in EDGE_VOICES) {
          resolvedVoice = EDGE_VOICES[voice as keyof typeof EDGE_VOICES];
        } else {
          resolvedVoice = voice;
        }
      }

      const ttsResult = await generateSpeech({
        text,
        provider,
        voice: resolvedVoice,
        rate,
        groqApiKey: provider === "groq" ? groqApiKey : undefined,
        groqModel: provider === "groq" ? groqConfig?.tts_model : undefined,
        groqFormat: provider === "groq" ? groqConfig?.tts_format : undefined,
      });

      audioPath = ttsResult.filePath;
      generatedFile = audioPath; // Mark for cleanup
      usedVoice = ttsResult.voice;
      usedProvider = ttsResult.provider;
    }

    if (!audioPath) {
      return {
        success: false,
        error: "No audio file available",
      };
    }

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Send voice message using GramJS sendFile with voice attributes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GramJS API response is untyped
    const attrs: any = {
      voice: true,
    };
    if (duration !== undefined) attrs.duration = duration;
    if (waveform) attrs.waveform = Buffer.from(waveform);

    const result = await gramJsClient.sendFile(chatId, {
      file: audioPath,
      caption: caption,
      replyTo: replyToId,
      forceDocument: false,
      voiceNote: true,
      attributes: [new Api.DocumentAttributeAudio(attrs)],
    });

    // Build response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GramJS API response is untyped
    const responseData: any = {
      messageId: result.id,
      date: result.date,
    };

    if (text) {
      responseData.tts = true;
      responseData.provider = usedProvider;
      responseData.voice = usedVoice;
      responseData.textLength = text.length;
      responseData.message = `🎙️ Voice message sent (TTS: ${usedProvider})`;
    } else {
      responseData.message = `🎙️ Voice message sent`;
    }

    return {
      success: true,
      data: responseData,
    };
  } catch (error) {
    log.error({ err: error }, "Error sending voice message");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  } finally {
    // Cleanup generated TTS file
    if (generatedFile) {
      try {
        unlinkSync(generatedFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
};
