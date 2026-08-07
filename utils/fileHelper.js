const fs = require("fs");

const readFile = (path) => {
  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, "[]");
  }

  return JSON.parse(fs.readFileSync(path, "utf-8"));
};

const writeFile = (path, data) => {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
};

module.exports = { readFile, writeFile };
