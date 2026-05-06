import { Router, type IRouter } from "express";
import healthRouter from "./health";
import huntsRouter from "./hunts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(huntsRouter);

export default router;
