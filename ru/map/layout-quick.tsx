import type { LayoutProps } from "@mapward/component";
import { ActionButton } from "./_plugins/views/bricks/action-button.tsx";
import { Grid } from "./_plugins/views/bricks/grid.tsx";

/** Вкладка «Быстрый доступ»: кнопка «Собрать и поставить» над детьми карты. */
export default function Layout({ metrics }: LayoutProps) {
  return (
    <Grid areas={[["release"], ["children-list"]]} style={{ gap: "8px" }}>
      {{ ...metrics, release: <ActionButton action="release" /> }}
    </Grid>
  );
}
