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
  getFileStats,
} = require("../controllers/fileController");

// =====================================================
// FOLDERS
// =====================================================

router.post("/folders", authMiddleware, createFolder);

router.get("/folders", authMiddleware, listFolders);

// =====================================================
// FILE SEARCH / STATS
// =====================================================

router.get("/search", authMiddleware, searchFiles);

router.get("/stats", authMiddleware, getFileStats);

// =====================================================
// FILES
// =====================================================

router.get("/", authMiddleware, listFiles);

router.post("/upload", authMiddleware, upload.single("file"), createFile);

// =====================================================
// DOWNLOAD / DELETE
// =====================================================

router.get("/:id/download", authMiddleware, downloadFile);

router.delete("/:id", authMiddleware, deleteFile);

module.exports = router;
