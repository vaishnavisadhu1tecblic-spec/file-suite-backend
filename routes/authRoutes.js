const express = require("express");
const router = express.Router();

const {
  register,
  login,
  getUsers,
  getUser,
  updateUser,
  deleteUser,
  googleLogin,
} = require("../controllers/authController");

const upload = require("../middleware/uploadMiddleware");
const authMiddleware = require("../middleware/authMiddleware");

// Register
router.post("/register", upload.single("image"), register);

// Login
router.post("/login", login);

router.post("/google", googleLogin);

// Get All Users
router.get("/users", authMiddleware, getUsers);

// Get Single User
router.get("/user/:id", authMiddleware, getUser);

// Update User
router.put("/update/:id", authMiddleware, upload.single("image"), updateUser);

// Delete User
router.delete("/delete/:id", authMiddleware, deleteUser);

module.exports = router;
