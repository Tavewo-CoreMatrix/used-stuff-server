import type { AccountRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
      auth?: {
        accountId: string;
        role: AccountRole;
      };
    }
  }
}

export {};
