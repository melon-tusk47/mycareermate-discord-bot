import "dotenv/config";
import express from "express";
import {
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from "discord-interactions";
import { PrismaClient } from "@prisma/client";
import { Resend } from "resend";

// Create an express app
const app = express();
// Get port, or default to 3000
const PORT = process.env.PORT || 3000;

// Prisma client
const prisma = new PrismaClient();
// Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

// Allowed channel for resume review command
const RESUME_REVIEW_CHANNEL_ID = process.env.RESUME_REVIEW_CHANNEL_ID;
// How many reviews a user can request
const MAX_RESUME_REVIEWS_PER_USER = 1;

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

async function sendHelloWorldEmail(toEmail) {
  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set.");
    return false;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: "MyCareerMate <info@mycareermate.io>",
      to: [toEmail],
      subject: "hello world from MyCareerMate",
      text: "hello world",
    });

    if (error) {
      console.error("Error sending email with Resend:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Exception while sending email with Resend:", err);
    return false;
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

        // Check per-user review limit
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

        // Send hello world email
        const emailSent = await sendHelloWorldEmail(email);
        if (!emailSent) {
          return sendEphemeralText(
            res,
            "❌ We couldn't send an email to your address. Please try again later."
          );
        }

        // Store or update user data
        try {
          if (!user) {
            await prisma.user.create({
              data: {
                discordId,
                email,
                username,
                resumeReviewCount: 1,
                lastResumeReviewAt: new Date(),
              },
            });
          } else {
            await prisma.user.update({
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
            "⚠️ Your email was sent, but we couldn't record your resume review status. You may be able to retry later."
          );
        }

        // Process the resume (for now, just respond with info)
        const filename = attachment.filename;

        return sendEphemeralText(
          res,
          `✅ Resume review request received!\n\n📄 **File:** ${filename}\n📧 **Email:** ${email}\n\n🎉 We've just sent a "hello world" test email to your inbox via MyCareerMate.`
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
