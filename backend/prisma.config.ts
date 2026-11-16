import path from "node:path";
import { defineConfig } from "prisma/config";

process.env.DATABASE_URL ??= "postgresql://messenger:messenger@127.0.0.1:55432/messenger";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
});
