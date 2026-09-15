const express = require("express");

const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const {
  listConversations,
  createPrivateConversation,
  joinLegacyConversation,
  createGroupConversation,
  getConversation,
  addMember,
  removeMember,
  renameConversation,
  leaveConversation,
  createFileMessage,
  listConversationFiles,
  shareExistingFile,
  downloadSharedFile,
  previewSharedFile,
  listSharedFiles,
  revokeSharedFile,
} = require("../controllers/conversationController");

router.use(authMiddleware);

router.get("/", listConversations);
router.post("/private/:userId", createPrivateConversation);
router.post("/groups", createGroupConversation);
router.get("/files/shared-with-me", listSharedFiles);
router.get("/files/shared-by-me", listSharedFiles);
router.post("/legacy/:legacyChatId", joinLegacyConversation);
router.get("/:id", getConversation);
router.post("/:id/members", addMember);
router.delete("/:id/members/:userId", removeMember);
router.patch("/:id", renameConversation);
router.delete("/:id/members/me", leaveConversation);
router.get("/:id/files", listConversationFiles);

const uploadChatFile = (req, res, next) => {
  upload.single("file")(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ message: "File is too large. Maximum size is 50 MB." });
    }

    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return res
        .status(400)
        .json({ message: "This file type is not supported." });
    }

    return res.status(400).json({ message: "Unable to upload this file" });
  });
};

router.post("/:id/files", uploadChatFile, createFileMessage);
router.post("/:id/files/:fileId", shareExistingFile);
router.get("/:id/files/:fileId/preview", previewSharedFile);
router.get("/:id/files/:fileId/download", downloadSharedFile);
router.delete("/:id/files/:fileId", revokeSharedFile);

module.exports = router;
