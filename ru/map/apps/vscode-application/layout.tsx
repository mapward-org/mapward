import type { LayoutProps } from "@mapward/component";
import { Grid } from "../../_plugins/views/bricks/grid.tsx";

/** Вкладка «Архитектура»: в сайдбаре — столбцом, в широком табе код и архитектура рядом. */
export default function Layout({ metrics }: LayoutProps) {
  return (
    <Grid
      variants={{
        "min-width: 0px": {
          areas: [["code"], ["architecture"], ["architecture-drift"], ["code-drift"], ["files"]],
          style: { gap: "8px" },
        },
        "min-width: 600px": {
          areas: [
            ["code", "architecture"],
            ["architecture-drift", "architecture-drift"],
            ["code-drift", "code-drift"],
            ["files", "files"],
          ],
          style: { gap: "8px" },
        },
      }}
    >
      {metrics}
    </Grid>
  );
}
