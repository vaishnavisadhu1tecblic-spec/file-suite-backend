const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const {
  getCallHistory,
  deleteCall,
  clearCallHistory,
} = require("../controllers/callController");

router.use(authMiddleware);

router.get("/", getCallHistory);
router.delete("/clear", clearCallHistory);
router.delete("/:id", deleteCall);

module.exports = router;
