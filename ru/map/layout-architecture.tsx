import type { LayoutProps } from "@mapward/component";
import { Grid } from "./_plugins/views/bricks/grid.tsx";

/** Вкладка «Архитектура»: доки и связи своей высотой, дети карты — на весь остаток экрана. */
export default function Layout({ metrics }: LayoutProps) {
  return (
    <Grid
      areas={[["architecture-docs"], ["package-deps"], ["architecture-quality"], ["children"]]}
      style={{ height: "100%", gridTemplateRows: "auto auto auto minmax(320px, 1fr)", gap: "8px" }}
    >
      {metrics}
    </Grid>
  );
}
