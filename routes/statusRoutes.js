const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const {
  getStatuses,
  createStatus,
  viewStatus,
  getStatusViewers,
  deleteStatus,
  streamStatusMedia,
  streamStatusAudio,
} = require("../controllers/statusController");

// Public/semi-protected media streams
router.get("/media/:id", streamStatusMedia);
router.get("/audio/:id", streamStatusAudio);

// Authenticated status routes
router.use(authMiddleware);

router.get("/", getStatuses);

const statusUploadFields = upload.fields([
  { name: "media", maxCount: 1 },
  { name: "audio", maxCount: 1 },
  { name: "image", maxCount: 1 },
]);

router.post("/", statusUploadFields, createStatus);
router.post("/:id/view", viewStatus);
router.get("/:id/viewers", getStatusViewers);
router.delete("/:id", deleteStatus);

module.exports = router;
