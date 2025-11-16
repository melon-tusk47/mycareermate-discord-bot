import "dotenv/config";
import { InstallGlobalCommands } from "./utils.js";

const RESUME_REVIEW_COMMAND = {
  name: "resume-review",
  description: "Upload your resume for review",
  options: [
    {
      type: 11,
      name: "resume",
      description: "Upload your resume (PDF only, max 2MB)",
      required: true,
    },
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const ALL_COMMANDS = [RESUME_REVIEW_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
