import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { rateLimit } from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Replit proxies requests — trust the first proxy so rate-limit IPs are correct
app.set("trust proxy", 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // frontend is served separately
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// Restrict CORS to known origins (same Replit domain + localhost dev)
const allowedOrigins = (process.env.REPLIT_DOMAINS ?? "").split(",").map((d) => `https://${d.trim()}`).filter(Boolean);
if (process.env.NODE_ENV !== "production") allowedOrigins.push("http://localhost:3000", "http://localhost:5173");

app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));

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
