import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "Bingo";

type AdminPayload = {
  adminId: string;
  role: "admin";
};

type StudentPayload = {
  studentId: string;
  role: "student";
};

type JwtPayload = AdminPayload | StudentPayload;

/**
 * Sign Admin JWT
 */
export function signAdminToken(adminId: string) {
  return jwt.sign(
    { adminId, role: "admin" } as AdminPayload,
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

/**
 * Sign Student JWT
 */
export function signStudentToken(studentId: string) {
  return jwt.sign(
    { studentId, role: "student" } as StudentPayload,
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

type ClientPayload = {
  clientId: string;
  role: "client";
};

export function signClientToken(clientId: string) {
  return jwt.sign(
    { clientId, role: "client" } as ClientPayload,
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

/**
 * Verify JWT (admin or student)
 */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
