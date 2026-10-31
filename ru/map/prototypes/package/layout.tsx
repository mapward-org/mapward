import type { LayoutProps } from "@mapward/component";
import { Grid } from "../../_plugins/views/bricks/grid.tsx";

/** Вкладка «Всё» пакета: в сайдбаре — столбцом, в широком табе — три колонки сверху. */
export default function Layout({ metrics }: LayoutProps) {
  return (
    <Grid
      variants={{
        "min-width: 0px": {
          areas: [
            ["code"],
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
            ["howto"],
            ["files"],
            ["files-live"],
          ],
          style: { gap: "8px" },
        },
        "min-width: 600px": {
          areas: [
            ["code", "code", "version"],
            ["tests", "lint", "public-api"],
            ["architecture", "architecture", "architecture"],
            ["requirements-todo", "requirements-todo", "requirements-todo"],
            ["architecture-drift", "architecture-drift", "architecture-drift"],
            ["code-drift", "code-drift", "code-drift"],
            ["decisions", "decisions", "decisions"],
            ["requirements", "requirements", "requirements"],
            ["howto", "howto", "howto"],
            ["files", "files", "files"],
            ["files-live", "files-live", "files-live"],
          ],
          style: { gap: "8px" },
        },
      }}
    >
      {metrics}
    </Grid>
  );
}
