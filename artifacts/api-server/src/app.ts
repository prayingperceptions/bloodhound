import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { rateLimit } from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Replit proxies requests — trust the first proxy so rate-limit IPs are correct
app.set("trust proxy", 1);

// Global rate limit: 120 req/min per IP
const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

app.use(globalLimiter);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
