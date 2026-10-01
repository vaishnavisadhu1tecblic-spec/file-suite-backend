const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const {
  createBackup,
  getLatestBackup,
  restoreBackup,
  deleteBackup,
  updateBackupSettings,
} = require("../controllers/backupController");

router.use(authMiddleware);

router.get("/latest", getLatestBackup);
router.post("/create", createBackup);
router.post("/restore", restoreBackup);
router.delete("/:id", deleteBackup);
router.delete("/", deleteBackup);
router.patch("/settings", updateBackupSettings);
router.patch("/preferences", updateBackupSettings);

module.exports = router;
