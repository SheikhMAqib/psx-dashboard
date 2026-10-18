import { cp, mkdir } from "node:fs/promises";

await mkdir("public/static", { recursive: true });
await Promise.all(
  ["dashboard.css", "dashboard.js"].map((file) =>
    cp(`static/${file}`, `public/static/${file}`),
  ),
);
