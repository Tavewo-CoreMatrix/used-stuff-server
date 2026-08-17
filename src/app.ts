import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import type { RequestHandler } from "express";
import { env } from "./config/env.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { notFoundMiddleware } from "./middleware/not-found.middleware.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.middleware.js";
import { payoutsQueue, refundsQueue, transactionsQueue } from "./queues/index.js";
import { apiRouter } from "./routes/index.js";

const requireBullBoardAuth: RequestHandler = (request, response, next) => {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith("Basic ")) {
    response.setHeader("WWW-Authenticate", 'Basic realm="Queue Dashboard"');
    response.status(401).send("Authentication required");
    return;
  }

  const [username, password] = Buffer.from(authHeader.slice(6), "base64")
    .toString("utf8")
    .split(":");

  const expectedUser = Buffer.from(env.bullBoardUsername ?? "");
  const expectedPass = Buffer.from(env.bullBoardPassword ?? "");
  const givenUser = Buffer.from(username ?? "");
  const givenPass = Buffer.from(password ?? "");

  // Timing-safe comparison to prevent brute-force via timing side-channels
  const userMatch =
    expectedUser.length === givenUser.length &&
    crypto.timingSafeEqual(expectedUser, givenUser);
  const passMatch =
    expectedPass.length === givenPass.length &&
    crypto.timingSafeEqual(expectedPass, givenPass);

  if (!userMatch || !passMatch) {
    response.setHeader("WWW-Authenticate", 'Basic realm="Queue Dashboard"');
    response.status(401).send("Invalid credentials");
    return;
  }

  next();
};

export const createApp = () => {
  const app = express();

  // ── BullBoard dashboard — mount before helmet so its assets load correctly ──
  const boardAdapter = new ExpressAdapter();
  boardAdapter.setBasePath("/admin/queues");
  createBullBoard({
    queues: [
      new BullMQAdapter(transactionsQueue),
      new BullMQAdapter(payoutsQueue),
      new BullMQAdapter(refundsQueue),
    ],
    serverAdapter: boardAdapter,
  });
  // Disable CSP only for the admin route so BullBoard's inline scripts work
  app.use(
    "/admin/queues",
    requireBullBoardAuth,
    helmet({ contentSecurityPolicy: false }),
    boardAdapter.getRouter(),
  );

  // ── Global middleware ──────────────────────────────────────────────────────
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );
  app.use(
    express.json({
      limit: "1mb",
      verify: (req: express.Request, _res: express.Response, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(rateLimitMiddleware);

  app.use("/api/v1", apiRouter);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
};
