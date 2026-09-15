const { OAuth2Client } = require("google-auth-library");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const User = require("../models/User");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const passwordResetResponse = {
  message:
    "If an account exists for that email, a password reset link has been sent to your email.",
};

const isStrongPassword = (password) =>
  password.length >= 8 &&
  /[A-Z]/.test(password) &&
  /[a-z]/.test(password) &&
  /\d/.test(password);

const sanitizeUser = (user) => {
  const safeUser = user.toObject ? user.toObject() : { ...user };

  delete safeUser.password;
  delete safeUser.passwordResetTokenHash;
  delete safeUser.passwordResetExpiresAt;

  return safeUser;
};

const getMailer = () => {
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASSWORD
  ) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
};

const sendPasswordResetEmail = async (email, resetUrl) => {
  const mailer = getMailer();

  if (!mailer) {
    console.warn("Password reset email service is not configured.");
    console.warn(`Development reset URL for ${email}: ${resetUrl}`);
    return;
  }

  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: "Reset your SyncSpace password",
    text: `Use this link to reset your SyncSpace password. It expires in 30 minutes: ${resetUrl}`,
    html: `<p>Use the link below to reset your SyncSpace password.</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in 30 minutes.</p>`,
  });
};

// ================= Register =================

const register = async (req, res) => {
  try {
    const { name, username, email, password, confirmPassword } = req.body;

    if (!name || !username || !email || !password || !confirmPassword) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        message: "Passwords do not match",
      });
    }

    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      return res.status(400).json({
        message: "Email or Username already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      image: req.file ? req.file.filename : "",
      name,
      username,
      email,
      password: hashedPassword,
    });

    res.status(201).json({
      success: true,
      message: "User Registered Successfully",
      user: sanitizeUser(newUser),
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ================= Login =================

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Invalid Password",
      });
    }

    const token = jwt.sign(
      {
        id: user._id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      },
    );

    res.status(200).json({
      success: true,
      message: "Login Successful",
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

//================= googlelogin =================

const googleLogin = async (req, res) => {
  try {
    const { access_token } = req.body;

    const response = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      },
    );

    const data = await response.json();

    let user = await User.findOne({
      email: data.email,
    });

    if (!user) {
      user = await User.create({
        name: data.name,
        username: data.email.split("@")[0],
        email: data.email,
        password: "",
        image: data.picture,
      });
    }

    const token = jwt.sign(
      {
        id: user._id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      },
    );

    res.json({
      success: true,
      token,
      user: sanitizeUser(user),
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};

// ================= Forgot Password =================

const forgotPassword = async (req, res) => {
  const email = String(req.body.email || "")
    .trim()
    .toLowerCase();

  if (!email) {
    return res.status(400).json({
      message: "Email is required",
    });
  }

  try {
    const user = await User.findOne({ email });

    if (user) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      const resetUrl = `${frontendUrl}/forgot-password?token=${rawToken}`;

      user.passwordResetTokenHash = tokenHash;
      user.passwordResetExpiresAt = expiresAt;
      await user.save();

      try {
        await sendPasswordResetEmail(user.email, resetUrl);
      } catch (emailError) {
        console.error("Password reset email delivery failed:", emailError);
      }
    }

    return res.status(200).json(passwordResetResponse);
  } catch (error) {
    console.error("Forgot password request failed:", error);
    return res.status(200).json(passwordResetResponse);
  }
};

// ================= Reset Password =================

const resetPassword = async (req, res) => {
  const { token, email, password, confirmPassword } = req.body;
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();

  if (!token || !normalizedEmail || !password || !confirmPassword) {
    return res.status(400).json({
      message: "Email, token, password, and password confirmation are required",
    });
  }

  if (!isStrongPassword(password)) {
    return res.status(400).json({
      message:
        "Password must contain at least 8 characters, one uppercase letter, one lowercase letter, and one number",
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({
      message: "Passwords do not match",
    });
  }

  try {
    const tokenHash = crypto
      .createHash("sha256")
      .update(String(token))
      .digest("hex");

    const user = await User.findOneAndUpdate(
      {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: { $gt: new Date() },
        email: normalizedEmail,
      },
      {
        $set: {
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
        },
      },
      {
        returnDocument: "after",
        select: "+passwordResetTokenHash +passwordResetExpiresAt",
      },
    );

    if (!user) {
      return res.status(400).json({
        message: "This reset link is invalid or has expired",
      });
    }

    user.password = await bcrypt.hash(password, 10);
    await user.save();

    return res.status(200).json({
      message: "Your password has been reset successfully.",
    });
  } catch (error) {
    console.error("Reset password request failed:", error);
    return res.status(500).json({
      message: "Unable to reset password. Please try again.",
    });
  }
};

const validateResetToken = async (req, res) => {
  try {
    const tokenHash = crypto
      .createHash("sha256")
      .update(String(req.params.token || ""))
      .digest("hex");

    const user = await User.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: new Date() },
    }).select("+passwordResetTokenHash +passwordResetExpiresAt");

    if (!user) {
      return res.status(400).json({
        message: "This reset link is invalid or has expired",
      });
    }

    return res.status(200).json({
      valid: true,
    });
  } catch (error) {
    console.error("Reset token validation failed:", error);
    return res.status(400).json({
      message: "This reset link is invalid or has expired",
    });
  }
};

// ================= Get All Users =================

const getUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password");

    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ================= Get Single User =================

const getUser = async (req, res) => {
  try {
    if (String(req.user.id) !== String(req.params.id)) {
      return res.status(403).json({
        message: "You can only access your own account",
      });
    }

    const user = await User.findById(req.params.id).select("-password");

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ================= Update User =================

const updateUser = async (req, res) => {
  try {
    if (String(req.user.id) !== String(req.params.id)) {
      return res.status(403).json({
        message: "You can only update your own account",
      });
    }

    const name = String(req.body.name || "").trim();
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    if (!name || !username || !email) {
      return res.status(400).json({
        message: "Name, username, and email are required",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        message: "Enter a valid email address",
      });
    }

    const conflictingUser = await User.findOne({
      _id: { $ne: req.user.id },
      $or: [{ email }, { username }],
    });

    if (conflictingUser) {
      return res.status(409).json({
        message: "Email or username is already in use",
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      {
        name,
        username,
        email,
        ...(req.file && { image: req.file.filename }),
      },
      {
        new: true,
      },
    );

    if (!updatedUser) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    res.status(200).json({
      message: "User Updated Successfully",
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ================= Delete User =================

const deleteUser = async (req, res) => {
  try {
    if (String(req.user.id) !== String(req.params.id)) {
      return res.status(403).json({
        message: "You can only delete your own account",
      });
    }

    const deletedUser = await User.findByIdAndDelete(req.params.id);

    if (!deletedUser) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    res.status(200).json({
      message: "User Deleted Successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

module.exports = {
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
};
