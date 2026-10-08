import test from "node:test";
import assert from "node:assert/strict";
import { validateCandidatePair } from "../../scripts/verify-native-media-candidate.mjs";

const version = "n9.0.2-22-g46d8f462ee-20261005";
const flags = "--arch=x86_64 --target-os=mingw32 --disable-libx264 --enable-libopus --enable-libvpx";
function output(command, selectedVersion = version, configuration = flags) {
  return `${command} version ${selectedVersion}\nconfiguration: ${configuration}\nlibavcodec 63.1.102\n`;
}

test("pins version and matching build flags for both native media tools", () => {
  const result = validateCandidatePair(output("ffmpeg"), output("ffprobe"), version);
  assert.equal(result.version, version);
  assert.deepEqual(result.enabledLibraries, ["libopus", "libvpx"]);
});

test("rejects a stale probe even when the encoder is pinned", () => {
  assert.throws(() => validateCandidatePair(output("ffmpeg"), output("ffprobe", "4.0.2"), version), /exact pinned build/);
});

test("rejects mismatched build configurations", () => {
  assert.throws(() => validateCandidatePair(output("ffmpeg"), output("ffprobe", version, flags + " --enable-libass"), version), /configurations differ/);
});

test("rejects GPL and nonfree variants", () => {
  for (const flag of ["--enable-gpl", "--enable-nonfree"]) {
    assert.throws(() => validateCandidatePair(output("ffmpeg", version, flags + " " + flag), output("ffprobe", version, flags + " " + flag), version), /GPL or nonfree/);
  }
});

test("rejects missing version and non-Windows or non-x64 input", () => {
  assert.throws(() => validateCandidatePair("bad", output("ffprobe"), version), /version\/configuration is missing/);
  assert.throws(() => validateCandidatePair(output("ffmpeg", version, "--arch=arm64 --target-os=linux"), output("ffprobe", version, "--arch=arm64 --target-os=linux"), version), /Windows x64/);
});
