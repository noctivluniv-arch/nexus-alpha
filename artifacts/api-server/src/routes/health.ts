import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/debug/info", (_req, res) => {
  res.json({
    hasGeminiKey: !!process.env["GEMINI_API_KEY"],
    keyPrefix: process.env["GEMINI_API_KEY"]?.slice(0, 8) ?? "none",
    model: process.env["GEMINI_API_KEY"] ? "gemini-2.0-flash" : "gemini-2.5-flash",
    nodeEnv: process.env["NODE_ENV"],
  });
});

export default router;
