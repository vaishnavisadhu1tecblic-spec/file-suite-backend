const express = require("express");

const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const {
  searchUsers,
  listFriends,
  listFriendRequests,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
} = require("../controllers/friendController");

router.use(authMiddleware);

router.get("/search", searchUsers);
router.get("/", listFriends);
router.get("/requests", listFriendRequests);
router.post("/requests/:userId", sendFriendRequest);
router.post("/requests/:requestId/accept", acceptFriendRequest);
router.delete("/requests/:requestId", rejectFriendRequest);

module.exports = router;
