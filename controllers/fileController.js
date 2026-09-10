const fs = require("fs");
const path = require("path");

const File = require("../models/File");
const Folder = require("../models/Folder");

const fileSizeLabel = (sizeInBytes) => {
  if (!sizeInBytes && sizeInBytes !== 0) {
    return "0 KB";
  }

  if (sizeInBytes < 1024) {
    return `${sizeInBytes} B`;
  }

  const sizeInKB = sizeInBytes / 1024;

  if (sizeInKB < 1024) {
    return `${Math.round(sizeInKB * 10) / 10} KB`;
  }

  const sizeInMB = sizeInKB / 1024;

  if (sizeInMB < 1024) {
    return `${Math.round(sizeInMB * 10) / 10} MB`;
  }

  const sizeInGB = sizeInMB / 1024;

  return `${Math.round(sizeInGB * 10) / 10} GB`;
};

const fileTypeFromName = (originalName) => {
  if (!originalName) {
    return "document";
  }

  const ext = path.extname(originalName).toLowerCase();

  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) {
    return "image";
  }

  if ([".mp4", ".mov", ".avi", ".webm"].includes(ext)) {
    return "video";
  }

  if ([".mp3", ".wav", ".m4a", ".aac"].includes(ext)) {
    return "audio";
  }

  if ([".zip", ".rar", ".7z", ".tar", ".gz"].includes(ext)) {
    return "archive";
  }

  if ([".fig", ".sketch", ".figma"].includes(ext)) {
    return "design";
  }

  return "document";
};

const createFolder = async (req, res) => {
  try {
    const { name, parentFolder } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        message: "Folder name is required",
      });
    }

    const existingFolder = await Folder.findOne({
      name: name.trim(),
      userId: req.user.id,
      parentFolder: parentFolder || null,
    });

    if (existingFolder) {
      return res.status(400).json({
        message: "Folder already exists",
      });
    }

    const folder = await Folder.create({
      name: name.trim(),
      userId: req.user.id,
      parentFolder: parentFolder || null,
    });

    return res.status(201).json({
      success: true,
      message: "Folder created",
      folder,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const listFolders = async (req, res) => {
  try {
    const folders = await Folder.find({
      userId: req.user.id,
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      folders,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const listFiles = async (req, res) => {
  try {
    const { folderId = "all", search = "" } = req.query;

    const filter = {
      userId: req.user.id,
    };

    // =================================================
    // FOLDER FILTER
    // =================================================

    if (folderId && folderId !== "all") {
      filter.folderId = folderId;
    }

    // =================================================
    // SEARCH FILTER
    // =================================================

    if (search && search.trim()) {
      filter.originalName = {
        $regex: search.trim(),
        $options: "i",
      };
    }

    console.log("FILE LIST FILTER:", filter);

    const files = await File.find(filter).sort({ createdAt: -1 }).lean();

    const mappedFiles = files.map((file) => ({
      ...file,

      type: fileTypeFromName(file.originalName),

      sizeLabel: fileSizeLabel(file.size),

      createdDate: new Date(file.createdAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),

      downloadUrl: `/api/files/${file._id}/download`,
    }));

    return res.status(200).json({
      success: true,
      files: mappedFiles,
    });
  } catch (error) {
    console.error("List files error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const searchFiles = async (req, res) => {
  try {
    const { name = "" } = req.query;

    if (!name || !name.trim()) {
      return listFiles(req, res);
    }

    const files = await File.find({
      userId: req.user.id,
      originalName: {
        $regex: name.trim(),
        $options: "i",
      },
    })
      .sort({ createdAt: -1 })
      .lean();

    const mappedFiles = files.map((file) => ({
      ...file,
      type: fileTypeFromName(file.originalName),
      sizeLabel: fileSizeLabel(file.size),
      createdDate: new Date(file.createdAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      downloadUrl: `/api/files/${file._id}/download`,
    }));

    return res.status(200).json({
      success: true,
      files: mappedFiles,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const createFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "No file uploaded",
      });
    }

    const { folderId = "" } = req.body;

    const folder = folderId
      ? await Folder.findOne({
          _id: folderId,
          userId: req.user.id,
        })
      : null;

    const originalName = req.file.originalname;
    const ext = path.extname(originalName).toLowerCase();

    const file = await File.create({
      originalName,
      storedName: req.file.filename,
      mimeType: req.file.mimetype,
      extension: ext,
      size: req.file.size,
      path: req.file.path,
      userId: req.user.id,
      folderId: folder ? folder._id : null,
      folderName: folder ? folder.name : "",
    });

    return res.status(201).json({
      success: true,
      message: "File uploaded",
      file: {
        ...file.toObject(),
        type: fileTypeFromName(originalName),
        sizeLabel: fileSizeLabel(file.size),
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const downloadFile = async (req, res) => {
  try {
    const file = await File.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!file) {
      return res.status(404).json({
        message: "File not found",
      });
    }

    if (!fs.existsSync(file.path)) {
      return res.status(404).json({
        message: "Uploaded file missing on disk",
      });
    }

    return res.download(file.path, file.originalName);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const deleteFile = async (req, res) => {
  try {
    const file = await File.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!file) {
      return res.status(404).json({
        message: "File not found",
      });
    }

    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    await File.deleteOne({ _id: file._id });

    return res.status(200).json({
      success: true,
      message: "File deleted",
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const getFileStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const files = await File.find({
      userId,
    })
      .sort({ createdAt: -1 })
      .lean();

    const filesUploaded = files.length;

    const totalBytes = files.reduce(
      (total, file) => total + (Number(file.size) || 0),
      0,
    );

    const recentUploads = files.slice(0, 5).map((file) => ({
      ...file,
      type: fileTypeFromName(file.originalName),
      sizeLabel: fileSizeLabel(file.size),
      createdDate: new Date(file.createdAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    }));

    return res.status(200).json({
      success: true,
      stats: {
        filesUploaded,
        totalBytes,
        recentUploads,
      },
    });
  } catch (error) {
    console.error("Get file stats error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createFolder,
  listFolders,
  listFiles,
  searchFiles,
  createFile,
  downloadFile,
  deleteFile,
  getFileStats,
};
