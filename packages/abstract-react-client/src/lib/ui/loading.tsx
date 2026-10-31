/**
 * Заглушка, пока данные в пути. `data-loading` — договор со скриншотом (плагин `screenshot`):
 * пока такие заглушки есть, страница не готова, и снимать её рано.
 */
export function Loading(props: { text: string }) {
  return (
    <p data-loading="" className="p-3 text-[var(--mw-descriptionForeground)]">
      {props.text}
    </p>
  );
}
