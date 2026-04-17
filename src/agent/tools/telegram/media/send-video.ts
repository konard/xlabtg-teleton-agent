import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { validateReadPath, WorkspaceSecurityError } from "../../../../workspace/index.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

interface SendVideoParams {
  chatId: string;
  videoPath: string;
  caption?: string;
  replyToId?: number;
  duration?: number;
  width?: number;
  height?: number;
}

export const telegramSendVideoTool: Tool = {
  name: "telegram_send_video",
  description:
    "Deliver a video from a local file path to a chat. Supports common Telegram video formats such as MP4. Optional caption, replyToId, duration, width, and height are supported.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID to send the video to",
    }),
    videoPath: Type.String({
      description:
        "Local file path to the video (e.g., '/path/to/video.mp4'). Must be accessible from the filesystem.",
    }),
    caption: Type.Optional(
      Type.String({
        description: "Optional caption/text to accompany the video",
      })
    ),
    replyToId: Type.Optional(
      Type.Number({
        description: "Optional message ID to reply to",
      })
    ),
    duration: Type.Optional(
      Type.Number({
        description: "Optional video duration in seconds",
      })
    ),
    width: Type.Optional(
      Type.Number({
        description: "Optional video width in pixels",
      })
    ),
    height: Type.Optional(
      Type.Number({
        description: "Optional video height in pixels",
      })
    ),
  }),
};

export const telegramSendVideoExecutor: ToolExecutor<SendVideoParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, videoPath, caption, replyToId, duration, width, height } = params;

    let validatedPath;
    try {
      validatedPath = validateReadPath(videoPath);
    } catch (error) {
      if (error instanceof WorkspaceSecurityError) {
        return {
          success: false,
          error: `Security Error: ${error.message}. Videos must be in your workspace (downloads/ or uploads/).`,
        };
      }
      throw error;
    }

    const gramJsClient = context.bridge.getClient().getClient();
    const result = await gramJsClient.sendFile(chatId, {
      file: validatedPath.absolutePath,
      caption,
      replyTo: replyToId,
      forceDocument: false,
      attributes: [
        new Api.DocumentAttributeVideo({
          roundMessage: false,
          supportsStreaming: true,
          duration: duration ?? 0,
          w: width ?? 0,
          h: height ?? 0,
        }),
      ],
    });

    return {
      success: true,
      data: {
        messageId: result.id,
        date: result.date,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error sending video");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
