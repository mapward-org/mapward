Как запустить dev-версию расширения.

- собрать зависимости расширения: `pnpm build`
- запустить watch на самом расширении: `pnpm --filter @mapward/vscode-extension dev`
- открыть в VS Code Extension Development Host (F5 по конфигурации из `.vscode/launch.json`)

Хост подхватывает пересборку сам, перезапускать его на каждое изменение не нужно —
достаточно `Developer: Reload Window` в хосте.
