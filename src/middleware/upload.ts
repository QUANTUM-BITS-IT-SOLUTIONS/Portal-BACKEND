import multer from "multer";
import path from "path";
import fs from "fs";

// Ensure upload directories exist
const uploadDir = path.join(__dirname, "../../uploads");
const avatarsDir = path.join(uploadDir, "avatars");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
if (!fs.existsSync(avatarsDir)) {
    fs.mkdirSync(avatarsDir);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, avatarsDir);
    },
    filename: function (req, file, cb) {
        const studentId = (req as any).studentId; // Assumes auth middleware ran before
        // Format: studentId-timestamp.ext
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, (studentId || "unknown") + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (file.mimetype.startsWith("image/")) {
        cb(null, true);
    } else {
        cb(new Error("Only images are allowed"));
    }
};

export const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: fileFilter
});
