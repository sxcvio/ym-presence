// electron-builder's own signing step needs symlink rights on Windows; we skip it
// (win.signAndEditExecutable=false) and set the exe icon with rcedit here instead.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

exports.default = async function (ctx) {
  const cache = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "electron-builder", "Cache", "winCodeSign");
  const rcedit = fs.readdirSync(cache, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(cache, d.name, "rcedit-x64.exe"))
    .find((p) => fs.existsSync(p));
  if (!rcedit) {
    console.warn("rcedit not found, exe keeps the default icon");
    return;
  }
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  execFileSync(rcedit, [exe, "--set-icon", path.join(ctx.packager.projectDir, "assets", "icon.ico")]);
};
