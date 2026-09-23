import { defineConfig } from "tsdown";
import { raw } from "./tsdown.raw.ts";

export default defineConfig({
  entry: "src/index.ts",
  format: "esm",
  dts: true,
  plugins: [raw],
});
