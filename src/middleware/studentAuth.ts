import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";

export function studentAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Missing token" });
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    const payload = verifyToken(token);

    if (payload.role !== "student") {
      return res.status(403).json({ error: "Forbidden" });
    }

    (req as any).studentId = payload.studentId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
