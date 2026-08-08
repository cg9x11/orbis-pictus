import path from "node:path";
import os from "node:os";

// Keep the test suite hermetic: it must never read a developer's real repo-root config.yml, or
// local settings (composition, artStyle, …) would leak into default-value assertions. Tests that
// need a config file set CONFIG_FILE to their own fixture; this preload only guarantees the DEFAULT
// resolves to a path that cannot exist, so with no explicit CONFIG_FILE the loader sees "no file".
// Loaded via `--import` in the test script (see package.json), so it runs in every test process
// before any test module imports the config loader.
if (!process.env.CONFIG_FILE) {
  process.env.CONFIG_FILE = path.join(os.tmpdir(), "flipbook-tests-no-config-dir", "config.yml");
}
