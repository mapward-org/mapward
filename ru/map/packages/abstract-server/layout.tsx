import type { LayoutProps } from "@mapward/component";
import { Grid } from "../../_plugins/views/bricks/grid.tsx";

/** Вкладка «Всё»: в сайдбаре — столбцом, в широком табе — две колонки сверху. */
export default function Layout({ metrics }: LayoutProps) {
  return (
    <Grid
      variants={{
        "min-width: 0px": {
          areas: [
            ["code"],
            ["docs"],
            ["version"],
            ["tests"],
            ["lint"],
            ["public-api"],
            ["architecture"],
            ["requirements-todo"],
            ["architecture-drift"],
            ["code-drift"],
            ["decisions"],
            ["requirements"],
            ["files"],
          ],
          style: { gap: "8px" },
        },
        "min-width: 600px": {
          areas: [
            ["code", "docs"],
            ["version", "tests"],
            ["lint", "public-api"],
            ["architecture", "architecture"],
            ["requirements-todo", "requirements-todo"],
            ["architecture-drift", "architecture-drift"],
            ["code-drift", "code-drift"],
            ["decisions", "decisions"],
            ["requirements", "requirements"],
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
