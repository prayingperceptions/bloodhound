import { Router, type IRouter } from "express";
import healthRouter from "./health";
import huntsRouter from "./hunts";
import donationsRouter from "./donations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(huntsRouter);
router.use(donationsRouter);

export default router;
