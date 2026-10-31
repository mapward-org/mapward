import type { LayoutProps } from "@mapward/component";
import { Grid } from "../../_plugins/views/bricks/grid.tsx";

/** Холст на всю высоту области, но не ниже 320px: ему нечем расти самому. */
export default function Layout({ metrics }: LayoutProps) {
  return (
    <Grid areas={[["canvas"]]} style={{ height: "100%", gridTemplateRows: "minmax(320px, 1fr)" }}>
      {metrics}
    </Grid>
  );
}
