import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { stream } from "hono/streaming";  //[we can use express or any other server framework]
import { Octokit } from "@octokit/core";
import {
  createAckEvent,
  createDoneEvent,
  createErrorsEvent,
  createTextEvent,
  getUserMessage,
  prompt,
  verifyAndParseRequest,
} from "@copilot-extensions/preview-sdk";
import { createReferencesEvent } from "@copilot-extensions/preview-sdk";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Welcome to the Copilot Extension template! 👋");
});

app.post("/", async (c) => {
  // Identify the user, using the GitHub API token provided in the request headers.
  const tokenForUser = c.req.header("X-GitHub-Token") ?? "";

  const body = await c.req.text();
  const signature = c.req.header("github-public-key-signature") ?? "";
  const keyID = c.req.header("github-public-key-identifier") ?? "";

  const { isValidRequest, payload } = await verifyAndParseRequest(
    body,
    signature,
    keyID,
    {
      token: tokenForUser,
    }
  );

  if (!isValidRequest) {
    console.error("Request verification failed");
    c.header("Content-Type", "text/plain");
    c.status(401);
    return c.text("Request could not be verified");
  }

  if (!tokenForUser) {
    return c.text(
      createErrorsEvent([
        {
          //[using copilot sdk to create error event in chat]
          type: "agent",
          message: "No GitHub token provided in the request headers.",
          code: "MISSING_GITHUB_TOKEN",
          identifier: "missing_github_token",
        },
      ])
    );
  }

  c.header("Content-Type", "text/html");
  c.header("X-Content-Type-Options", "nosniff");

  return stream(c, async (stream) => {
    try {
      // Let GitHub Copilot know we are doing something
      stream.write(createAckEvent());

      const octokit = new Octokit({ auth: tokenForUser });
      const user = await octokit.request("GET /user");
      const userPrompt = getUserMessage(payload);

      const { message } = await prompt(userPrompt, {
        token: tokenForUser,
      });

      stream.write(createTextEvent(`Hi ${user.data.login}! `));

      stream.write(createTextEvent(message.content));

      stream.write(
          createReferencesEvent([
            {
              id: "123",
              type: "issue",
              data: {
                number: 123,
              },
              is_implicit: false,
              metadata: {
                display_name: "My issue",
                display_icon: "issue-opened",
                display_url: "https://github.com/polito/students-app/issues/424",
            },}
          ])
        );

      stream.write(createDoneEvent());
    } catch (error) {
      stream.write(
        createErrorsEvent([
          {
            type: "agent",
            message: error instanceof Error ? error.message : "Unknown error",
            code: "PROCESSING_ERROR",
            identifier: "processing_error",
          },
        ])
      );
    }
  });
});

const port = 3000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
