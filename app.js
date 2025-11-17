import "dotenv/config";
import express from "express";
import {
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from "discord-interactions";
import prismaPkg from "@prisma/client";
import { DiscordRequest } from "./utils.js";

// Create an express app
const app = express();
// Get port, or default to 3000
const PORT = process.env.PORT || 3000;

// Prisma client
const { PrismaClient } = prismaPkg;
const prisma = new PrismaClient();

// Allowed channel for resume review command
const RESUME_REVIEW_CHANNEL_ID = process.env.RESUME_REVIEW_CHANNEL_ID;
// How many reviews a user can request
const MAX_RESUME_REVIEWS_PER_USER = 1;
// Channel to notify when a new resume review request is queued
const RESUME_REVIEW_ALERT_CHANNEL_ID =
  process.env.RESUME_REVIEW_ALERT_CHANNEL_ID ||
  "1439472549250465815";

function sendEphemeralText(res, content) {
  return res.send({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      flags:
        InteractionResponseFlags.EPHEMERAL |
        InteractionResponseFlags.IS_COMPONENTS_V2,
      components: [
        {
          type: MessageComponentTypes.TEXT_DISPLAY,
          content,
        },
      ],
    },
  });
}

async function notifyNewResumeReviewQueued({
  discordId,
  email,
  filename,
}) {
  if (!RESUME_REVIEW_ALERT_CHANNEL_ID) {
    return;
  }

  const contentLines = [];
  contentLines.push("📥 New resume review request queued.");
  contentLines.push("");
  if (discordId) {
    contentLines.push(`From: <@${discordId}>`);
  }
  if (email) {
    contentLines.push(`Email: ${email}`);
  }
  if (filename) {
    contentLines.push(`File: ${filename}`);
  }
  contentLines.push("");
  contentLines.push(
    "Bhai bc resume review worker chalana padega maa ki aankh."
  );

  try {
    await DiscordRequest(
      `channels/${RESUME_REVIEW_ALERT_CHANNEL_ID}/messages`,
      {
        method: "POST",
        body: {
          content: contentLines.join("\n"),
        },
      }
    );
  } catch (error) {
    console.error(
      "Failed to send resume review alert message:",
      error
    );
  }
}

/**
 * Interactions endpoint URL where Discord will send HTTP requests
 * Parse request body and verifies incoming requests using discord-interactions package
 */
app.post(
  "/interactions",
  verifyKeyMiddleware(process.env.PUBLIC_KEY),
  async function (req, res) {
    // Interaction type and data
    const { type, id, data, channel_id } = req.body;

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
      const { name, options } = data;

      if (name === "resume-review") {
        // Restrict to a specific channel if configured
        if (
          RESUME_REVIEW_CHANNEL_ID &&
          channel_id !== RESUME_REVIEW_CHANNEL_ID
        ) {
          return sendEphemeralText(
            res,
            "❌ Please use this command in the MyCareerMate Platform #resume-review channel:\nhttps://discord.com/channels/1439456602334691361/1439494111596908575"
          );
        }

        // Get user info from interaction
        const context = req.body.context;
        const userObj = context === 0 ? req.body.member?.user : req.body.user;
        const discordId = userObj?.id;
        const username =
          userObj?.global_name || userObj?.username || "Unknown User";

        if (!discordId) {
          return sendEphemeralText(
            res,
            "❌ Unable to identify your Discord user. Please try again."
          );
        }

        // Check per-user review limit before doing any heavy validation
        let user;
        try {
          user = await prisma.user.findUnique({
            where: { discordId },
          });

          if (
            user &&
            user.resumeReviewCount >= MAX_RESUME_REVIEWS_PER_USER
          ) {
            return sendEphemeralText(
              res,
              "❌ You have already requested a resume review. For now, it's limited to one review per user."
            );
          }
        } catch (error) {
          console.error("Error checking resume review user data:", error);
          return sendEphemeralText(
            res,
            "❌ Something went wrong while checking your resume review status. Please try again later."
          );
        }

        const attachmentOption = options?.find(
          (opt) => opt.name === "resume"
        );
        const attachmentId = attachmentOption?.value;
        const attachment = data.resolved?.attachments?.[attachmentId];

        if (!attachment) {
          return sendEphemeralText(
            res,
            "❌ No attachment found. Please upload a PDF file."
          );
        }

        const isPDF =
          attachment.content_type === "application/pdf" ||
          attachment.filename.toLowerCase().endsWith(".pdf");

        if (!isPDF) {
          return sendEphemeralText(
            res,
            `❌ Invalid file type. Please upload a PDF file.\n\nReceived: ${attachment.filename} (${attachment.content_type})`
          );
        }

        const maxSize = 2 * 1024 * 1024;
        if (attachment.size > maxSize) {
          const sizeMB = (attachment.size / (1024 * 1024)).toFixed(2);
          return sendEphemeralText(
            res,
            `❌ File too large. Maximum size is 2MB.\n\nYour file: ${attachment.filename} (${sizeMB}MB)`
          );
        }

        const emailOption = options?.find((opt) => opt.name === "email");
        const email = emailOption?.value?.trim();

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
          return sendEphemeralText(
            res,
            `❌ Invalid email address: "${email}"\n\nPlease use the command again with a valid email.`
          );
        }

        // Store or update user data and enqueue a resume review request
        try {
          if (!user) {
            user = await prisma.user.create({
              data: {
                discordId,
                email,
                username,
                resumeReviewCount: 1,
                lastResumeReviewAt: new Date(),
              },
            });
          } else {
            user = await prisma.user.update({
              where: { id: user.id },
              data: {
                email,
                username,
                resumeReviewCount: { increment: 1 },
                lastResumeReviewAt: new Date(),
              },
            });
          }
        } catch (error) {
          console.error("Error saving resume review user data:", error);
          return sendEphemeralText(
            res,
            "⚠️ We couldn't record your resume review status. Please try again later."
          );
        }

        // Enqueue resume review request in the database.
        // The heavy lifting (downloading, parsing, LLM analysis, and email sending)
        // is handled asynchronously by a separate background process.
        try {
          await prisma.resumeReviewRequest.create({
            data: {
              email,
              discordId,
              discordUsername: username,
              attachmentUrl: attachment.url,
              attachmentFilename: attachment.filename,
              attachmentContentType: attachment.content_type,
              attachmentSizeBytes: attachment.size,
              status: "QUEUED",
              userId: user?.id || null,
            },
          });
          // Fire-and-forget notification to the alert channel so you
          // know when to run the background worker manually.
          notifyNewResumeReviewQueued({
            discordId,
            email,
            filename: attachment.filename,
          }).catch((error) => {
            console.error(
              "Failed to send resume review queued notification:",
              error
            );
          });
        } catch (error) {
          console.error(
            "Error creating resume review request record:",
            error
          );
          return sendEphemeralText(
            res,
            "❌ We couldn't queue your resume review request. Please try again later."
          );
        }

        return sendEphemeralText(
          res,
          `✅ Thanks, your resume review request has been queued!\n\n📄 **File:** ${attachment.filename}\n📧 **Email:** ${email}\n\n🕒 You'll receive a detailed review at this email address once it's ready.`
        );
      }

      console.error(`unknown command: ${name}`);
      return res.status(400).json({ error: "unknown command" });
    }

    console.error("unknown interaction type", type);
    return res.status(400).json({ error: "unknown interaction type" });
  }
);

app.listen(PORT, () => {
  console.log("Listening on port", PORT);
});
