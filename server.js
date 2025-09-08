const express = require("express");
const multer = require("multer");
const AdmZip = require("adm-zip");
const path = require("path");
const fs = require("fs");

const app = express();
const upload = multer({ dest: "uploads/" });

const PORT = process.env.PORT || 3000;

// פונקציה שמחליפה שתי אותיות ראשונות
function replaceFirstTwo(str, prefix) {
  return str.length >= 2
    ? prefix + str.substring(2)
    : prefix.substring(0, str.length);
}

// קונפיגורציות לשתי האופציות
const modeMap = {
  CA: {
    topRetailerSysName: "chalbotakAdika",
    docOwnerEntity: "chalbotakAdika",
    sysName: "chalbotakAdika",
    orgGln: "7290058174508",
  },
  LE: {
    topRetailerSysName: "liorEilat",
    docOwnerEntity: "liorEilat",
    sysName: "liorEilat",
    orgGln: "7290058255726",
  },
};

app.use(express.static("public")); // כאן נמצא index.html המעוצב שלך

app.post("/process", upload.single("zipfile"), (req, res) => {
  const option = req.body.option; // "CA" או "LE"
  const prefix = option === "CA" ? "CA" : "LE";
  const conf = modeMap[option];

  const uploadedPath = req.file.path;
  const zip = new AdmZip(uploadedPath);
  const zipEntries = zip.getEntries();

  const newZip = new AdmZip();

  zipEntries.forEach((entry) => {
    let newName = replaceFirstTwo(entry.entryName, prefix);

    if (entry.entryName.endsWith(".json")) {
      let content = entry.getData().toString("utf8");
      let obj = JSON.parse(content);

      // עדכון השדות
      obj.topRetailerSysName = conf.topRetailerSysName;
      obj.docOwnerEntity = conf.docOwnerEntity;

      if (obj.orgs) {
        obj.orgs = obj.orgs.map((org) => {
          if (org.sysName !== null) org.sysName = conf.sysName;
          if (org.orgGln !== null) org.orgGln = conf.orgGln;
          return org;
        });
      }

      if (obj.attachments) {
        obj.attachments = obj.attachments.map((att) => {
          att.originalFileName = replaceFirstTwo(
            att.originalFileName,
            prefix
          );
          return att;
        });
      }

      let newContent = JSON.stringify(obj, null, 2);
      newZip.addFile(newName, Buffer.from(newContent, "utf8"));
    } else {
      newZip.addFile(newName, entry.getData());
    }
  });

  // שם ה-ZIP החדש → החלפת שתי האותיות הראשונות בשם המקורי
  const originalName = req.file.originalname.replace(/\.zip$/i, "");
  const replacedName = replaceFirstTwo(originalName, prefix);
  const outZipName = `${replacedName}.zip`;

  const tmpPath = path.join(__dirname, outZipName);
  newZip.writeZip(tmpPath);

  // החזרת הקובץ להורדה
  res.download(tmpPath, outZipName, (err) => {
    fs.unlinkSync(uploadedPath); // מחיקת קובץ העלאה זמני
    fs.unlinkSync(tmpPath); // מחיקת קובץ חדש זמני
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
