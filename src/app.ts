import express from "express";
import cors from "cors";
import clientRoutes from "./routes/client-routes";
import adminRoutes from "./routes/admin-routes";
import studentRoutes from "./routes/student-routes";

const app = express();

app.use(cors());
app.use(express.json());

import path from "path";
// Serve static uploaded files
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.use("/clients", clientRoutes);
app.use("/admin", adminRoutes);
app.use("/students", studentRoutes);



app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

export default app;
