/** Крутящийся кружок цветом текста вокруг: «идёт сейчас» у строки списка и пункта меню. */
export function Spinner(props: { title?: string }) {
  return (
    <span
      {...(props.title === undefined ? {} : { title: props.title })}
      className="block size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
    />
  );
}
