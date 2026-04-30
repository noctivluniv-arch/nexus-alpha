import rateLimit from "express-rate-limit";
import { type Request, type Response, type NextFunction } from "express";

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "AI quota limit reached, please try again in a minute." },
});

export const chartLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Chart request limit reached, please try again in a minute." },
});

const AI_APP_SECRET = process.env["AI_APP_SECRET"];

export function requireAppSecret(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!AI_APP_SECRET) {
    next();
    return;
  }
  const provided = req.headers["x-app-secret"];
  if (!provided || provided !== AI_APP_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
