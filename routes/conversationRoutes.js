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
  updateGroupInfo,
  updateGroupPermissions,
  addMember,
  removeMember,
  updateMemberRole,
  transferOwnership,
  deleteGroup,
  getGroupInviteLink,
  resetGroupInviteLink,
  getGroupJoinInfo,
  joinGroupByInvite,
  approveJoinRequest,
  rejectJoinRequest,
  renameConversation,
  leaveConversation,
  createFileMessage,
  listConversationFiles,
  shareExistingFile,
  downloadSharedFile,
  previewSharedFile,
  listSharedFiles,
  revokeSharedFile,
  deleteConversationsForMe,
} = require("../controllers/conversationController");

router.use(authMiddleware);

// Conversations Listing & Creation
router.get("/", listConversations);
router.post("/private/:userId", createPrivateConversation);
router.post("/groups", upload.single("avatar"), createGroupConversation);
router.delete("/delete-chat", deleteConversationsForMe);
router.delete("/:id/delete-for-me", deleteConversationsForMe);

// Shared Files
router.get("/files/shared-with-me", listSharedFiles);
router.get("/files/shared-by-me", listSharedFiles);
router.post("/legacy/:legacyChatId", joinLegacyConversation);

// Group Invites & Joining
router.get("/join-info/:inviteCode", getGroupJoinInfo);
router.post("/join/:inviteCode", joinGroupByInvite);

// Single Conversation Details & Management
router.get("/:id", getConversation);
router.patch("/:id/info", upload.single("avatar"), updateGroupInfo);
router.patch("/:id/permissions", updateGroupPermissions);
router.post("/:id/transfer-ownership", transferOwnership);
router.delete("/:id/group", deleteGroup);

// Group Members
router.post("/:id/members", addMember);
router.delete("/:id/members/:userId", removeMember);
router.patch("/:id/members/:userId/role", updateMemberRole);
router.delete("/:id/members/me", leaveConversation);

// Group Join Requests & Invites
router.get("/:id/invite-link", getGroupInviteLink);
router.post("/:id/invite-link/reset", resetGroupInviteLink);
router.post("/:id/requests/:userId/approve", approveJoinRequest);
router.post("/:id/requests/:userId/reject", rejectJoinRequest);

// Backward compatibility rename
router.patch("/:id", renameConversation);

// Chat Files
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
