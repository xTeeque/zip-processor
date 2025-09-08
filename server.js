// server.js
const express = require("express");
const multer = require("multer");
const AdmZip = require("adm-zip");
const path = require("path");
const fs = require("fs");

// ודא שתיקיית ההעלאות קיימת
const UPLOADS_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
const upload = multer({ dest: UPLOADS_DIR });

const PORT = process.env.PORT || 3000;

// מיפוי אופציות
const modeMap = {
  CA: {
    label: "כלבוטק עדיקא",
    prefix: "CA",
    topRetailerSysName: "chalbotakAdika",
    docOwnerEntity: "chalbotakAdika",
    sysName: "chalbotakAdika",
    orgGln: "7290058174508",
  },
  LE: {
    label: "עדיקא אילת",
    prefix: "LE",
    topRetailerSysName: "liorEilat",
    docOwnerEntity: "liorEilat",
    sysName: "liorEilat",
    orgGln: "7290058255726",
  },
};

// החלפת שתי אותיות ראשונות ב־base name (לא מוסיף — מחליף)
function replaceFirstTwoInBasename(name, prefix) {
  if (!name) return name;
  return name.length >= 2 ? prefix + name.substring(2)
                          : prefix.substring(0, name.length);
}

// החלפה בנתיב של ZIP תוך שמירת התיקייה (משנה רק את שם הקובץ עצמו)
function replaceFirstTwoInZipPath(entryName, prefix) {
  const posix = path.posix; // ZIP תמיד עם '/'
  const dir = posix.dirname(entryName);
  const base = posix.basename(entryName);
  const newBase = replaceFirstTwoInBasename(base, prefix);
  return dir === "." ? newBase : posix.join(dir, newBase);
}

// טרנספורמציה עומק-מלא ל־JSON בהתאם לאופציה
function transformJsonDeep(value, conf) {
  if (Array.isArray(value)) {
    return value.map((v) => transformJsonDeep(v, conf));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "topRetailerSysName") {
        out[k] = conf.topRetailerSysName;
      } else if (k === "docOwnerEntity") {
        out[k] = conf.docOwnerEntity;
      } else if (k === "sysName") {
        out[k] = conf.sysName;
      } else if (k === "orgGln") {
        out[k] = conf.orgGln;
      } else if (k === "originalFileName" && typeof v === "string") {
        out[k] = replaceFirstTwoInBasename(v, conf.prefix);
      } else {
        out[k] = transformJsonDeep(v, conf);
      }
    }
    return out;
  }
  return value;
}

// סטטי לקבצי ה-UI (public/index.html)
app.use(express.static("public"));

// בריאות פשוט
app.get("/healthz", (_req, res) => res.send("ok"));

// נקודת העיבוד
app.post("/process", upload.single("zipfile"), (req, res) => {
  try {
    // בדיקת קלט
    if (!req.file) {
      return res.status(400).send("ZIP לא התקבל.");
    }
    const option = req.body.option;
    if (!modeMap[option]) {
      return res.status(400).send('ערך "option" חייב להיות CA או LE.');
    }
    const conf = modeMap[option];

    // וידוא שזה באמת ZIP
    const isZip =
      /\.zip$/i.test(req.file.originalname) ||
      (req.file.mimetype && req.file.mimetype.includes("zip"));
    if (!isZip) {
      // מחיקה שקטה של קובץ ההעלאה
      fs.unlink(req.file.path, () => {});
      return res.status(400).send("יש להעלות קובץ .zip בלבד.");
    }

    // קריאת ה-ZIP שהועלה
    const sourceZip = new AdmZip(req.file.path);
    const entries = sourceZip.getEntries();

    if (!entries || entries.length === 0) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).send("ה-ZIP ריק.");
    }

    // בניית ZIP חדש בזיכרון
    const newZip = new AdmZip();

    for (const entry of entries) {
      if (entry.isDirectory) {
        // אין צורך להוסיף במפורש; יצירת קבצים במסלולים תיצור תיקיות
        continue;
      }

      const newEntryName = replaceFirstTwoInZipPath(entry.entryName, conf.prefix);
      const data = entry.getData();

      if (entry.entryName.toLowerCase().endsWith(".json")) {
        let contentStr = data.toString("utf8");
        try {
          const parsed = JSON.parse(contentStr);
          const transformed = transformJsonDeep(parsed, conf);
          const pretty = JSON.stringify(transformed, null, 2);
          newZip.addFile(newEntryName, Buffer.from(pretty, "utf8"));
        } catch (e) {
          // אם JSON לא תקין — נשנה רק את השם ונשמור את התוכן כמו שהוא
          newZip.addFile(newEntryName, data);
        }
      } else {
        // שאר הקבצים — שינוי שם בלבד
        newZip.addFile(newEntryName, data);
      }
    }

    // שם ה-ZIP החדש: שם המקור עם החלפת שתי האותיות הראשונות
    const originalBase = path.basename(req.file.originalname, path.extname(req.file.originalname));
    const outBase = replaceFirstTwoInBasename(originalBase, conf.prefix);
    const outZipName = `${outBase}.zip`;

    // שליחה ישירות מהזיכרון (בלי קובץ זמני)
    const outBuffer = newZip.toBuffer();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${outZipName}"`
    );
    res.setHeader("Content-Length", outBuffer.length);

    // ניקוי קובץ ההעלאה אחרי שנשלח המענה
    res.on("finish", () => {
      fs.unlink(req.file.path, () => {});
    });

    return res.send(outBuffer);
  } catch (err) {
    // ניקוי על שגיאה
    if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
    console.error("PROCESS ERROR:", err);
    return res.status(500).send("שגיאה בעיבוד ה-ZIP.");
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
