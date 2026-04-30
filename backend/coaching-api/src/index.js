import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json({ limit: "512kb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "coaching-api" }));
app.post("/coach", (_req, res) => res.status(501).json({ cards: [], profileSnapshot: null, retrievedChunks: [], stub: true }));
app.post("/dismiss", (_req, res) => res.status(501).json({ ok: false, stub: true }));
app.get("/profile/:userId", (req, res) => res.status(501).json({ userId: req.params.userId, stub: true }));

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`coaching-api on http://localhost:${port}`));
