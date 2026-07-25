const { app } = require("electron");

app.whenReady().then(async () => {
  const { runNativeSmoke } = await import("./native-smoke.mjs");
  await runNativeSmoke("electron");
  console.log("Electron main-process smoke OK: app.whenReady completed.");
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
