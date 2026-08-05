import "../env.js";
import { migrate } from "./db.js";

migrate();
console.log("Migration complete.");
