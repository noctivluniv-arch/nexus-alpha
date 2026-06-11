import { Router, type IRouter } from "express";
import healthRouter from "./health";
import binanceRouter from "./binance";
import aiRouter from "./ai";
import newsRouter from "./news";
import memesRouter from "./memes";
import whalesRouter from "./whales";
import telegramRouter from "./telegram";
import altcoinsRouter from "./altcoins";
import altcoinsRouter from "./altcoins";

const router: IRouter = Router();

router.use(healthRouter);
router.use(binanceRouter);
router.use(aiRouter);
router.use(newsRouter);
router.use(memesRouter);
router.use(whalesRouter);
router.use("/telegram", telegramRouter);
router.use(altcoinsRouter);
router.use(altcoinsRouter);

export default router;
