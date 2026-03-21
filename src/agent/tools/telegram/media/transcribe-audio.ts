import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import { groqTranscribe } from "../../../../providers/groq/GroqSTTProvider.js";

const log = createLogger("Tools");

interface TranscribeAudioParams {
  chatId: string;
  messageId: number;
}

export const telegramTranscribeAudioTool: Tool = {
  name: "telegram_transcribe_audio",
  description:
    "Transcribe a voice or audio message to text. Uses Groq Whisper STT when groq.api_key is configured (free tier available). Falls back to Telegram native transcription (requires Telegram Premium) if Groq is not configured. Polls automatically until transcription completes.",
  category: "data-bearing",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID where the voice/audio message is",
    }),
    messageId: Type.Number({
      description: "The message ID of the voice/audio message to transcribe",
    }),
  }),
};

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_RETRIES = 15;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const telegramTranscribeAudioExecutor: ToolExecutor<TranscribeAudioParams> = async (
  params,
  context
): Promise<ToolResult> => {
  const { chatId, messageId } = params;

  // Try Groq Whisper STT first if configured (works without Telegram Premium)
  const groqConfig = context.config?.groq;
  const groqApiKey =
    groqConfig?.api_key ??
    (context.config?.agent.provider === "groq" ? context.config?.agent.api_key : undefined);

  if (groqApiKey) {
    try {
      const gramJsClient = context.bridge.getClient().getClient();
      // Fetch the message to get the audio document
      const messages = await gramJsClient.getMessages(chatId, { ids: [messageId] });
      const msg = messages[0];
      if (msg) {
        const audioBuffer = await gramJsClient.downloadMedia(msg, {});
        if (audioBuffer) {
          const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
          // Detect filename from message media type
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GramJS message is untyped
          const media = (msg as any).media;
          const isVoice =
            media?.document?.attributes?.some(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GramJS attrs are untyped
              (a: any) => a.className === "DocumentAttributeAudio" && a.voice
            ) ?? true;
          const filename = isVoice ? "voice.ogg" : "audio.mp3";
          const result = await groqTranscribe(buf, filename, {
            apiKey: groqApiKey,
            model: groqConfig?.stt_model,
            language: groqConfig?.stt_language,
          });
          log.info(
            `🎤 Groq STT transcribed msg ${messageId}: "${result.text.substring(0, 80)}..."`
          );
          return {
            success: true,
            data: {
              text: result.text,
              pending: false,
              provider: "groq",
              language: result.language,
              duration: result.duration,
            },
          };
        }
      }
    } catch (groqErr) {
      log.warn(
        { err: groqErr },
        `Groq STT failed for msg ${messageId}, falling back to Telegram native`
      );
    }
  }

  // Fall back to Telegram native transcription (requires Telegram Premium)
  try {
    const gramJsClient = context.bridge.getClient().getClient();
    const entity = await gramJsClient.getEntity(chatId);

    let result = await gramJsClient.invoke(
      new Api.messages.TranscribeAudio({
        peer: entity,
        msgId: messageId,
      })
    );

    // Poll if transcription is still pending
    let retries = 0;
    while (result.pending && retries < MAX_POLL_RETRIES) {
      retries++;
      log.debug(`⏳ Transcription pending, polling (${retries}/${MAX_POLL_RETRIES})...`);
      await sleep(POLL_INTERVAL_MS);

      try {
        result = await gramJsClient.invoke(
          new Api.messages.TranscribeAudio({
            peer: entity,
            msgId: messageId,
          })
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GramJS API response is untyped
      } catch (pollError: any) {
        // On transient errors (FLOOD_WAIT, network), keep polling
        log.warn(
          `⚠️ Transcription poll ${retries} failed: ${pollError.errorMessage || pollError.message}`
        );
        continue;
      }
    }

    if (result.pending) {
      log.warn(`Transcription still pending after ${MAX_POLL_RETRIES} retries`);
      return {
        success: true,
        data: {
          transcriptionId: result.transcriptionId?.toString(),
          text: result.text || null,
          pending: true,
          message: "Transcription is still processing. Try again later.",
        },
      };
    }

    log.info(`🎤 transcribe_audio: msg ${messageId} → "${result.text?.substring(0, 50)}..."`);

    return {
      success: true,
      data: {
        transcriptionId: result.transcriptionId?.toString(),
        text: result.text,
        pending: false,
        ...(result.trialRemainsNum !== undefined && {
          trialRemainsNum: result.trialRemainsNum,
          trialRemainsUntilDate: result.trialRemainsUntilDate,
        }),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GramJS API response is untyped
  } catch (error: any) {
    // Handle specific Telegram errors
    if (error.errorMessage === "PREMIUM_ACCOUNT_REQUIRED") {
      return {
        success: false,
        error:
          "Telegram Premium is required to transcribe audio messages. Configure groq.api_key to use Groq Whisper STT instead (free tier available at console.groq.com).",
      };
    }
    if (error.errorMessage === "MSG_ID_INVALID") {
      return {
        success: false,
        error: "Invalid message ID — the message may not exist or is not a voice/audio message.",
      };
    }

    log.error({ err: error }, "Error transcribing audio");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
