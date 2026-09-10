const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

const {
  createFolder,
  listFolders,
  listFiles,
  searchFiles,
  createFile,
  downloadFile,
  deleteFile,
} = require("../controllers/fileController");

router.post("/folders", authMiddleware, createFolder);
router.get("/folders", authMiddleware, listFolders);
router.get("/search", authMiddleware, searchFiles);
router.get("/", authMiddleware, listFiles);
router.post("/upload", authMiddleware, upload.single("file"), createFile);
router.get("/:id/download", authMiddleware, downloadFile);
router.delete("/:id", authMiddleware, deleteFile);

module.exports = router;
