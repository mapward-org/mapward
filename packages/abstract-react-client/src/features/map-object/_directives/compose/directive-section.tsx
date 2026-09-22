import { useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { Section, SectionButton } from "../../../../lib/ui/section.tsx";
import { matchDirectives } from "../../pure-model/directives.ts";
import { DirectiveList } from "./directive-list.tsx";

/**
 * Раздел «Директивы» мета-экрана с поиском по названию. Директив у старого объекта десятки,
 * а нужна обычно одна, поэтому лупа в заголовке открывает под ним поле, и список фильтруется
 * на клиенте, по мере набора.
 *
 * Поле появляется по клику, а не стоит всегда: пока искать не нужно, оно только отнимает
 * строку. Вторая лупа и Escape закрывают его и сбрасывают запрос — иначе закрытое поле
 * оставило бы список отфильтрованным без видимой причины. Запрос, как и свёрнутость раздела,
 * никуда не сохраняется.
 */
export function DirectiveSection(
  props: ComponentProps<typeof DirectiveList> & { icon: ReactNode; searchIcon: ReactNode },
) {
  const { icon, searchIcon, files, ...list } = props;
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  const close = () => {
    setSearching(false);
    setQuery("");
  };

  const found = matchDirectives(files, query);

  return (
    <Section
      icon={icon}
      title="Директивы"
      {...(files.length === 0
        ? {}
        : {
            actions: (
              <SectionButton
                title={searching ? "Закрыть поиск" : "Искать по названию"}
                onClick={() => (searching ? close() : setSearching(true))}
              >
                {searchIcon}
              </SectionButton>
            ),
          })}
    >
      {searching && (
        <input
          // Поле открыли, чтобы набирать: фокус сразу в нём.
          autoFocus
          type="search"
          value={query}
          placeholder="название или дата"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
          className="mx-3 mb-1 rounded-sm border border-[var(--mw-input-border,#8884)] bg-[var(--mw-input-background,transparent)] px-1.5 py-0.5 text-[12px] text-[var(--mw-input-foreground,inherit)] outline-none focus:border-[var(--mw-focusBorder,#48f)]"
        />
      )}
      <DirectiveList
        {...list}
        files={found}
        // Пустой отбор — не пустой объект: пишем, что не нашлось, а не молчим.
        {...(files.length > 0 && found.length === 0 ? { empty: "не нашлось" } : {})}
      />
    </Section>
  );
}
