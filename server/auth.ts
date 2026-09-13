import { type Request, type Response, type NextFunction } from "express";
import type { PublicUser } from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    user: PublicUser;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden: admin only" });
  }
  next();
}
