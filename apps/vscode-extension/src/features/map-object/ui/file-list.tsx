/** Directives and actions are files; a click opens the file, as the requirements say. */
export function FileList(props: {
  title: string;
  files: { name: string; path: string }[];
  onOpen: (path: string) => void;
}) {
  if (props.files.length === 0) return null;
  return (
    <section className="px-2 pb-1">
      <h2 className="text-[11px] uppercase opacity-60">{props.title}</h2>
      <ul>
        {props.files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              onClick={() => props.onOpen(file.path)}
              className="text-left text-[var(--vscode-textLink-foreground)] hover:underline"
            >
              {file.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
