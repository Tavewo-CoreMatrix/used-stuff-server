import { Router } from "express";
import { adminRouter } from "./admin.routes.js";
import { accountsRouter } from "./accounts.routes.js";
import { authRouter } from "./auth.routes.js";
import { healthRouter } from "./health.routes.js";
import { itemsRouter } from "./items.routes.js";
import { listingsRouter } from "./listings.routes.js";
import { transactionsRouter } from "./transactions.routes.js";
import { paymentsRouter } from "./payments.routes.js";
import { verificationRouter } from "./verification.routes.js";
import { wantedRequestsRouter } from "./wanted-requests.routes.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/accounts", accountsRouter);
apiRouter.use("/items", itemsRouter);
apiRouter.use("/listings", listingsRouter);
apiRouter.use("/transactions", transactionsRouter);
apiRouter.use("/payments", paymentsRouter);
apiRouter.use("/verification", verificationRouter);
apiRouter.use("/wanted-requests", wantedRequestsRouter);
