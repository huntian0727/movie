import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { createBuildFlavor } from "./release-engineering.mjs";

// Synthetic producer metadata only. This never calls a builder, changes release
// approval or produces a public artifact. All databases and credentials are QA data.
export async function runReleaseIdentitySmoke(root, app) {
  const { readReleaseFlavor, releaseUserDataPath } = await import("../dist-main/main/releaseFlavor.js");
  const { createSettingsStore, getDefaultSettings } = await import("../dist-main/main/settings/settingsStore.js");
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const appData = path.join(root, "identity-app-data");
  const previousUserData = app.getPath("userData");
  const syntheticFormalEnvironment = {
    GITHUB_ACTIONS: "true", GITHUB_REF: `refs/tags/v${manifest.version}`,
    RELEASE_LICENSE_APPROVED: "true", RELEASE_BINARY_COMPLIANCE_APPROVED: "true",
    RELEASE_MANUAL_QA_APPROVED: "true", RELEASE_UNSIGNED_PUBLIC_ACKNOWLEDGED: "true",
    WINDOWS_EXPECTED_PUBLISHER: "Synthetic metadata only", MOVIE_MEDIA_VARIANT: "lite-candidate"
  };
  const cases = [
    { releaseClass: "signed-release", directory: "local-video-manager" },
    { releaseClass: "unsigned-test-build", directory: "local-video-manager-unsigned-test" },
    { releaseClass: "unsigned-public-release", directory: "local-video-manager-community" }
  ];
  try {
    for (const [index, item] of cases.entries()) {
      const flavor = createBuildFlavor(manifest, item.releaseClass === "unsigned-test-build" ? {} : {
        ...syntheticFormalEnvironment, MOVIE_RELEASE_CLASS: item.releaseClass
      }, { signingCredentialsRequired: false });
      // Moving/updating the program folder must reopen the same identity's data.
      for (const programDirectory of ["original-program", "updated-program"]) {
        const resources = path.join(root, programDirectory, item.releaseClass, "resources");
        await mkdir(resources, { recursive: true });
        await writeFile(path.join(resources, "build-flavor.json"), JSON.stringify(flavor));
        const parsed = readReleaseFlavor(resources, manifest.version);
        const userData = releaseUserDataPath(appData, parsed);
        assert.equal(userData, path.join(appData, item.directory));
        await mkdir(userData, { recursive: true });
        app.setPath("userData", userData);
        assert.equal(app.getPath("userData"), userData);
        const database = new Database(path.join(app.getPath("userData"), "library.sqlite"));
        try {
          database.exec("CREATE TABLE IF NOT EXISTS identity_sentinel (id TEXT PRIMARY KEY)");
          database.prepare("INSERT OR IGNORE INTO identity_sentinel VALUES (?)").run(item.releaseClass);
          assert.deepEqual(database.prepare("SELECT id FROM identity_sentinel").all(), [{ id: item.releaseClass }]);
          assert.equal(database.pragma("quick_check", { simple: true }), "ok");
        } finally { database.close(); }
        const settings = await createSettingsStore();
        const token = `synthetic-profile-${index}`;
        if (programDirectory === "original-program") {
          assert.equal(settings.getCloudDriveToken(), "");
          settings.set({ ...getDefaultSettings(), cloudDrive: { ...getDefaultSettings().cloudDrive, apiToken: token } });
        }
        assert.equal(settings.getCloudDriveToken(), token);
        assert.equal((await readFile(path.join(userData, "settings.json"), "utf8")).includes(token), false);
      }
    }
    // Revisit older profiles after community initialization to detect overwrites.
    for (const [index, item] of cases.entries()) {
      app.setPath("userData", path.join(appData, item.directory));
      assert.equal((await createSettingsStore()).getCloudDriveToken(), `synthetic-profile-${index}`);
      const database = new Database(path.join(app.getPath("userData"), "library.sqlite"), { readonly: true });
      try { assert.deepEqual(database.prepare("SELECT id FROM identity_sentinel").all(), [{ id: item.releaseClass }]); }
      finally { database.close(); }
    }
    console.log("Release identity smoke OK: builder/runtime parity, three SQLite/DPAPI profiles, moved-folder reopen and no cross-profile overwrite.");
  } finally { app.setPath("userData", previousUserData); }
}
