import "../env.js";
import "./db.js"; // eagerly opens the DB connection and runs migrations as an import side effect

console.log("Migration complete.");
