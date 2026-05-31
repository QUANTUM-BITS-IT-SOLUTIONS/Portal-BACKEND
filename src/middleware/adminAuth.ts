import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";

export function adminAuth(
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

    if (payload.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    (req as any).adminId = payload.adminId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
