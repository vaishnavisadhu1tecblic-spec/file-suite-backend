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
  forgotPassword,
  resetPassword,
  validateResetToken,
} = require("../controllers/authController");

const upload = require("../middleware/uploadMiddleware");
const authMiddleware = require("../middleware/authMiddleware");

// Register
router.post("/register", upload.single("image"), register);

// Login
router.post("/login", login);

router.post("/google", googleLogin);

router.post("/forgot-password", forgotPassword);
router.get("/reset-password/:token", validateResetToken);
router.post("/reset-password", resetPassword);

// Get All Users
router.get("/users", authMiddleware, getUsers);

// Get Single User
router.get("/user/:id", authMiddleware, getUser);

// Update User
router.put("/update/:id", authMiddleware, upload.single("image"), updateUser);

// Delete User
router.delete("/delete/:id", authMiddleware, deleteUser);

module.exports = router;
