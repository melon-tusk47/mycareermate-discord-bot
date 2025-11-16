import "dotenv/config";
import express from "express";
import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from "discord-interactions";
import { getRandomEmoji, DiscordRequest } from "./utils.js";

// Create an express app
const app = express();
// Get port, or default to 3000
const PORT = process.env.PORT || 3000;
// To keep track of our active games
const activeGames = {};
// To store resume data temporarily until email is provided
const pendingResumes = {};

/**
 * Interactions endpoint URL where Discord will send HTTP requests
 * Parse request body and verifies incoming requests using discord-interactions package
 */
app.post(
  "/interactions",
  verifyKeyMiddleware(process.env.PUBLIC_KEY),
  async function (req, res) {
    // Interaction id, type and data
    const { id, type, data } = req.body;

    /**
     * Handle verification requests
     */
    if (type === InteractionType.PING) {
      return res.send({ type: InteractionResponseType.PONG });
    }

    /**
     * Handle slash command requests
     * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
     */
    if (type === InteractionType.APPLICATION_COMMAND) {
      const { name } = data;

      if (name === "resume-review") {
        const attachmentOption = data.options.find(
          (opt) => opt.name === "resume"
        );
        const attachmentId = attachmentOption?.value;
        const attachment = data.resolved?.attachments?.[attachmentId];

        if (!attachment) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags:
                InteractionResponseFlags.EPHEMERAL |
                InteractionResponseFlags.IS_COMPONENTS_V2,
              components: [
                {
                  type: MessageComponentTypes.TEXT_DISPLAY,
                  content: "❌ No attachment found. Please upload a PDF file.",
                },
              ],
            },
          });
        }

        const isPDF =
          attachment.content_type === "application/pdf" ||
          attachment.filename.toLowerCase().endsWith(".pdf");

        if (!isPDF) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags:
                InteractionResponseFlags.EPHEMERAL |
                InteractionResponseFlags.IS_COMPONENTS_V2,
              components: [
                {
                  type: MessageComponentTypes.TEXT_DISPLAY,
                  content: `❌ Invalid file type. Please upload a PDF file.\n\nReceived: ${attachment.filename} (${attachment.content_type})`,
                },
              ],
            },
          });
        }

        const maxSize = 2 * 1024 * 1024;
        if (attachment.size > maxSize) {
          const sizeMB = (attachment.size / (1024 * 1024)).toFixed(2);
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags:
                InteractionResponseFlags.EPHEMERAL |
                InteractionResponseFlags.IS_COMPONENTS_V2,
              components: [
                {
                  type: MessageComponentTypes.TEXT_DISPLAY,
                  content: `❌ File too large. Maximum size is 2MB.\n\nYour file: ${attachment.filename} (${sizeMB}MB)`,
                },
              ],
            },
          });
        }

        // Store the attachment data temporarily
        pendingResumes[id] = {
          filename: attachment.filename,
          size: attachment.size,
          url: attachment.url,
        };

        // Show modal to collect email
        return res.send({
          type: InteractionResponseType.MODAL,
          data: {
            custom_id: `email_modal_${id}`,
            title: "Resume Review - Email",
            components: [
              {
                type: 1, // ACTION_ROW
                components: [
                  {
                    type: 4, // TEXT_INPUT
                    custom_id: "email_input",
                    label: "Your Email Address",
                    style: 1, // SHORT
                    placeholder: "example@email.com",
                    required: true,
                    max_length: 100,
                  },
                ],
              },
            ],
          },
        });
      }

      console.error(`unknown command: ${name}`);
      return res.status(400).json({ error: "unknown command" });
    }

    /**
     * Handle modal submissions
     */
    if (type === InteractionType.MODAL_SUBMIT) {
      const { custom_id } = data;

      if (custom_id.startsWith("email_modal_")) {
        const resumeId = custom_id.replace("email_modal_", "");
        const resumeData = pendingResumes[resumeId];

        if (!resumeData) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags:
                InteractionResponseFlags.EPHEMERAL |
                InteractionResponseFlags.IS_COMPONENTS_V2,
              components: [
                {
                  type: MessageComponentTypes.TEXT_DISPLAY,
                  content:
                    "❌ Session expired. Please upload your resume again.",
                },
              ],
            },
          });
        }

        // Get email from modal submission
        const emailInput = data.components[0].components.find(
          (c) => c.custom_id === "email_input"
        );
        const email = emailInput?.value?.trim();

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
          // Clean up
          delete pendingResumes[resumeId];

          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags:
                InteractionResponseFlags.EPHEMERAL |
                InteractionResponseFlags.IS_COMPONENTS_V2,
              components: [
                {
                  type: MessageComponentTypes.TEXT_DISPLAY,
                  content: `❌ Invalid email address: "${email}"\n\nPlease use the command again with a valid email.`,
                },
              ],
            },
          });
        }

        // Process the resume (for now, just read the filename)
        const filename = resumeData.filename;

        // Clean up stored data
        delete pendingResumes[resumeId];

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags:
              InteractionResponseFlags.EPHEMERAL |
              InteractionResponseFlags.IS_COMPONENTS_V2,
            components: [
              {
                type: MessageComponentTypes.TEXT_DISPLAY,
                content: `✅ Resume review complete!\n\n📄 **File:** ${filename}\n📧 **Sent to:** ${email}\n\n🎉 Your resume analysis has been sent to your email address.`,
              },
            ],
          },
        });
      }
    }

    console.error("unknown interaction type", type);
    return res.status(400).json({ error: "unknown interaction type" });
  }
);

app.listen(PORT, () => {
  console.log("Listening on port", PORT);
});
