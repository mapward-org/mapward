import type { ComponentProps, ReactNode } from "react";
import { Section } from "../../../../lib/ui/section.tsx";
import { DirectiveList } from "./directive-list.tsx";

/**
 * Раздел «Директивы» мета-экрана. Своего поиска у него нет: поиск один на весь экран, и сюда
 * приходит уже отобранный список — поэтому директивы находятся тем же правилом, что и
 * остальные разделы, а не вторым поиском рядом.
 */
export function DirectiveSection(
  props: ComponentProps<typeof DirectiveList> & { icon: ReactNode },
) {
  const { icon, ...list } = props;
  return (
    <Section icon={icon} title="Директивы">
      <DirectiveList {...list} />
    </Section>
  );
}
